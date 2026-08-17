// The login doors (SPEC §36 phases 5–7): sessions in server memory, and the routes where a person
// trades a password for one — GET /login, POST /login, POST /logout, POST /session/token.
//
// COOKIE AUTHORITY IS CONFINED TO THESE DOORS. A cookie is ambient — the browser attaches it to
// any request any page makes — so a session that opened a data door would hand every page on the
// internet a forgeable credential. http.ts states the invariant: authority on the data doors is a
// bearer header the caller presents explicitly, never a cookie. A session opens the store's own
// PAGES; the bearer bridge is how a browser asks for a token instead.
//
// SESSIONS ARE ONE PROCESS'S STATE, DELIBERATELY. `sessions` below is a plain `Map` allocated per
// `serve()` call, with no persistence and no cross-process coherence: a restart, or a second replica
// behind a load balancer, sees an empty table. That is the deliberate shape for one operator on one
// box (§9a) — a clustered deployment is a different ticket's decision.
//
// THE CLOCK IS MONOTONIC, and that is a security property, not a style choice. `Date.now()` is a
// wall clock a caller or the OS can step backward (a manual change, an NTP correction); if an expiry
// check ever read a SMALLER "now" than an earlier read, an already-expired session would look like it
// had gained time back, which is a backward clock step reading as an extension of the session's
// life. `performance.now()` — the default here — is guaranteed non-decreasing within one process, so
// the default clock cannot produce that. The doors also do not rely on the guarantee alone: a row
// is deleted the moment it is found past its idle window, so even a clock that goes backward later
// (an injected test clock, or a future clock source with a weaker guarantee) has no live row left to
// revive.
//
// AND AN UNSWEPT ROW DOES NOT GO ON AUTHENTICATING. Sweeping runs only when someone logs in or
// presents a cookie, so a session nobody has touched since it lapsed is still SITTING in the map.
// Every question asked of a row therefore compares its own idle expiry, rather than trusting that
// something has already removed it — `peek` here, and `stillLive` on behalf of the token table in
// http.ts, which would otherwise keep an abandoned session's operator token alive for the rest of
// its TTL with no cookie left to reach it.
//
// `idleMs` and `ttlMs` are DURATIONS in milliseconds, always added to a `now()` reading inside this
// file — never compared against one directly. A caller passing an absolute timestamp (a `Date.now()`
// value) where a duration is expected would mint an effectively immortal session or token; nothing
// in this file's own defaults does that, but nothing type-checks it away either.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Reactor } from "@bombadil/rhizomatic";
import { CACHE_NO_STORE, endJson } from "./respond.js";
import { parseLoginBodyFields as formFields, readBodyLenient } from "./body.js";
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
import { CONTINUE_FIELD, authorizeContinuation, resumeTarget } from "./continuation.js";
import {
  DEFAULT_LIMIT,
  delayMs,
  forgetFailures,
  locksPath,
  noteFailure,
  type LimitPolicy,
} from "./login-locks.js";
// The home's layout — where a per-user signing seed lives — is `cli/config`'s to spell, and
// spelling it a second time here is how two paths drift apart. Phase 3 writes these files; this
// door only reads them.
import { readUserSeed, userSeedPath } from "../cli/config.js";

export interface UserDoorOptions {
  /** Where credentials.json lives. */
  readonly home: string;
  /** The mount whose ground holds the user records and role bindings. */
  readonly mount: string;
  /**
   * The store's address as the outside world sees it. Defaults to the bound URL. This is the
   * SOLE source of `ownOrigins`, the set every POST door's provenance check consults, so what
   * this holds decides which POSTs are refused: name an address a browser will never send as an
   * `Origin` (a bind-any `0.0.0.0`, an unparseable string) and real pages get a universal 403.
   * See `ownOrigins` for the loopback widening and for the two faults that say so out loud.
   */
  readonly publicUrl?: string;
  readonly idleMs?: number; // session idle window (default 30 minutes)
  readonly maxSessions?: number; // signed-in sessions this server will hold (default 4096)
  readonly tokenTtlMs?: number; // /session/token lifetime (default 5 minutes)
  readonly maxTokensPerSession?: number; // live tokens one session may hold (default 16)
  readonly maxConcurrentHashes?: number; // unauthenticated scrypt work in flight (default 4)
  readonly scrypt?: ScryptParams;
  /** The failed-login delay policy (SPEC §36 phase 9). Defaults to `DEFAULT_LIMIT`. */
  readonly limit?: LimitPolicy;
  /**
   * The WALL clock the failed-login delay reads and writes into `login-locks.json` — separate from
   * `monotonicNow`, which times the session table. It is wall clock on purpose: the record outlives
   * the process and `loam user unlock` reads it from another one, so a monotonic origin would mean
   * nothing to either. Injectable so a rail can step it; defaults to `Date.now`.
   */
  readonly limitNow?: () => number;
  /**
   * How the pre-compare wait is served. Defaults to a bare monotonic timer (`setTimeout`), which is
   * driven by a monotonic clock so a wall-clock step cannot shorten a wait in flight. Injectable so
   * a rail can gate it and prove a waiting attempt is in flight without a real sleep.
   */
  readonly waitFor?: (ms: number) => Promise<void>;
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
  ): { readonly token: string; readonly expiresAt: number };
  /** Retire minted tokens by SHA-256 digest (hex) — the plaintext never leaves the response. */
  revoke(digests: readonly string[]): void;
  /**
   * The worlds this server answers right now, other than the doors' own — asked at MINT time
   * rather than remembered from boot, because a container mounts itself and boot never saw it.
   * A session token is server-wide authority, so the mint door refuses while this is non-empty.
   */
  otherWorlds(): readonly string[];
}

/** What a live session tells another of this store's own pages about the person behind it. */
export interface SessionView {
  readonly user: string;
  /** The session's form token — a later phase's POST presents it under the same phase-6 check. */
  readonly formToken: string;
}

/**
 * The session machinery another of this store's own pages reuses (SPEC §37 phase 14 — the consent
 * page). It exposes exactly what a second page needs to sit behind the SAME phase-5 session and the
 * SAME phase-6 provenance check, and nothing that would let it mint or slide a session it should not.
 * It is a READ of the login doors' state; it adds no precondition to `/login`, `/logout` or
 * `/session/token`.
 */
export interface SessionGate {
  /** The live session for this request, WITHOUT sliding its window — a refused POST must not extend it. */
  peek(req: IncomingMessage): SessionView | undefined;
  /** The live session, ADMITTED — reaching a page is activity, so this slides the idle window. */
  admit(req: IncomingMessage): SessionView | undefined;
  /** Phase-6 provenance: did this request come from this store's own page? */
  fromThisPage(req: IncomingMessage): boolean;
  /**
   * The stateless login form to render when no session is presented, and the pre-session cookie to
   * set. `continuation` is a filtered authorize QUERY the form round-trips (T148) — the login POST
   * re-attaches it to the authorize path itself, so a person who signs in here resumes consent
   * instead of landing on a page that forgot where they were going.
   */
  loginForm(
    req: IncomingMessage,
    continuation?: string,
  ): { readonly body: string; readonly cookie: string };
}

export interface UserDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The session gate a sibling page (the §37 consent page) reuses. */
  readonly gate: SessionGate;
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
 * stateless (see the form key below), so every row in this map cost a correct password.
 *
 * THIS MAP IS THE ONLY SESSION TABLE. The token half it buys lives one layer up, in http.ts, where
 * the bearer header is read — a session token names a server-wide IDENTITY and is re-checked
 * against the live world set on every presentation, neither of which is a session's own business.
 *
 * The two are joined at three points, and the third is easy to miss: `deps.mint` and `deps.revoke`
 * are calls OUT, while `stillLive` is a callback the token table holds and asks on every
 * presentation — so this map keeps deciding a token's fate long after minting returned. Revocation
 * and `stillLive` are independent guarantees, not one restated (session-token.test.ts (f) and (e)
 * rail them separately). The clock-and-cap properties are railed of this map in
 * test/server/login-door.test.ts (o/p) and of the tokens in test/server/session-token.test.ts
 * (e/f/f2/g).
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
function sessionIdFrom(req: IncomingMessage): string | undefined {
  return cookieValue(req, SESSION_COOKIE);
}

/** The pre-session nonce a caller presented, by the same one-value discipline. */
function preSessionIdFrom(req: IncomingMessage): string | undefined {
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

/** session's cap is a door decision (8 KiB — a login form is a few hundred bytes). */
const readDoorBody = (req: IncomingMessage): Promise<string | undefined> =>
  readBodyLenient(req, MAX_BODY);

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
  const limit = options.limit ?? DEFAULT_LIMIT;
  // The WALL clock the delay writes into login-locks.json, distinct from `now` (the session table's
  // monotonic source). See the option's doc for why it must be wall clock.
  const limitNow = options.limitNow ?? ((): number => Date.now());
  // A bare monotonic timer, so a wall-clock step cannot shorten a wait already in flight. It serves
  // no queue: a caller holding many sockets has all their waits elapse together — see DEFAULT_LIMIT.
  const waitFor =
    options.waitFor ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

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

  // THE NEAR-MISS FAULT (T145). A refused Origin whose HOST matches one of this store's own
  // origins but whose scheme or port does not is almost never an attack — it is the funnel shape
  // (a TLS terminator or proxy in front of the store) with --public-url naming the store's side
  // of the proxy instead of the browser's. Without this line, that misconfiguration is a silent
  // universal 403 nobody can diagnose (the exact failure §36.6 already names for 0.0.0.0). Said
  // on TRANSITION, like `noteCostAgreement` below — but where the credential file can change
  // under a running server, --public-url cannot change without a restart, so the disagreement
  // state can only ever be DISCOVERED, never repaired, in this process's lifetime. The latch is
  // therefore one-way: exactly one line per process, and nothing a stranger can pump — a reset
  // on the next agreeing Origin would let any bare client alternate a matching and a near-miss
  // Origin by hand and fill the operator's channel. The refusal the CALLER sees is untouched.
  let publicUrlDisagreed = false;
  const notePublicUrlDisagreement = (origin: string): void => {
    if (publicUrlDisagreed) return;
    let sent: URL;
    try {
      sent = new URL(origin);
    } catch {
      return; // "null" and other non-URL origins carry no address to disagree with
    }
    for (const own of ownOrigins) {
      const settled = new URL(own);
      if (settled.hostname !== sent.hostname) continue;
      publicUrlDisagreed = true;
      const differs: string[] = [];
      if (sent.protocol !== settled.protocol) differs.push("scheme");
      if (sent.port !== settled.port) differs.push("port");
      onFault(
        `a POST was refused because its Origin "${origin}" differs from this store's own ` +
          `origin "${own}" only in ${differs.join(" and ")} — the browser likely reaches ` +
          `this store through an address --public-url does not name; set --public-url to ` +
          `the address in the browser's location bar`,
      );
      return;
    }
  };

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
      if (ownOrigins.has(origin)) return true;
      notePublicUrlDisagreement(origin);
      return false;
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

  // THE FAILED-LOGIN DELAY'S WRITES FAIL OPEN, both of them, because this door promises a correct
  // password is always admitted. `readLocks` treats a file it cannot read as no records; the writes
  // have to agree. Unguarded a write throws to the outer handler, which answers 503 — so an
  // unwritable home, ENOSPC, or a directory at login-locks.json would refuse a CORRECT password,
  // the one thing this design forbids. FAIL-OPEN MEANS NO BUDGET AT ALL: a name with no row waits
  // zero for as long as the fault lasts, and a name with a row keeps paying its wait but can no
  // longer grow OR clear it, until `forgetMs` of silence retires the row on read. The fault goes to
  // the operator's own channel; the caller's answer does not move. Never `await` here: the read,
  // increment and write in `noteFailure` are one synchronous step by design (H1-shaped: a snapshot
  // carried across an await would let two overlapping attempts share one count).
  const recordFailure = (name: string): void => {
    try {
      noteFailure(options.home, name, limitNow(), limit);
    } catch (err) {
      onFault(
        `the login door could not record a failed attempt in ${locksPath(options.home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const forgetCount = (name: string): void => {
    try {
      forgetFailures(options.home, name);
    } catch (err) {
      onFault(
        `the login door could not clear a failure count in ${locksPath(options.home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // Tokens this session minted, held as DIGESTS and never as the secret: a session idles six
  // times a token's own life, so keeping the plaintext to hand back at revocation time would put
  // live operator tokens in the heap far longer than they are valid.
  const minted = new Map<string, { digest: string; expiresAt: number }[]>();

  // A session row and the tokens it bought die TOGETHER, through this one function — and the
  // invariant is STRUCTURAL rather than an inventory: `sessions.delete` appears exactly once in
  // this file, here, so every path that ends a session revokes by construction. (An earlier
  // draft argued this by counting `drop`'s callers, and the count was already wrong the day it
  // was written — a hand-enumeration is the shape that rots. `grep -cE '^\s+sessions\.delete\('`
  // is the check that does not; it counts CALL SITES, so these sentences do not inflate their own
  // answer.) Attaching revocation to the logout DOOR instead would leave an
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
   * what makes a restart invalidate every form in flight. The token becomes a REFUSAL in the POST
   * doors' preamble, which recomputes this HMAC over the cookie's nonce and compares it.
   */
  const formKey = randomBytes(32);
  const preSessionToken = (nonce: string): string =>
    createHmac("sha256", formKey).update(nonce).digest("base64url");

  const json = (res: ServerResponse, status: number, body: unknown, cookie?: string): void =>
    endJson(res, status, body, {
      // The login door's policy: a refusal never hosts a form, so no-referrer is safe, and an
      // auth answer must not be cached by an intermediary.
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });

  const html = (
    res: ServerResponse,
    status: number,
    body: string,
    cookie?: string | string[],
  ): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": CACHE_NO_STORE,
      // Never no-referrer on a form-hosting page: it makes Chrome serialize the form POST's
      // Origin as "null", and fromThisPage refuses null outright (T143). same-origin keeps a
      // real Origin and still sends nothing cross-origin.
      "referrer-policy": "same-origin",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  const setCookie = (id: string): string => `${SESSION_COOKIE}=${id}; ${COOKIE_ATTRIBUTES}`;
  const clearCookie = (): string => `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
  const setPreCookie = (nonce: string): string =>
    `${PRESESSION_COOKIE}=${nonce}; ${COOKIE_ATTRIBUTES}`;
  const clearPreCookie = (): string => `${PRESESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;

  // Is this POST a browser's own form submission, rather than a JSON caller (T146)? Both signals
  // are required, and the ACCEPT half is the load-bearing one: every JSON-shaped rail and API
  // caller sends fetch's default accept (star-slash-star) or `application/json`, while a real
  // browser's form navigation asks for `text/html` first — and the frozen referrer-policy rail
  // pins a form-urlencoded refusal WITHOUT that accept as JSON with `no-referrer`, so the
  // content-type alone must never flip the answer. A JSON caller's bytes therefore never move.
  // `text/html` must be the FIRST media range: a caller whose accept merely tolerates HTML
  // behind JSON (`application/json, text/html;q=0.1`) is a JSON caller, and a browser's form
  // navigation always leads with text/html.
  const isFormNavigation = (req: IncomingMessage): boolean => {
    const contentType = req.headers["content-type"];
    const accept = req.headers.accept;
    return (
      typeof contentType === "string" &&
      /^application\/x-www-form-urlencoded\b/i.test(contentType) &&
      typeof accept === "string" &&
      /^text\/html\b/i.test(accept.split(",")[0]!.trim())
    );
  };

  /**
   * The form token an HTML refusal may honestly re-render (T146): the presented session's own,
   * else the HMAC of the presented pre-session nonce — recomputed under the CURRENT boot key, so
   * the re-rendered form works even when the refusal was a stale form from before a restart. No
   * cookie is ever SET on a refusal; with nothing presented, there is no honest token and the
   * page carries a link to /login instead of a form.
   */
  const refusalFormToken = (req: IncomingMessage): string | undefined => {
    const held = peek(req);
    if (held !== undefined) return held.session.formToken;
    const nonce = preSessionIdFrom(req);
    if (nonce !== undefined) return preSessionToken(nonce);
    return undefined;
  };

  /**
   * ONE refusal, two frames (T146). The message is the whole information content in both: the
   * JSON caller gets the exact bytes this door has always answered, and a browser's form POST
   * gets the sign-in page again with the SAME sentence inline — never finer, so no oracle opens.
   * The HTML rides the `html` helper (CSP, no-store, same-origin referrer policy), sets no
   * cookie, and keeps the JSON status.
   */
  const refuseDoor = (
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    message: string,
    user = "",
    continuation?: string,
  ): void => {
    if (!isFormNavigation(req)) {
      json(res, status, { errors: [message] });
      return;
    }
    const formToken = refusalFormToken(req);
    html(
      res,
      status,
      formToken === undefined
        ? page(
            "sign in to a Loam store",
            `<h1>Sign in.</h1>\n<p>${escapeHtml(message)}</p>\n` +
              `<p><a href="/login">Go to the sign-in page.</a></p>`,
          )
        : loginPage(formToken, { refusal: message, user }, continuation),
    );
  };

  // The login door's ONE refusal, whatever went wrong behind it: an unknown user, a wrong
  // password, a user the ground holds no role for. Anything finer would be an oracle.
  const LOGIN_REFUSED = "the login was refused";

  // The provenance refusal (SPEC §36 phase 6) — its own shape, distinct from the login refusal:
  // it refuses the REQUEST's origin, not the credential, and it fires before any credential is
  // read. It names the cure because every NON-attack path to it — a form issued before a
  // restart (the boot key died with the process), a stale tab — is fixed by a fresh form, and
  // an operator reading a bare attack accusation after a deploy files an outage.
  const NOT_THIS_PAGE =
    "this request did not come from this store's own page, so it is refused — reload the " +
    "page and try again";

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
      await readDoorBody(req); // drain: the refusal must not leave the socket dirty (not parsed,
      // so the provenance refusal echoes no field a foreign page posted)
      refuseDoor(req, res, 403, NOT_THIS_PAGE);
      return undefined;
    }
    const body = formFields(await readDoorBody(req), req.headers["content-type"]);
    const presented = body.get("form_token") ?? "";
    const held = peek(req);
    if (held !== undefined) {
      if (!sameSecret(presented, held.session.formToken)) {
        refuseDoor(req, res, 403, NOT_THIS_PAGE, body.get("user") ?? "");
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
      refuseDoor(req, res, 403, NOT_THIS_PAGE, body.get("user") ?? "");
      return undefined;
    }
    return { held: undefined, body };
  };

  const cannotDecide = (
    req: IncomingMessage,
    res: ServerResponse,
    what: string,
    continuation?: string,
  ): void => refuseDoor(req, res, 503, what, "", continuation);

  // `salvage` is T146's browser path: the form rendered AGAIN after a refused POST, the refusal
  // stated inline and the typed user kept so a person retypes one field, not two. The refusal
  // sentence is EXACTLY the JSON refusal's — the one-refusal rule is about information, and this
  // page changes only the frame. With no salvage the bytes are the GET page, unchanged.
  const loginPage = (
    formToken: string,
    salvage?: { refusal: string; user: string },
    continuation?: string,
  ): string =>
    page(
      "sign in to a Loam store",
      `<h1>Sign in.</h1>
${salvage === undefined ? "" : `<p>${escapeHtml(salvage.refusal)}</p>\n`}<form method="post" action="/login">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
${
  continuation === undefined
    ? ""
    : `<input type="hidden" name="${CONTINUE_FIELD}" value="${escapeHtml(continuation)}">\n`
}<label>user<input name="user"${
        salvage === undefined || salvage.user === "" ? "" : ` value="${escapeHtml(salvage.user)}"`
      } autocomplete="username" autocapitalize="none" spellcheck="false"></label>
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
<p><a href="/admin">Your containers.</a></p>
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
        cannotDecide(req, res, "this store's ground is not reachable, so this page cannot load");
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
    // WHERE THIS SIGN-IN WAS GOING, filtered here rather than trusted (see continuation.ts). It is
    // a query, never a destination, and it rides every answer this door gives: a re-rendered form
    // keeps it so a mistyped password does not strand the person, and the success below re-attaches
    // it to the authorize path itself. An ordinary sign-in carries none, and its bytes do not move.
    const carried = authorizeContinuation(body.get(CONTINUE_FIELD) ?? "");
    if (userNameDefect(user) !== undefined) {
      // Not a name any user could hold, so there is nothing to hash and nothing to count.
      refuseDoor(req, res, 401, LOGIN_REFUSED, user, carried);
      return;
    }
    // THE WAIT COMES FIRST, BEFORE THE COMPARE, and the order is the whole design (SPEC §36 phase 9).
    // A cost charged after the compare is no cost at all: the guess is already evaluated, and a fast
    // refusal beside a slow success tells the caller which they got just as plainly as the status
    // would. So the wait is paid ahead of the hash budget, the credential read, and any comparison.
    //
    // IT IS A WAIT, NEVER A REFUSAL. A correct password is admitted however many failures came before
    // it — the cap on the wait keeps "slow" from becoming "shut". The delay keys on the USERNAME
    // (never a caller-supplied address), read from `login-locks.json`; `limitNow` is the wall clock
    // the record decays against.
    //
    // A WAITING ATTEMPT HOLDS NO HASH SLOT: `hashesInFlight += 1` is taken immediately before the
    // hash below, not here, so another name gets in DURING the wait. It does NOT follow that a flood
    // cannot draw a 503 for another name — the waits elapse together, the flood spends the whole
    // budget at once, and a name arriving in that window is refused. Login stays deliberately
    // degradable under a flood.
    //
    // THE CAP CHECK COMES AFTER THE WAIT for the load-bearing reason: the check and the increment
    // must have NO await between them. Checking before the wait would let every waiting attempt pass
    // one free-budget snapshot, then all hash at once when their waits elapse — the cap read as
    // satisfied by a measurement taken seconds before the work. The read is ADVISORY: `noteFailure`
    // re-reads and re-decides for itself, so attempts arriving together pay the same wait and a
    // caller buys `maxConcurrentHashes` guesses per wait rather than one. Re-reading after the wait
    // would let a caller who keeps failing extend an honest attempt without limit — the lockout again.
    const owed = delayMs(options.home, user, limitNow(), limit);
    if (owed > 0) await waitFor(owed);
    // THE CHECK AND THE INCREMENT HAVE NO AWAIT BETWEEN THEM: a cap read before an await would be
    // a measurement taken before the work it authorizes. A refusal here spends no hash, and a
    // refusal here is not a failed attempt, so it never fills the delay either.
    if (hashesInFlight >= maxHashes) {
      refuseDoor(
        req,
        res,
        503,
        "the login door is busy: too much unauthenticated work is already in flight",
        user,
        carried,
      );
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
      cannotDecide(
        req,
        res,
        "the login door cannot read its credentials, so it refuses every login",
        carried,
      );
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
      cannotDecide(
        req,
        res,
        "the login door cannot read its credentials, so it refuses every login",
        carried,
      );
      return;
    } finally {
      hashesInFlight -= 1;
    }
    if (!matched) {
      // The count grows, so the NEXT attempt for this name costs more; this one already paid its
      // wait. `recordFailure` fails open — a write fault must not turn this 401 into a 503 (see its
      // definition), because a local disk fault has no say in what this door answers.
      recordFailure(user);
      refuseDoor(req, res, 401, LOGIN_REFUSED, user, carried);
      return;
    }
    // The password was right. The GROUND still has to hold a role for this user — `rolesOf`
    // answers empty both for an erased user record and for a live record with no role binding,
    // and the door refuses both the same way (erasing a user must actually shut the door, and the
    // credential file cannot know that it was erased).
    const roles = groundRoles(user);
    if (roles === undefined) {
      cannotDecide(req, res, "this store's ground is not reachable, so no session opens", carried);
      return;
    }
    if (roles.size === 0) {
      refuseDoor(req, res, 401, LOGIN_REFUSED, user, carried);
      return;
    }
    // A NEW id, and any session presented dies with the old cookie value: a session must never
    // survive its own authentication (session fixation — an attacker who plants a cookie value
    // would otherwise be holding a live session id once the victim signs in). The drop happens
    // INSIDE open, only once a seat is certain — a full table's refusal must leave the presented
    // session exactly as it was.
    const opened = open(user, roles, guard.held?.id);
    if (opened === undefined) {
      cannotDecide(req, res, "this store is holding all the sessions it can", carried);
      return;
    }
    // THE CORRECT PASSWORD IS ALREADY ACCEPTED, so nothing after the seat may refuse it. Clearing
    // the count is a COURTESY — it saves this name one wait next time — and `forgetCount` fails open
    // so a write fault costs exactly that courtesy and nothing more. Unguarded, a throw here would
    // reach the outer handler as a 503, refusing a correct password AND leaving the session just
    // seated with no cookie to reach it, burning one of `maxSessions` per retry.
    forgetCount(user);
    // The browser is told to drop the nonce cookie; the pair itself stays verifiable until the
    // process restarts — the pre-session is stateless, so nothing can spend it server-side.
    const cookies = [setCookie(opened.id), clearPreCookie()];
    // RESUME, IF THIS SIGN-IN CAME FROM THE AUTHORIZE PATH. `resumeTarget` builds a ROOT-RELATIVE
    // path from this store's own literal plus a re-encoded query, so the destination is same-origin
    // by construction and no caller text can reach the scheme, the host, or the path. 303, because
    // the browser must follow it with a GET. A sign-in carrying nothing lands on the page it always
    // landed on, byte for byte.
    const resume = carried === undefined ? undefined : resumeTarget(carried);
    if (resume !== undefined) {
      res.writeHead(303, {
        location: resume,
        "cache-control": CACHE_NO_STORE,
        "referrer-policy": "same-origin",
        "set-cookie": cookies,
      });
      res.end();
      return;
    }
    html(res, 200, signedInPage(user, roles, opened.session.formToken), cookies);
  };

  const postLogout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The same pinned order as `guarded`, with one door-specific step between drain and token:
    // SESSION PRESENCE ANSWERS FIRST, with phase 5's exact 401 — session absence outranks token
    // absence once provenance has passed (the frozen phase-5 rail pins it, and the caller has
    // already proved same-origin, so the 401 reveals nothing it should not).
    if (!fromThisPage(req)) {
      await readDoorBody(req); // drain: the refusal must not leave the socket dirty
      refuseDoor(req, res, 403, NOT_THIS_PAGE);
      return;
    }
    const body = formFields(await readDoorBody(req), req.headers["content-type"]);
    const held = peek(req);
    if (held === undefined) {
      refuseDoor(req, res, 401, "no live session is presented here");
      return;
    }
    if (!sameSecret(body.get("form_token") ?? "", held.session.formToken)) {
      refuseDoor(req, res, 403, NOT_THIS_PAGE);
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
      cannotDecide(req, res, "this store's ground is not reachable, so no token is minted");
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
      // THE CURE MUST BE A COMMAND THAT WORKS IN THIS EXACT STATE. This 409 is reachable only
      // for a user who ALREADY holds the role (a role-less one was refused above), and
      // `assign-role` refuses a role already held — so naming it alone would send the operator
      // to a guaranteed no-op with no stated way forward. A P5 lens caught that. The pair below
      // is what the CLI itself prescribes for the same half-failed shape.
      json(res, 409, {
        errors: [
          `${session.user} holds the operator role but has no usable signing key on this box, ` +
            `so no token is minted — a session must write under its own name, never the ` +
            `store's. This user already holds the role, so mint a fresh key with ` +
            `\`loam user remove-role ${session.user} --role=operator\` then ` +
            `\`loam user assign-role ${session.user} --role=operator\`.`,
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
    // anything — and it keeps this file's header rule: an unswept, idle-expired row does not go
    // on authenticating just because nobody has logged in since.
    const stillLive = (): boolean => {
      const row = sessions.get(id);
      return row !== undefined && row.expiresAt > now();
    };
    // The mint hands back the deadline IT recorded. Computing one here from a fresh clock read
    // would be strictly later than the table's own — the door would promise a lifetime past the
    // token's real death, and the cap would count a token live that the table had stopped
    // honoring. A P5 lens caught the comment claiming the recorded deadline while the code
    // inferred one.
    const { token, expiresAt } = deps.mint(
      { actor: seed.seed, operator: true },
      tokenTtlMs,
      stillLive,
    );
    minted.set(id, [...held, { digest: digestOf(token), expiresAt }]);
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

  // The gate a sibling page reuses (SPEC §37 phase 14). Every method reads the SAME closures the
  // login doors use — `peek`/`touch` for the session, `fromThisPage` for phase-6 provenance, and the
  // stateless pre-session for the login form — so the consent page cannot drift from what `/login`
  // enforces. `loginForm` mirrors the tail of `getLogin`: an existing nonce cookie is reused so a
  // reload keeps its form token, else a fresh one, and no table grows.
  const gate: SessionGate = {
    peek: (req) => {
      const held = peek(req);
      return held === undefined
        ? undefined
        : { user: held.session.user, formToken: held.session.formToken };
    },
    admit: (req) => {
      const held = touch(req);
      return held === undefined
        ? undefined
        : { user: held.session.user, formToken: held.session.formToken };
    },
    fromThisPage,
    loginForm: (req, continuation) => {
      const nonce = preSessionIdFrom(req) ?? opaqueId();
      return {
        body: loginPage(preSessionToken(nonce), undefined, continuation),
        cookie: setPreCookie(nonce),
      };
    },
  };

  return {
    gate,
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
          refuseDoor(
            req,
            res,
            503,
            "the login door could not answer, and it says no rather than why",
          );
        } else {
          res.end();
        }
      }
    },
  };
}
