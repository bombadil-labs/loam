// The session table (SPEC §36 phase 4) and the login doors (phase 5): sessions in server memory,
// and the three routes where a person trades a password for one — GET /login, POST /login,
// POST /logout.
//
// COOKIE AUTHORITY IS CONFINED TO THESE DOORS. A cookie is ambient — the browser attaches it to
// any request any page makes — so a session that opened a data door would hand every page on the
// internet a forgeable credential. http.ts states the invariant: authority on the data doors is a
// bearer header the caller presents explicitly, never a cookie. A session opens the store's own
// PAGES; phase 7 builds the bearer bridge a browser asks for a token through.
//
// THIS TABLE IS ONE PROCESS'S STATE, DELIBERATELY. It is a plain `Map`, with no persistence and no
// cross-process coherence: a restart, or a second replica behind a load balancer, sees an empty
// table. That is the deliberate shape for one operator on one box (§9a), not a gap this phase closes
// — a clustered deployment is a different ticket's decision.
//
// THE CLOCK IS MONOTONIC, and that is a security property, not a style choice. `Date.now()` is a
// wall clock a caller or the OS can step backward (a manual change, an NTP correction); if an expiry
// check ever read a SMALLER "now" than an earlier read, an already-expired session would look like it
// had gained time back, which is a backward clock step reading as an extension of the session's
// life. `performance.now()` — the default here — is guaranteed non-decreasing within one process, so
// the default clock cannot produce that. The table also does not rely on the guarantee alone: a row
// is deleted the moment it is found past its idle window, so even a clock that goes backward later
// (an injected test clock, or a future clock source with a weaker guarantee) has no live row left to
// revive.
//
// `idleMs` and `ttlMs` are DURATIONS in milliseconds, always added to a `now()` reading inside this
// file — never compared against one directly. A caller passing an absolute timestamp (a `Date.now()`
// value) where a duration is expected would mint an effectively immortal session or token; nothing
// in this file's own defaults does that, but nothing type-checks it away either.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Reactor } from "@bombadil/rhizomatic";
import {
  DEFAULT_SCRYPT,
  credentialsPath,
  decoyParamsFor,
  entryFor,
  paramsDisagree,
  readCredentials,
  spendDecoyHash,
  verifyPassword,
  type CredentialsFile,
  type ScryptParams,
} from "./credentials.js";
import { rolesOf, userNameDefect, type UserRole } from "./users.js";
// The home's layout — where a per-user signing seed lives — is `cli/config`'s to spell, and
// spelling it a second time here is how two paths drift apart. Phase 3 writes these files; this
// door only reads them.
import { readUserSeed, userSeedPath } from "../cli/config.js";

export interface SessionTableOptions {
  /** How long a session may sit untouched before `touch` refuses it (default 30 minutes). */
  readonly idleMs?: number;
  /** How many signed-in sessions this table will hold at once (default 4096). */
  readonly maxSessions?: number;
  /** How many live token digests one session may hold at once (default 16). */
  readonly maxTokensPerSession?: number;
  /** A monotonic millisecond source. Injectable so a test can drive it; never `Date.now()`. */
  readonly now?: () => number;
}

interface SessionRow {
  readonly user: string;
  expiresAt: number;
  /** Digests this session minted, so `drop` and pruning know which entries to erase. */
  readonly tokenDigests: Set<string>;
}

interface TokenEntry {
  readonly sessionId: string;
  readonly expiresAt: number;
}

export interface SessionTable {
  /**
   * Open a signed-in session for `user`. Undefined when the table is at its cap — a full table
   * refuses a new session; it never evicts a LIVE one to make room (a flood of new logins evicting a
   * real operator's session would be worse than the flood itself). Before checking the cap, `open`
   * sweeps every session already past its idle window, so an abandoned session is reclaimed at the
   * next login rather than sitting until the process restarts.
   */
  open(user: string): { readonly id: string } | undefined;
  /**
   * Re-read a session, sliding its idle window forward. Undefined when `id` is unknown or was
   * already past its idle window — in the latter case the row is deleted, never merely reported
   * absent, so a later, smaller clock reading cannot revive it.
   */
  touch(id: string): { readonly user: string } | undefined;
  /** Drop a session and erase every token digest it minted. A session already absent is a no-op. */
  drop(id: string): void;
  /**
   * Mint a bearer-token secret bound to `id`'s session, valid for `ttlMs` from now — its OWN expiry,
   * never the session's idle expiry. Undefined when `id` names no live session, or when that session
   * already holds `maxTokensPerSession` live digests (a rapid, long-TTL minting loop cannot grow one
   * session's digest set without bound — the table's own memory floor is `maxSessions`, and an
   * unbounded per-session set would let one session alone defeat it).
   */
  mintToken(id: string, ttlMs: number): string | undefined;
  /**
   * The user a live, unexpired token secret names, or undefined — checked against BOTH the token's
   * own expiry and its parent session's idle expiry. A session past its idle window is refused here
   * exactly as `touch` would refuse it, even though nothing has swept the row out of the table yet:
   * sweeping only runs on `open`/`touch`, so an unswept, idle-expired row must not go on
   * authenticating a bearer token just because nobody has logged in since. Does NOT itself slide the
   * named session's idle window — presenting a token is a read of this table, not the activity that
   * keeps a session open; a caller that wants token traffic to do that calls `touch` itself (a phase
   * 7 decision).
   */
  resolveToken(token: string): string | undefined;
  /** The digests `id`'s session currently holds, for observability and testing. Never the secrets. */
  tokenDigests(id: string): readonly string[];
  /** How many sessions are currently open. */
  readonly size: number;
}

const opaque = (): string => randomBytes(32).toString("base64url");
const digestOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const DEFAULTS = {
  idleMs: 30 * 60_000,
  maxSessions: 4096,
  maxTokensPerSession: 16,
};

export function createSessionTable(options: SessionTableOptions = {}): SessionTable {
  const idleMs = options.idleMs ?? DEFAULTS.idleMs;
  const maxSessions = options.maxSessions ?? DEFAULTS.maxSessions;
  const maxTokensPerSession = options.maxTokensPerSession ?? DEFAULTS.maxTokensPerSession;
  const now = options.now ?? ((): number => performance.now());

  const sessions = new Map<string, SessionRow>();
  const tokens = new Map<string, TokenEntry>();

  // Erase a session and every digest it minted from the shared token table. The one path both an
  // explicit `drop` and the idle-sweep in `open` go through, so an abandoned session's tokens never
  // outlive the session row that named them.
  const erase = (id: string, row: SessionRow): void => {
    for (const digest of row.tokenDigests) tokens.delete(digest);
    sessions.delete(id);
  };

  // Remove this session's own token digests that have outlived their TTL. Runs on both `mintToken`
  // and `touch` — minting alone would miss a session that mints once and is then kept alive by
  // ordinary activity for a long time, silently accumulating dead digests.
  const pruneTokens = (row: SessionRow, moment: number): void => {
    for (const digest of row.tokenDigests) {
      const entry = tokens.get(digest);
      if (entry === undefined || entry.expiresAt <= moment) {
        tokens.delete(digest);
        row.tokenDigests.delete(digest);
      }
    }
  };

  const sweepExpired = (moment: number): void => {
    for (const [id, row] of sessions) {
      if (row.expiresAt <= moment) erase(id, row);
    }
  };

  return {
    open(user) {
      const moment = now();
      sweepExpired(moment);
      if (sessions.size >= maxSessions) return undefined;
      const id = opaque();
      sessions.set(id, { user, expiresAt: moment + idleMs, tokenDigests: new Set() });
      return { id };
    },

    touch(id) {
      const row = sessions.get(id);
      if (row === undefined) return undefined;
      const moment = now();
      if (moment > row.expiresAt) {
        erase(id, row);
        return undefined;
      }
      row.expiresAt = moment + idleMs;
      pruneTokens(row, moment);
      return { user: row.user };
    },

    drop(id) {
      const row = sessions.get(id);
      if (row === undefined) return;
      erase(id, row);
    },

    mintToken(id, ttlMs) {
      const row = sessions.get(id);
      if (row === undefined) return undefined;
      const moment = now();
      if (moment > row.expiresAt) {
        erase(id, row);
        return undefined;
      }
      pruneTokens(row, moment);
      if (row.tokenDigests.size >= maxTokensPerSession) return undefined;
      const secret = opaque();
      const digest = digestOf(secret);
      tokens.set(digest, { sessionId: id, expiresAt: moment + ttlMs });
      row.tokenDigests.add(digest);
      return secret;
    },

    resolveToken(token) {
      const digest = digestOf(token);
      const entry = tokens.get(digest);
      if (entry === undefined) return undefined;
      const moment = now();
      if (moment > entry.expiresAt) {
        tokens.delete(digest);
        sessions.get(entry.sessionId)?.tokenDigests.delete(digest);
        return undefined;
      }
      const row = sessions.get(entry.sessionId);
      if (row === undefined) return undefined;
      if (moment > row.expiresAt) {
        // The row has outlived its idle window but nothing has swept it out yet — sweeping only runs
        // on `open`/`touch`. Erase it now rather than letting an unswept row keep authenticating.
        erase(entry.sessionId, row);
        return undefined;
      }
      return row.user;
    },

    tokenDigests(id) {
      const row = sessions.get(id);
      return row === undefined ? [] : [...row.tokenDigests];
    },

    get size() {
      return sessions.size;
    },
  };
}

// --- the login doors (SPEC §36 phase 5) ---------------------------------------------------------

export interface UserDoorOptions {
  /** Where credentials.json lives. */
  readonly home: string;
  /** The mount whose ground holds the user records and role bindings. */
  readonly mount: string;
  /**
   * The store's address as the outside world sees it. Phase 6 builds the same-origin check from
   * it; this phase stores it and consults it for nothing. Defaults to the bound URL.
   */
  readonly publicUrl?: string;
  readonly idleMs?: number; // session idle window (default 30 minutes)
  readonly maxSessions?: number; // signed-in sessions this server will hold (default 4096)
  readonly tokenTtlMs?: number; // /session/token lifetime (default 5 minutes)
  readonly maxTokensPerSession?: number; // live tokens one session may hold (default 16)
  readonly maxConcurrentHashes?: number; // unauthenticated scrypt work in flight (default 4)
  readonly scrypt?: ScryptParams;
  /** A monotonic millisecond source. Injectable so a rail can drive it; never `Date.now()`. */
  readonly monotonicNow?: () => number;
  /**
   * Where a local fault goes — a credentials.json this door cannot read, entries that disagree
   * about cost. The CALLER never sees the detail (it names paths and other users), and a fault
   * nobody is told about is a swallowed error, so the two have to be different channels.
   */
  readonly onFault?: (message: string) => void;
}

export interface UserDoorDeps {
  readonly options: UserDoorOptions;
  /** The public URL, already settled — the bound URL when the operator named none. */
  readonly publicUrl: string;
  /** The mount's ground, re-asked every request: a mount can vanish, and erase re-seats a reactor. */
  ground(): { reactor: Reactor; operator: string | undefined } | undefined;
  /**
   * Mint a short-lived bearer token for an identity the caller has already authorized.
   *
   * `stillLive` is asked on EVERY presentation of the token, not only at mint: a session that
   * lapsed past its idle window must stop authenticating the tokens it bought even when no
   * traffic has swept its row (sweeping runs on `open`/`peek`, so an abandoned session with no
   * further requests would otherwise keep an operator token alive for the rest of its TTL).
   */
  mint(
    identity: { actor?: string; operator?: true },
    ttlMs: number,
    stillLive: () => boolean,
  ): string;
  /** Retire minted tokens by SHA-256 digest (hex) — the plaintext never leaves the response. */
  revoke(digests: readonly string[]): void;
  /**
   * The worlds this server answers right now, other than the doors' own — asked at MINT time
   * rather than remembered from boot, because a container mounts itself and boot never saw it.
   * A session token is server-wide authority, so the mint door refuses while this is non-empty.
   */
  otherWorlds(): readonly string[];
}

export interface UserDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
}

// The `__Host-` prefix is load-bearing, not decoration: a browser refuses to store such a cookie
// unless it is Secure, `Path=/`, and carries NO Domain, which makes it HOST-LOCKED by construction.
// Without it a sibling subdomain can set a `Domain=example.com` cookie of the same name, and the
// browser sends both — so the store would be reading a cookie a neighbour wrote.
export const SESSION_COOKIE = "__Host-loam_session";

// The pre-session nonce lives in its OWN cookie, and that separation is a security property rather
// than tidiness. Sharing one name means `GET /login` — which must set a nonce for an anonymous
// visitor — overwrites a live session id whenever the cookie is not presented. SameSite=Lax
// withholds the cookie on a cross-site subresource request, so any page on the internet could fetch
// /login with credentials, get a fresh nonce written over the operator's session cookie, and sign
// them out. Worse than the logout: the session row survives its idle window with no cookie left to
// reach it.
export const PRESESSION_COOKIE = "__Host-loam_form";

// Pinned, and pinned as ONE STRING: every attribute here is a decision, and computing any of them
// from a request header is how a caller's own Host ends up scoping the operator's cookie.
// SameSite=Lax rather than Strict so a link into the store still arrives signed in; the form token
// (enforced in phase 6) is what makes Lax safe on the POST doors.
export const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/";

// No script, no styles from anywhere, no framing, no form retargeting, no base rewriting. The
// pages carry no script at all; the header is the belt to that braces. One literal — a
// `script-src`-only header would leave the page framable and its form retargetable.
export const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const MAX_BODY = 8 * 1024; // a login form is a few hundred bytes; nothing here needs more

const DOOR_DEFAULTS = {
  idleMs: 30 * 60_000,
  tokenTtlMs: 5 * 60_000,
  maxSessions: 4096,
  maxTokensPerSession: 16,
  maxConcurrentHashes: 4,
};

/**
 * A SIGNED-IN browser session. There is no other kind: the not-yet-signed-in half of a login is
 * stateless (see the form key below), so every row in this map cost a correct password. This map is
 * NOT the phase-4 `SessionTable` — that table has no form-token slot and its token half is phase
 * 7's concern; phase 7 decides how the two meet. Every clock-and-cap property the table proves is
 * railed of this map too (test/server/login-door.test.ts o/p).
 */
interface BrowserSession {
  readonly user: string;
  roles: ReadonlySet<UserRole>;
  readonly formToken: string;
  expiresAt: number;
}

const opaqueId = (): string => randomBytes(32).toString("base64url");

/**
 * The session id a Cookie header carries, or undefined. Never trusts a value's shape.
 *
 * TWO cookies of the same name is not a session, it is an AMBIGUITY, and picking either one is
 * picking whichever an injector managed to place first. So it refuses.
 */
export function sessionIdFrom(req: IncomingMessage): string | undefined {
  return cookieValue(req, SESSION_COOKIE);
}

/** The pre-session nonce a caller presented, by the same one-value discipline. */
export function preSessionIdFrom(req: IncomingMessage): string | undefined {
  return cookieValue(req, PRESESSION_COOKIE);
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) return undefined;
  const values: string[] = [];
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    values.push(pair.slice(eq + 1).trim());
  }
  if (values.length !== 1 || values[0] === "") return undefined;
  return values[0];
}

export const escapeHtml = (raw: string): string =>
  raw.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * The store's own page shell — one look for every page the store serves to a person. Module-level
 * rather than a closure: later phases (§37's consent page) are the same design, and none of them
 * closes over anything.
 */
export const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; font: 16px/1.65 ui-sans-serif, system-ui, sans-serif; color: #2b2620;
         background: #faf7f1; display: grid; min-height: 100vh; place-items: center; }
  main { max-width: 26rem; padding: 2rem 1.5rem 4rem; }
  h1 { font-size: 1.35rem; font-weight: 650; margin: 0 0 1rem; }
  label { display: block; margin: 0.75rem 0; }
  input { display: block; width: 100%; padding: 0.5em; font: inherit; box-sizing: border-box; }
  button { margin-top: 1rem; padding: 0.5em 1.2em; font: inherit; }
  form + form { margin-top: 2rem; }
  p { margin: 0.75rem 0; }
  code { font: 0.92em ui-monospace, "Cascadia Mono", monospace; background: #00000012;
         padding: 0.1em 0.4em; border-radius: 0.3em; word-break: break-all; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6dfd4; background: #1f1b17; }
    code { background: #ffffff1f; }
  }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

const readDoorBody = (req: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        over = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });

// A form POST or a JSON body — both reach the same field map. `URLSearchParams` decodes what
// browsers encode (`+` for space, UTF-8 percent-escapes) and never throws on a mangled escape —
// a typo in a password must be a wrong password, never a 503 through the outer guard.
function formFields(
  body: string | undefined,
  contentType: string | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (body === undefined) return out;
  if ((contentType ?? "").includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") out.set(k, v);
        }
      }
    } catch {
      return out;
    }
    return out;
  }
  for (const [k, v] of new URLSearchParams(body)) out.set(k, v);
  return out;
}

/**
 * Two secrets, compared in time that does not depend on where they first differ. Exported so a
 * later phase's doors compare their tokens the same way — one implementation, because the second
 * one is where somebody writes `===`.
 */
export const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

export function makeUserDoors(deps: UserDoorDeps): UserDoors {
  const options = deps.options;
  const idleMs = options.idleMs ?? DOOR_DEFAULTS.idleMs;
  const maxSessions = options.maxSessions ?? DOOR_DEFAULTS.maxSessions;
  const tokenTtlMs = options.tokenTtlMs ?? DOOR_DEFAULTS.tokenTtlMs;
  const maxTokensPerSession = options.maxTokensPerSession ?? DOOR_DEFAULTS.maxTokensPerSession;
  const maxHashes = options.maxConcurrentHashes ?? DOOR_DEFAULTS.maxConcurrentHashes;
  const digestOf = (token: string): string => createHash("sha256").update(token).digest("hex");
  const scryptParams = options.scrypt ?? DEFAULT_SCRYPT;
  const now = options.monotonicNow ?? ((): number => performance.now());
  const onFault = options.onFault ?? ((message: string): void => void message);

  /**
   * The origins this store answers its own forms from (SPEC §36 phase 6). Exactly the settled
   * public URL's origin — EXCEPT when that URL is loopback, where the equivalent spellings on
   * the SAME port are the same store: a browser at `http://localhost:4321` sends that spelling,
   * and a default of `127.0.0.1` would refuse the operator's own form.
   *
   * WHAT THE WIDENING ADMITS, exactly, because the obvious phrasing overclaims: the same
   * SPELLING on the same port, not necessarily the same PROCESS. `127.0.0.1:P` and `[::1]:P`
   * are distinct bindable sockets, so a store bound to one leaves the other free for a
   * co-resident process, whose page a browser may reach at `http://localhost:P`. Provenance
   * alone does not exclude that page — the form token does (it cannot read this store's form or
   * plant its `__Host-` nonce), which is why both signals are required rather than either. No
   * REMOTE host is ever admitted. Two loud
   * faults, each said once: an UNPARSEABLE public URL yields an empty set (every Origin-bearing
   * POST refuses — failing closed), and an UNROUTABLE one (0.0.0.0, ::) would be a silent
   * universal 403 nobody could diagnose, so the door names --public-url the moment it opens.
   */
  const ownOrigins = ((): ReadonlySet<string> => {
    let url: URL;
    try {
      url = new URL(deps.publicUrl);
    } catch {
      // Precisely what an empty set costs, because the door only consults it when an Origin is
      // PRESENT: a POST naming any origin refuses, and one carrying no Origin still rides the
      // `Sec-Fetch-Site` hint. Saying "every POST refuses" would be a claim the code does not
      // keep (a P5 lens caught the overclaim).
      onFault(
        `the login doors cannot parse the public URL "${deps.publicUrl}", so every POST that ` +
          `names an Origin refuses; only a same-origin fetch-site hint still passes`,
      );
      return new Set();
    }
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
      onFault(
        `the login doors' public URL "${deps.publicUrl}" names a bind-any address no browser ` +
          `ever sends as an Origin, so every POST from a real page would refuse — name the ` +
          `outside address with --public-url`,
      );
    }
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (!loopback.has(url.hostname)) return new Set([url.origin]);
    const port = url.port === "" ? "" : `:${url.port}`;
    return new Set([
      url.origin,
      `${url.protocol}//127.0.0.1${port}`,
      `${url.protocol}//localhost${port}`,
      `${url.protocol}//[::1]${port}`,
    ]);
  })();

  /**
   * Did this POST come from this store's own page? `Origin`, when present and non-empty, is
   * decisive and OUTRANKS `Sec-Fetch-Site` — a caller that names a specific foreign page is
   * believed over a browser hint, and pinning the precedence is what keeps the two checks from
   * being quietly reordered. `Origin: null` refuses OUTRIGHT rather than falling through: the
   * pages forbid framing (`frame-ancestors 'none'`), so no legitimate flow reaches these doors
   * from a sandboxed context, and null is exactly the origin an attacker can select. With no
   * Origin at all, the browser's own Sec-Fetch-Site must say same-origin.
   */
  const fromThisPage = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "") {
      // `Origin: null` (a sandboxed context) lands here and refuses like any foreign origin —
      // "null" can never be in the set. It must NOT fall through to the fetch-site hint: the
      // hint says same-origin for a sandboxed same-origin iframe, and null is exactly the
      // origin an attacker can select.
      return ownOrigins.has(origin);
    }
    return req.headers["sec-fetch-site"] === "same-origin";
  };

  // Said on TRANSITION, not once at boot and not per attempt. The file mutates under a running
  // server (`loam user create`, a hand edit — the exact way uniformity breaks), so a boot-only
  // check would leave the operator untold until the next restart (H7: boot-time silence standing
  // in for present-tense health). Per-attempt would hand a stranger a log to fill on an
  // unauthenticated path. Reporting only when the answer CHANGES is both: at most one line per
  // state change, and no state change a stranger can cause. See `decoyParamsFor`: disagreeing
  // costs leave a timing distinction the decoy hash cannot cover.
  let costDisagreed = false;
  const noteCostAgreement = (file: CredentialsFile): void => {
    const disagree = paramsDisagree(file);
    if (disagree && !costDisagreed) {
      onFault(
        `the entries in ${credentialsPath(options.home)} disagree about scrypt cost, so login ` +
          `timing can tell some of those names apart from an absent one. Re-create those users to ` +
          `even it out.`,
      );
    }
    costDisagreed = disagree;
  };
  try {
    noteCostAgreement(readCredentials(options.home));
  } catch {
    // an unreadable file is the login door's own refusal to make, per attempt, in its own words
  }

  const sessions = new Map<string, BrowserSession>();

  // UNAUTHENTICATED HASH WORK IS CAPPED. scrypt is expensive on purpose, so an anonymous caller
  // must not be able to spend the box's whole threadpool by asking — a burst of POSTs would starve
  // the data doors this phase promises not to touch. One counter for every attempt, known name or
  // not: a smaller share for the unknown-name path would be a username oracle, because the two
  // shares run out at different times. Login is deliberately degradable; the API does not pass
  // through here. Phase 9 rails this cap's interplay with the delay exhaustively.
  let hashesInFlight = 0;

  // Tokens this session minted, held as DIGESTS and never as the secret: a session idles six
  // times a token's own life, so keeping the plaintext to hand back at revocation time would put
  // live operator tokens in the heap far longer than they are valid.
  const minted = new Map<string, { digest: string; expiresAt: number }[]>();

  // A session row and the tokens it bought die TOGETHER, through this one function — and the
  // invariant is STRUCTURAL rather than an inventory: `sessions.delete` appears exactly once in
  // this file, here, so every path that ends a session revokes by construction. (An earlier
  // draft argued this by counting `drop`'s callers, and the count was already wrong the day it
  // was written — a hand-enumeration is the shape that rots. `grep -c "sessions.delete"` is the
  // check that does not.) Attaching revocation to the logout DOOR instead would leave an
  // operator token alive across the idle sweep, a struck role, and the session-fixation drop.
  const drop = (id: string): void => {
    sessions.delete(id);
    const held = minted.get(id);
    if (held !== undefined) {
      minted.delete(id);
      deps.revoke(held.map((m) => m.digest));
    }
  };

  /**
   * The tokens this session holds that are still WITHIN their window. Counting the ones it ever
   * minted would make the cap permanent: a session that reached it could never mint again,
   * however long it waited, while its own idle window kept it alive.
   */
  const liveTokens = (id: string): { digest: string; expiresAt: number }[] => {
    const moment = now();
    const held = (minted.get(id) ?? []).filter((m) => m.expiresAt > moment);
    if (held.length === 0) minted.delete(id);
    else minted.set(id, held);
    return held;
  };

  const sweep = (): void => {
    const moment = now();
    for (const [id, session] of sessions) if (session.expiresAt <= moment) drop(id);
  };

  // The presented session, if it is live, WITHOUT sliding its window — a REFUSED request must
  // not extend a session's life (refused traffic sliding windows would let a cross-site page
  // keep a victim's session alive forever; a premortem caught the salvage doing exactly that).
  // A row past its window is still DELETED on discovery, never merely reported absent, so a
  // later, smaller clock reading cannot revive it.
  const peek = (req: IncomingMessage): { id: string; session: BrowserSession } | undefined => {
    const id = sessionIdFrom(req);
    if (id === undefined) return undefined;
    const session = sessions.get(id);
    if (session === undefined) return undefined;
    if (session.expiresAt <= now()) {
      drop(id);
      return undefined;
    }
    return { id, session };
  };

  // The presented session, ADMITTED: sliding the idle window is what admission means, and this
  // is the only place `expiresAt` moves — a session's death is a property of inactivity and of
  // nothing else.
  const touch = (req: IncomingMessage): { id: string; session: BrowserSession } | undefined => {
    const held = peek(req);
    if (held === undefined) return undefined;
    held.session.expiresAt = now() + idleMs;
    return held;
  };

  /**
   * Open a SIGNED-IN session. Nothing unauthenticated reaches this, which is what makes
   * `maxSessions` a real limit rather than a lever: filling it costs a correct password per seat.
   * A full table refuses; it never evicts a LIVE session to make room.
   *
   * `replacing` is the session the caller presented while re-authenticating (session fixation
   * dies at login). It is dropped HERE, after the cap has answered but discounted from it —
   * dropping it before knowing a seat exists destroyed the caller's live session on a full
   * table's 503, a refusal that concealed an erasure (a P5 lens caught it); and not discounting
   * it would refuse the one login that frees a seat by replacing its own.
   */
  const open = (
    user: string,
    roles: ReadonlySet<UserRole>,
    replacing?: string,
  ): { id: string; session: BrowserSession } | undefined => {
    sweep(); // every open, not only a full table: a lapsed session is not something to hold on to
    const displaced = replacing !== undefined && sessions.has(replacing) ? 1 : 0;
    if (sessions.size - displaced >= maxSessions) return undefined;
    if (replacing !== undefined) drop(replacing);
    const id = opaqueId();
    const moment = now();
    sessions.set(id, { formToken: opaqueId(), expiresAt: moment + idleMs, user, roles });
    return { id, session: sessions.get(id)! };
  };

  /**
   * THE PRE-SESSION IS STATELESS, and that is a security property rather than an economy. A login
   * form needs a cookie the browser will send back and a token in the body that proves the form
   * came from this store's own page. Neither needs a row in a table: the cookie carries a random
   * nonce, and the form token is an HMAC of that nonce under a key minted at boot. `GET /login`
   * therefore allocates nothing a flood could fill. The key dies with the process, which is also
   * what makes a restart invalidate every form in flight. Phase 6 is where the token becomes a
   * refusal; this phase issues and carries it so phase 6 changes only what the door REFUSES.
   */
  const formKey = randomBytes(32);
  const preSessionToken = (nonce: string): string =>
    createHmac("sha256", formKey).update(nonce).digest("base64url");

  const json = (res: ServerResponse, status: number, body: unknown, cookie?: string): void => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(JSON.stringify(body));
  };

  const html = (
    res: ServerResponse,
    status: number,
    body: string,
    cookie?: string | string[],
  ): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  const setCookie = (id: string): string => `${SESSION_COOKIE}=${id}; ${COOKIE_ATTRIBUTES}`;
  const clearCookie = (): string => `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
  const setPreCookie = (nonce: string): string =>
    `${PRESESSION_COOKIE}=${nonce}; ${COOKIE_ATTRIBUTES}`;
  const clearPreCookie = (): string => `${PRESESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;

  // The login door's ONE refusal, whatever went wrong behind it: an unknown user, a wrong
  // password, a user the ground holds no role for. Anything finer would be an oracle.
  const refuseLogin = (res: ServerResponse): void =>
    json(res, 401, { errors: ["the login was refused"] });

  // The provenance refusal (SPEC §36 phase 6) — its own shape, distinct from the login refusal:
  // it refuses the REQUEST's origin, not the credential, and it fires before any credential is
  // read. It names the cure because every NON-attack path to it — a form issued before a
  // restart (the boot key died with the process), a stale tab — is fixed by a fresh form, and
  // an operator reading a bare attack accusation after a deploy files an outage.
  const notThisPage = (res: ServerResponse): void =>
    json(res, 403, {
      errors: [
        "this request did not come from this store's own page, so it is refused — reload the " +
          "page and try again",
      ],
    });

  /**
   * The POST doors' shared preamble (SPEC §36 phase 6), in a pinned order:
   *   1. provenance — refused before any session read, any hash, any parse;
   *   2. drain — the body is read regardless, so an early refusal leaves no bytes on a
   *      keep-alive socket for the next request to trip over (draining is not parsing);
   *   3. the token compare, timing-safe: the session's own token when a live session is
   *      presented (peeked, not slid), else the HMAC of the presented pre-session nonce.
   * Only a caller that clears every step is ADMITTED — and admission, not presentation, is what
   * slides a session's idle window. It answers the refusals itself, so no door can skip a step
   * by forgetting one.
   */
  const guarded = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<
    | {
        readonly held: { id: string; session: BrowserSession } | undefined;
        readonly body: Map<string, string>;
      }
    | undefined
  > => {
    if (!fromThisPage(req)) {
      await readDoorBody(req); // drain: the refusal must not leave the socket dirty
      notThisPage(res);
      return undefined;
    }
    const body = formFields(await readDoorBody(req), req.headers["content-type"]);
    const presented = body.get("form_token") ?? "";
    const held = peek(req);
    if (held !== undefined) {
      if (!sameSecret(presented, held.session.formToken)) {
        notThisPage(res);
        return undefined;
      }
      // NO SLIDE HERE. Clearing the guard is not admission — `postLogin` can still answer 401
      // (wrong password, no role) or 503 (busy, unreadable credentials, unreachable ground,
      // full table) behind it, and a request the door REFUSES must not have extended the
      // session's life on its way to being refused (a P5 lens caught this contradicting the
      // invariant the peek/touch split exists for). The doors that genuinely admit slide it
      // themselves: `getLogin` through `touch`, and a successful login opens a NEW row.
      return { held, body };
    }
    const nonce = preSessionIdFrom(req);
    if (nonce === undefined || !sameSecret(presented, preSessionToken(nonce))) {
      notThisPage(res);
      return undefined;
    }
    return { held: undefined, body };
  };

  const cannotDecide = (res: ServerResponse, what: string): void =>
    json(res, 503, { errors: [what] });

  const loginPage = (formToken: string): string =>
    page(
      "sign in to a Loam store",
      `<h1>Sign in.</h1>
<form method="post" action="/login">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<label>user<input name="user" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
<label>password<input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">sign in</button>
</form>
<p>A session opens the pages here. It cannot open the data doors — those ask for a token a later
page will offer.</p>`,
    );

  const signedInPage = (user: string, roles: ReadonlySet<UserRole>, formToken: string): string =>
    page(
      "signed in to a Loam store",
      `<h1>Signed in.</h1>
<p>You are <code>${escapeHtml(user)}</code>, and you hold ${
        roles.size === 0
          ? "no roles here"
          : `the ${[...roles]
              .sort()
              .map((role) => `<code>${escapeHtml(role)}</code>`)
              .join(", ")} role${roles.size === 1 ? "" : "s"} here`
      }.</p>
<form method="post" action="/logout">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<button type="submit">sign out</button>
</form>`,
    );

  const signedOutPage = (): string =>
    page(
      "signed out of a Loam store",
      `<h1>Signed out.</h1>
<p>The session is gone from this store's memory. <a href="/login">Sign in again.</a></p>`,
    );

  /**
   * WHAT THE PRESENTED SESSION'S USER STILL IS, re-read from the ground — and "cannot decide" is
   * NOT "gone". `rolesOf` returns an empty set for a role-less user AND for a store whose operator
   * it cannot name; the read has no fault channel. So the door never interprets an empty set
   * alone: an unresolvable mount or an operator-less ground answers `undefined` here (a 503 at
   * the caller), and only a ground that NAMES its operator and then answers empty is "gone".
   */
  const groundRoles = (user: string): ReadonlySet<UserRole> | undefined => {
    const ground = deps.ground();
    if (ground === undefined || ground.operator === undefined) return undefined;
    return rolesOf(ground.reactor, ground.operator, user);
  };

  const getLogin = (req: IncomingMessage, res: ServerResponse): void => {
    const held = touch(req);
    if (held !== undefined) {
      // Re-read the roles from the ground rather than printing the session's copy. A role revoked,
      // or a user erased, after signing in must not leave this store's own page telling the caller
      // they still hold it.
      const roles = groundRoles(held.session.user);
      if (roles === undefined) {
        // CANNOT DECIDE IS NOT "FORGOTTEN". Dropping the session here would destroy an
        // authenticated caller's state over a local condition this door could not evaluate.
        // Refuse, and leave the session exactly as it was.
        cannotDecide(res, "this store's ground is not reachable, so this page cannot load");
        return;
      }
      if (roles.size > 0) {
        held.session.roles = roles;
        html(res, 200, signedInPage(held.session.user, roles, held.session.formToken));
        return;
      }
      drop(held.id); // the ground answered, and it holds no role for this user (or no user at all)
    }
    // The form, on a stateless pre-session. An EXISTING cookie value is reused as the nonce, so
    // reloading the page does not change the token a half-filled form already carries; otherwise a
    // fresh one. Either way no table grows, so this path cannot be flooded into refusing.
    const nonce = preSessionIdFrom(req) ?? opaqueId();
    html(res, 200, loginPage(preSessionToken(nonce)), setPreCookie(nonce));
  };

  const postLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The phase-6 preamble: provenance, drain, token — refused before the name is read, before
    // the hash gate, before the ground. A cross-site POST can therefore neither spend a hash
    // nor (once phase 9 lands) fill a counter.
    const guard = await guarded(req, res);
    if (guard === undefined) return;
    const body = guard.body;
    const user = body.get("user") ?? "";
    const password = body.get("password") ?? "";
    if (userNameDefect(user) !== undefined) {
      // Not a name any user could hold, so there is nothing to hash and nothing to count.
      refuseLogin(res);
      return;
    }
    // THE CHECK AND THE INCREMENT HAVE NO AWAIT BETWEEN THEM: a cap read before an await would be
    // a measurement taken before the work it authorizes. A refusal here spends no hash.
    if (hashesInFlight >= maxHashes) {
      json(res, 503, {
        errors: ["the login door is busy: too much unauthenticated work is already in flight"],
      });
      return;
    }
    let credentials;
    try {
      credentials = readCredentials(options.home);
    } catch (err) {
      // The door could not DECIDE. That is never a match. The DETAIL names the home's path, so it
      // goes to the operator's own channel and never to the caller.
      onFault(
        `the login door cannot read ${credentialsPath(options.home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      cannotDecide(res, "the login door cannot read its credentials, so it refuses every login");
      return;
    }
    noteCostAgreement(credentials);
    const entry = entryFor(credentials, user);
    let matched: boolean;
    hashesInFlight += 1;
    try {
      // A NAME NOBODY HOLDS still costs a hash, so a miss and an unknown user take the same time.
      // No branch above this point answered differently for the two, and none below does either.
      matched =
        entry === undefined
          ? await spendDecoyHash(password, decoyParamsFor(credentials, scryptParams))
          : await verifyPassword(entry, password);
    } catch (err) {
      onFault(
        `the login door could not verify a credential: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      cannotDecide(res, "the login door cannot read its credentials, so it refuses every login");
      return;
    } finally {
      hashesInFlight -= 1;
    }
    if (!matched) {
      refuseLogin(res);
      return;
    }
    // The password was right. The GROUND still has to hold a role for this user — `rolesOf`
    // answers empty both for an erased user record and for a live record with no role binding,
    // and the door refuses both the same way (erasing a user must actually shut the door, and the
    // credential file cannot know that it was erased).
    const roles = groundRoles(user);
    if (roles === undefined) {
      cannotDecide(res, "this store's ground is not reachable, so no session opens");
      return;
    }
    if (roles.size === 0) {
      refuseLogin(res);
      return;
    }
    // A NEW id, and any session presented dies with the old cookie value: a session must never
    // survive its own authentication (session fixation — an attacker who plants a cookie value
    // would otherwise be holding a live session id once the victim signs in). The drop happens
    // INSIDE open, only once a seat is certain — a full table's refusal must leave the presented
    // session exactly as it was.
    const opened = open(user, roles, guard.held?.id);
    if (opened === undefined) {
      cannotDecide(res, "this store is holding all the sessions it can");
      return;
    }
    // The browser is told to drop the nonce cookie; the pair itself stays verifiable until the
    // process restarts — the pre-session is stateless, so nothing can spend it server-side.
    html(res, 200, signedInPage(user, roles, opened.session.formToken), [
      setCookie(opened.id),
      clearPreCookie(),
    ]);
  };

  const postLogout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The same pinned order as `guarded`, with one door-specific step between drain and token:
    // SESSION PRESENCE ANSWERS FIRST, with phase 5's exact 401 — session absence outranks token
    // absence once provenance has passed (the frozen phase-5 rail pins it, and the caller has
    // already proved same-origin, so the 401 reveals nothing it should not).
    if (!fromThisPage(req)) {
      await readDoorBody(req); // drain: the refusal must not leave the socket dirty
      notThisPage(res);
      return;
    }
    const body = formFields(await readDoorBody(req), req.headers["content-type"]);
    const held = peek(req);
    if (held === undefined) {
      json(res, 401, { errors: ["no live session is presented here"] });
      return;
    }
    if (!sameSecret(body.get("form_token") ?? "", held.session.formToken)) {
      notThisPage(res);
      return;
    }
    drop(held.id);
    html(res, 200, signedOutPage(), [clearCookie(), clearPreCookie()]);
  };

  const postToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guarded(req, res);
    if (guard === undefined) return;
    if (guard.held === undefined) {
      // A stateless pre-session is enough to ATTEMPT a login. It is not enough to mint: there is
      // no session behind it whose authority a token could carry.
      json(res, 401, { errors: ["no live session is presented here"] });
      return;
    }
    const { id, session } = guard.held;
    // ONE MOUNT, asked NOW. A container mounts itself, so boot's guard never saw it; a token
    // minted here is `{operator: true}` over the whole server, and handing that to a world no
    // role binding named is the widening this refuses. Named, so the operator can act on it.
    const others = deps.otherWorlds();
    if (others.length > 0) {
      json(res, 503, {
        errors: [
          `this server is answering ${others.length === 1 ? "another world" : "other worlds"} — ` +
            `[${others.join(", ")}] — and a session token is authority over all of them, which ` +
            `no role binding here granted. No token is minted while they are mounted.`,
        ],
      });
      return;
    }
    // Re-read the roles rather than trusting the session's copy: a role revoked, or a user
    // erased, after sign-in must stop minting on the next ask rather than the next restart.
    const roles = groundRoles(session.user);
    if (roles === undefined) {
      cannotDecide(res, "this store's ground is not reachable, so no token is minted");
      return;
    }
    if (roles.size === 0) {
      // The ground answered and holds nothing for this user: the session goes, and with it every
      // token it minted.
      drop(id);
      json(res, 401, { errors: ["this store no longer holds a record of that user"] });
      return;
    }
    if (!roles.has("operator")) {
      json(res, 403, {
        errors: [
          `${session.user} does not hold the operator role on this store, so no token is ` +
            `minted — §36 ships the operator role only`,
        ],
      });
      return;
    }
    // LIVE tokens, counted now — a lapsed one frees its slot, or the advice below is a lie.
    const held = liveTokens(id);
    if (held.length >= maxTokensPerSession) {
      json(res, 429, {
        errors: [
          `this session already holds ${held.length} live tokens — sign out, or wait for one ` +
            `to lapse`,
        ],
      });
      return;
    }
    // WHOSE NAME goes on this session's writes (SPEC §36 phase 8). The user's OWN seed, read
    // HERE rather than at login: a seed written between sign-in and mint is picked up now, one
    // deleted is refused now, and no signing key sits in a session row for its whole idle life.
    //
    // FAILING CLOSED IS THE WHOLE POINT. Falling back to the store's seed would attribute this
    // person's writes to the store — the exact confusion this phase exists to end, and a lie
    // about provenance no reader could detect afterwards. So an absent or unreadable seed
    // refuses the mint by name.
    // THREE STATES, not two. `readUserSeed` answers a two-state question — no file, or a file it
    // could not read — and a seed file has a third: present, readable, and not a key (a crashed
    // write leaves it zero-byte; a hand-edit truncates it). Treating that as `present` mints
    // `{actor: ""}`, which is not nullish, so nothing downstream falls back and the failure
    // surfaces as an opaque error at the first write instead of a refusal here. So the shape is
    // checked at this door — the same 64-hex rule `initHome` writes.
    const seed = readUserSeed(options.home, session.user);
    const malformed = seed.kind === "present" && !/^[0-9a-f]{64}$/.test(seed.seed);
    if (seed.kind !== "present" || malformed) {
      if (seed.kind === "unreadable" || malformed) {
        onFault(
          `the login door cannot use ${userSeedPath(options.home, session.user)}: ` +
            (seed.kind === "unreadable"
              ? seed.detail
              : "it is present but is not a 64-character hex signing key"),
        );
      }
      json(res, 409, {
        errors: [
          `${session.user} holds the operator role but has no signing key on this box, so no ` +
            `token is minted — a session must write under its own name, never the store's. ` +
            `Run \`loam user assign-role ${session.user} --role=operator\` here to mint one.`,
        ],
      });
      return;
    }
    // WHAT THIS TOKEN IS, exactly: the operator's authority on this server, for `tokenTtlMs`,
    // signing as THIS USER. Both halves are deliberate — the `operator` flag opens the doors the
    // role earns (register, health, federate, artifact), and the actor seed decides whose name
    // goes on what the doors sign. Dropping the flag would be a silent NARROWING dressed as
    // attribution; dropping the seed is the provenance lie above. Per §9a every operator is
    // equivalent, so this buys attribution and never privilege separation.
    //
    // Dropping the session retires the token early; nothing else does. So revoking a user's role
    // closes the door to NEW tokens at once, and an already-minted one lives out its window.
    // The liveness question the token table asks on every presentation. It reads the row
    // directly rather than through `peek`, because answering must not itself drop or slide
    // anything — and it must stay true to the rule the session table states: an unswept,
    // idle-expired row does not go on authenticating just because nobody has logged in since.
    const stillLive = (): boolean => {
      const row = sessions.get(id);
      return row !== undefined && row.expiresAt > now();
    };
    const token = deps.mint({ actor: seed.seed, operator: true }, tokenTtlMs, stillLive);
    minted.set(id, [...held, { digest: digestOf(token), expiresAt: now() + tokenTtlMs }]);
    // `expiresIn` is derived from the RECORDED deadline, not from the configured TTL: the
    // table's clock read happened inside `mint`, before this line, so reporting the raw TTL
    // would promise a lifetime past the token's real death by this request's own latency.
    const expiresAt = now() + tokenTtlMs;
    json(res, 200, {
      token,
      expiresIn: Math.max(0, Math.floor((expiresAt - now()) / 1000)),
      user: session.user,
      roles: [...roles].sort(),
    });
  };

  const route = async (
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (pathname === "/login" && req.method === "GET") {
      getLogin(req, res);
      return;
    }
    if (req.method !== "POST") {
      json(res, 405, {
        errors: [
          pathname === "/login" ? "/login answers GET and POST" : `${pathname} answers POST`,
        ],
      });
      return;
    }
    if (pathname === "/login") return postLogin(req, res);
    if (pathname === "/logout") return postLogout(req, res);
    return postToken(req, res);
  };

  return {
    owns: (pathname) =>
      pathname === "/login" || pathname === "/logout" || pathname === "/session/token",
    async handle(pathname, req, res) {
      // ONE GUARD OVER THE DOORS, because "the caller never sees the detail" has to hold for a
      // fault nobody anticipated too. Without it a throw from the ground read escapes to the
      // server's generic handler — which answers 500 with the message, and those messages can
      // carry the home's absolute path. Per-call-site try blocks would each be one omission away
      // from the same leak.
      try {
        await route(pathname, req, res);
      } catch (err) {
        onFault(
          `the login door failed answering ${pathname}: ` +
            `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        if (!res.headersSent) {
          json(res, 503, {
            errors: ["the login door could not answer, and it says no rather than why"],
          });
        } else {
          res.end();
        }
      }
    },
  };
}
