// The four browser-facing doors (SPEC §36): GET /login, POST /login, POST /logout, POST /session/token.
//
// COOKIE AUTHORITY IS CONFINED TO THESE FOUR. A cookie is ambient — the browser attaches it to any
// request any page makes, and a form POST with a JSON-shaped body is a simple request, so no preflight
// stands between an attacker's page and this store. http.ts states the invariant it relies on:
// "authority here is a bearer header the caller must present explicitly (never a cookie, never
// ambient)". A session that opened the GraphQL door would break that sentence and hand every page on
// the internet a write door. So a browser that wants to write asks POST /session/token for a
// short-lived bearer token and presents it in a header like any other client.
//
// Each POST door therefore wants TWO independent signals, belt and braces:
//   - a same-origin signal — `Origin` equal to the CONFIGURED public URL, or `Sec-Fetch-Site:
//     same-origin`. Host and X-Forwarded-* are the caller's to write, so neither is consulted.
//   - a per-session form token, in the body, compared timing-safely.
//
// A session's expiry rides a MONOTONIC clock. Date.now() is settable, and a store whose wall clock
// slips backwards must not resurrect a session that already timed out.

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
  type ScryptParams,
} from "./credentials.js";
import {
  DEFAULT_LIMIT,
  delayMs,
  forgetFailures,
  locksPath,
  noteFailure,
  type LimitPolicy,
} from "./login-locks.js";
import { roleOf, userNameDefect, type UserRole } from "./users.js";

export interface UserDoorOptions {
  /** Where credentials.json and login-locks.json live. */
  readonly home: string;
  /** The mount whose ground holds the user records and role bindings. */
  readonly mount: string;
  /**
   * The store's address as the outside world sees it. Cookies, the Origin check and (§37) the
   * discovery documents read it. Defaults to the bound URL, which is right for a loopback store and
   * wrong the moment a proxy is in front — name it then.
   */
  readonly publicUrl?: string;
  readonly idleMs?: number; // session idle window (default 30 minutes)
  readonly tokenTtlMs?: number; // /session/token lifetime (default 5 minutes)
  readonly maxSessions?: number; // signed-in sessions this server will hold (default 4096)
  readonly maxTokensPerSession?: number; // live tokens one session may hold (default 16)
  readonly maxConcurrentHashes?: number; // unauthenticated scrypt work in flight (default 4)
  readonly scrypt?: ScryptParams;
  /** The failed-login DELAY: how a wrong password makes the next one cost. Never a refusal. */
  readonly limit?: LimitPolicy;
  /** A monotonic millisecond source. Injectable so a rail can drive it; never Date.now(). */
  readonly monotonicNow?: () => number;
  /**
   * Where a local fault goes — a credentials.json this door cannot read, an unparseable public URL.
   * The CALLER never sees the detail (it names paths and other users), and a fault nobody is told
   * about is a swallowed error, so the two have to be different channels.
   */
  readonly onFault?: (message: string) => void;
}

export interface UserDoorDeps {
  readonly options: UserDoorOptions;
  /** The public URL, already settled — the bound URL when the operator named none. */
  readonly publicUrl: string;
  /** The mount's ground, re-asked every request: a mount can vanish, and erase re-seats a reactor. */
  ground(): { reactor: Reactor; operator: string | undefined } | undefined;
  /** Mint a short-lived bearer token for an identity the caller has already authorized. */
  mint(identity: { actor?: string; operator?: true }, ttlMs: number): string;
  /** Retire minted tokens before their window ends — what signing out has to be able to do. */
  /** Retire these tokens by SHA-256 digest (hex) — the plaintext never leaves the response. */
  revoke(digests: readonly string[]): void;
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
// them out. Worse than the logout: the Session row survives its idle window with no cookie left to
// reach it, so the tokens it minted can no longer be revoked by signing out.
export const PRESESSION_COOKIE = "__Host-loam_form";

// Pinned, and pinned as ONE STRING: every attribute here is a decision, and computing any of them
// from a request header is how a caller's own Host ends up scoping the operator's cookie.
// SameSite=Lax rather than Strict so a link into the store still arrives signed in; the form token is
// what makes Lax safe on the POST doors.
const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/";

// No script, no styles from anywhere, no framing, no base rewriting. The pages carry no script at
// all; the header is the belt to that braces.
const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const MAX_BODY = 8 * 1024; // a login form is a few hundred bytes; nothing here needs more

// The wait a failed-login delay costs. The timer subsystem serves it, and Node drives timers from a
// MONOTONIC clock — so a wall clock stepped backwards mid-wait cannot shorten it, and a step forwards
// cannot skip it.
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULTS = {
  idleMs: 30 * 60_000,
  tokenTtlMs: 5 * 60_000,
  maxSessions: 4096,
  maxTokensPerSession: 16,
  maxConcurrentHashes: 4,
};

/**
 * A SIGNED-IN session. There is no other kind: the not-yet-signed-in half of a login is stateless (see
 * `preSessionToken`), so every row in the table cost a correct password.
 */
interface Session {
  readonly user: string;
  role: UserRole;
  readonly formToken: string;
  expiresAt: number;
}

const opaque = (): string => randomBytes(32).toString("base64url");

const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

/**
 * The session id a Cookie header carries, or undefined. Never trusts a value's shape.
 *
 * TWO cookies of the same name is not a session, it is an AMBIGUITY, and picking either one is picking
 * whichever an injector managed to place first. So it refuses.
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

const escapeHtml = (raw: string): string =>
  raw.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const readBody = (req: IncomingMessage): Promise<string | undefined> =>
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

// A form POST or a JSON body — both reach the same field map. A browser sends the first; the JS that
// chains from /session/token to /session/token may prefer the second.
function fields(body: string | undefined, contentType: string | undefined): Map<string, string> {
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

export function makeUserDoors(deps: UserDoorDeps): UserDoors {
  const options = deps.options;
  const idleMs = options.idleMs ?? DEFAULTS.idleMs;
  const tokenTtlMs = options.tokenTtlMs ?? DEFAULTS.tokenTtlMs;
  const maxSessions = options.maxSessions ?? DEFAULTS.maxSessions;
  const maxTokensPerSession = options.maxTokensPerSession ?? DEFAULTS.maxTokensPerSession;
  const scryptParams = options.scrypt ?? DEFAULT_SCRYPT;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const now = options.monotonicNow ?? ((): number => performance.now());
  const onFault = options.onFault ?? ((message: string): void => void message);

  /**
   * The origins this store answers its own forms from. Exactly the configured one — EXCEPT when that
   * one is loopback, where the equivalent spellings on the same port are the same store: a browser at
   * `http://localhost:4321` sends `Origin: http://localhost:4321`, and a default of `127.0.0.1` would
   * refuse the operator's own form. The widening is bounded to loopback literals on the SAME PORT, so
   * it can never admit a foreign host.
   */
  const ownOrigins = ((): ReadonlySet<string> => {
    let url: URL;
    try {
      url = new URL(deps.publicUrl);
    } catch {
      // An unparseable public URL means no origin can be recognised, so every Origin-bearing POST is
      // refused. Failing closed is right, and it is loud enough to find.
      onFault(
        `the login doors cannot parse the public URL "${deps.publicUrl}", so every POST refuses`,
      );
      return new Set();
    }
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
    if (!loopback.has(url.hostname) && !loopback.has(url.host.replace(/:\d+$/, ""))) {
      return new Set([url.origin]);
    }
    const port = url.port === "" ? "" : `:${url.port}`;
    return new Set([
      url.origin,
      `${url.protocol}//127.0.0.1${port}`,
      `${url.protocol}//localhost${port}`,
      `${url.protocol}//[::1]${port}`,
    ]);
  })();

  // Said ONCE, at the door's own opening, because it is a property of the credential file rather than of
  // any one attempt — and because a warning per attempt on an unauthenticated path is a log a stranger can
  // fill. See `decoyParamsFor`: disagreeing costs leave a timing distinction the decoy hash cannot cover,
  // and a door that noticed and stayed quiet would be the report overclaiming again.
  try {
    if (paramsDisagree(readCredentials(options.home))) {
      onFault(
        `the entries in ${credentialsPath(options.home)} disagree about scrypt cost, so login timing ` +
          `can tell some of those names apart from an absent one. Re-create those users to even it out.`,
      );
    }
  } catch {
    // an unreadable file is the login door's own refusal to make, per attempt, in its own words
  }

  const sessions = new Map<string, Session>();
  // Tokens minted per session, so signing out revokes what signing in bought — held as DIGESTS, never
  // as the secret. The token table this feeds is digest-keyed and says so; keeping the plaintext here
  // to hand back at revocation time would undo that, and hold it far longer than the token is valid:
  // a session idles for its whole window, six times a token's own life, and nothing prunes a lapsed
  // entry until the same session mints again. A heap dump would then yield live operator tokens.
  const minted = new Map<string, { digest: string; expiresAt: number }[]>();
  const digestOf = (token: string): string => createHash("sha256").update(token).digest("hex");

  // ONE COUNTER FOR EVERY ATTEMPT, and the reason is worth the paragraph.
  //
  // scrypt is expensive on purpose, so an unauthenticated caller must not be able to spend the box's
  // CPU by asking. That much is a budget. The temptation is to reserve headroom by giving the
  // unknown-username path a SMALLER share, so a caller rotating names cannot starve a real login — and
  // that is a USERNAME ORACLE, because the two shares run out at different times. Fill the smaller one
  // and an existing name answers 401 while an absent name answers 503. The caller learns which names
  // exist, which is exactly what the decoy hash is here to prevent (criterion j).
  //
  // So both branches draw on one counter and answer identically past it. The cost is admitted rather
  // than hidden: LOGIN IS DELIBERATELY DEGRADABLE. A sustained flood makes this door answer 503, and
  // the operator's own bearer token does not pass through here at all, so the API stays reachable while
  // it happens. An availability dent is the cheaper failure; a confidentiality leak does not heal.
  const maxHashes = options.maxConcurrentHashes ?? DEFAULTS.maxConcurrentHashes;
  let hashesInFlight = 0;

  // THE LIMITER'S WRITES FAIL OPEN, both of them, and the reason is the promise this door makes.
  //
  // login-locks.json is a work budget rather than an authorization surface, and `readLocks` already
  // treats a file it cannot parse as no records at all. The writes have to agree. Unguarded they
  // reach the door's outer guard, which answers 503 — so an unwritable home, ENOSPC, or the file
  // replaced by a directory would refuse a CORRECT password, which is the one thing this design
  // promises cannot happen. The fault goes to the operator's own channel, where a local condition
  // belongs, and the caller's answer does not move.
  //
  // What failing open costs: the count does not grow, so a guesser is not charged for that attempt.
  // A disk the server cannot write is not a state a caller can reach, and the alternative is handing
  // a disk fault the power to shut the login door.
  const recordFailure = (user: string): void => {
    try {
      noteFailure(options.home, user, Date.now(), limit);
    } catch (err) {
      onFault(
        `the login door could not record a failed attempt in ${locksPath(options.home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const forgetCount = (user: string): void => {
    try {
      forgetFailures(options.home, user);
    } catch (err) {
      onFault(
        `the login door could not clear a failure count in ${locksPath(options.home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const sweep = (): void => {
    const moment = now();
    for (const [id, session] of sessions) if (session.expiresAt <= moment) drop(id);
  };

  // Closing a session revokes the bearer tokens it minted. Without this, "sign out" answers 200 having
  // revoked nothing it issued, and the token keeps writing for the rest of its window.
  const drop = (id: string): void => {
    sessions.delete(id);
    const held = minted.get(id);
    if (held !== undefined) {
      minted.delete(id);
      deps.revoke(held.map((m) => m.digest));
    }
  };

  /**
   * The tokens this session holds that are still WITHIN THEIR WINDOW. Counting the ones it ever minted
   * would make the per-session cap permanent: a session that reached the cap could never mint again,
   * however long it waited, while its own idle window kept it alive indefinitely.
   */
  const liveTokens = (id: string): { digest: string; expiresAt: number }[] => {
    const moment = now();
    const held = (minted.get(id) ?? []).filter((m) => m.expiresAt > moment);
    if (held.length === 0) minted.delete(id);
    else minted.set(id, held);
    return held;
  };

  // The presented session, if it is live. Touching it slides the idle window forward — which is the
  // only place `expiresAt` moves, so a session's death is a property of INACTIVITY and nothing else.
  const touch = (req: IncomingMessage): { id: string; session: Session } | undefined => {
    const id = sessionIdFrom(req);
    if (id === undefined) return undefined;
    const session = sessions.get(id);
    if (session === undefined) return undefined;
    const moment = now();
    if (session.expiresAt <= moment) {
      drop(id);
      return undefined;
    }
    session.expiresAt = moment + idleMs;
    return { id, session };
  };

  /**
   * Open a SIGNED-IN session. Nothing unauthenticated reaches this, which is what makes `maxSessions` a
   * real limit rather than a lever: filling it costs a correct password per seat.
   */
  const open = (user: string, role: UserRole): { id: string; session: Session } | undefined => {
    sweep(); // every open, not only a full table: a lapsed session is not something to hold on to
    if (sessions.size >= maxSessions) return undefined;
    const id = opaque();
    const moment = now();
    sessions.set(id, { formToken: opaque(), expiresAt: moment + idleMs, user, role });
    return { id, session: sessions.get(id)! };
  };

  /**
   * THE PRE-SESSION IS STATELESS, and that is a security property rather than an economy.
   *
   * A login form needs two things: a cookie the browser will send back, and a token in the body that
   * proves the form came from this store's own page. Neither needs a row in a table. Keeping one meant
   * `GET /login` — no password, no hash, no file — allocated server memory, so a flood could fill the
   * table and evict the seat a real user needed a moment later. Whichever way that eviction went, the
   * displaced thing was exactly what a login requires.
   *
   * So the cookie carries a random nonce, and the form token is an HMAC of that nonce under a key minted
   * at boot. Verifying costs one hash of 32 bytes and no state. The key dies with the process, which is
   * also what makes a restart invalidate every form in flight.
   *
   * It grants nothing: holding a valid pair buys the right to ATTEMPT a password, which the username
   * limiter and the hash budget govern independently.
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

  // The login door's ONE refusal, whatever went wrong behind it: an unknown user, a wrong password,
  // a user whose record the ground no longer holds. Anything finer would be an oracle.
  const refuseLogin = (res: ServerResponse): void =>
    json(res, 401, { errors: ["the login was refused"] });

  const notThisPage = (res: ServerResponse): void =>
    json(res, 403, {
      errors: ["this request did not come from this store's own page, so it is refused"],
    });

  const page = (title: string, body: string): string => `<!doctype html>
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
         padding: 0.1em 0.4em; border-radius: 0.3em; }
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
<p>A session opens the pages here. To write, ask this store for a token — a session cannot open the
data doors on its own.</p>`,
    );

  const signedInPage = (user: string, role: UserRole, formToken: string): string =>
    page(
      "signed in to a Loam store",
      `<h1>Signed in.</h1>
<p>You are <code>${escapeHtml(user)}</code>, and you hold the <code>${escapeHtml(role)}</code> role here.</p>
<form method="post" action="/session/token">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<button type="submit">get a bearer token</button>
</form>
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
   * Did this POST come from this store's own page? `Origin`, when present, must be one of this store's
   * own — and it OUTRANKS `Sec-Fetch-Site`, because a non-browser caller writes both and the one that
   * names a specific foreign page is the one to believe. With no Origin at all, the browser's own
   * Sec-Fetch-Site must say same-origin.
   */
  const fromThisPage = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "" && origin !== "null") {
      return ownOrigins.has(origin);
    }
    return req.headers["sec-fetch-site"] === "same-origin";
  };

  /**
   * A POST door's shared preamble: the origin signal, the body, whatever the cookie names, and the form
   * token that matches it. It answers the refusal itself, so no door can skip a step by forgetting one.
   *
   * `wantSignedIn` decides whether a STATELESS pre-session is enough. /login accepts one — it is how a
   * first login arrives. /logout and /session/token do not: there is no session behind it to end or to
   * mint from.
   */
  const guarded = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<
    | { readonly held: { id: string; session: Session }; readonly body: Map<string, string> }
    | { readonly held: undefined; readonly body: Map<string, string> }
    | undefined
  > => {
    if (!fromThisPage(req)) {
      notThisPage(res);
      return undefined;
    }
    const body = fields(await readBody(req), req.headers["content-type"]);
    const presented = body.get("form_token") ?? "";
    const held = touch(req);
    if (held !== undefined) {
      if (!sameSecret(presented, held.session.formToken)) {
        notThisPage(res);
        return undefined;
      }
      return { held, body };
    }
    const nonce = preSessionIdFrom(req);
    if (nonce === undefined || !sameSecret(presented, preSessionToken(nonce))) {
      notThisPage(res);
      return undefined;
    }
    return { held: undefined, body };
  };

  /** The same guard, for a door that needs a session behind the cookie rather than only a form token. */
  const guardedSession = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ id: string; session: Session; body: Map<string, string> } | undefined> => {
    const guard = await guarded(req, res);
    if (guard === undefined) return undefined;
    if (guard.held === undefined) {
      json(res, 401, { errors: ["no live session is presented here"] });
      return undefined;
    }
    return { ...guard.held, body: guard.body };
  };

  const getLogin = (req: IncomingMessage, res: ServerResponse): void => {
    const held = touch(req);
    if (held !== undefined) {
      // Re-read the role from the ground rather than printing the session's copy. A role revoked, or a
      // user erased, after signing in must not leave this store's own page telling the caller they
      // still hold it — and dropping the session revokes the tokens it minted. Cheap here: this is a
      // page load, not a request path.
      const ground = deps.ground();
      if (ground === undefined) {
        // CANNOT DECIDE IS NOT "FORGOTTEN". Dropping the session here would destroy an authenticated
        // caller's state — and revoke their tokens — over a local condition this door could not
        // evaluate. Refuse, and leave the session exactly as it was.
        json(res, 503, {
          errors: ["this store's ground is not reachable, so this page cannot load"],
        });
        return;
      }
      const role = roleOf(ground.reactor, ground.operator, held.session.user);
      if (role !== undefined) {
        held.session.role = role;
        html(res, 200, signedInPage(held.session.user, role, held.session.formToken));
        return;
      }
      drop(held.id); // the ground answered, and it no longer holds this user
    }
    // The form, on a stateless pre-session. An EXISTING cookie value is reused as the nonce, so
    // reloading the page does not change the token a half-filled form already carries; otherwise a
    // fresh one. Either way no table grows, so this path cannot be flooded into refusing.
    const nonce = preSessionIdFrom(req) ?? opaque();
    html(res, 200, loginPage(preSessionToken(nonce)), setPreCookie(nonce));
  };

  const postLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guarded(req, res);
    if (guard === undefined) return;
    const user = guard.body.get("user") ?? "";
    const password = guard.body.get("password") ?? "";
    if (userNameDefect(user) !== undefined) {
      // Not a name any user could hold, so there is nothing to hash and nothing to count.
      refuseLogin(res);
      return;
    }
    // THE WAIT COMES FIRST, BEFORE THE COMPARE, and the order is the whole design.
    //
    // A cost charged after the compare is no cost at all: the guess has already been evaluated, and a
    // fast refusal beside a slow success tells the caller which they got just as plainly as the status
    // would. So this is paid ahead of the hash budget, ahead of the credential read, ahead of any
    // comparison.
    //
    // IT IS A WAIT, NEVER A REFUSAL. A correct password is admitted however many failures came before
    // it, so nobody — including a stranger who knows the name — can shut the operator out of their own
    // store by guessing at it. The cap on the wait is what keeps "slow" from becoming "shut".
    //
    // AND IT COMES BEFORE THE HASH BUDGET, not after. A waiting attempt holds no hash slot, so a flood
    // against one name cannot make this door answer 503 to another name. Swapped, the denial this
    // design removes would come straight back through the budget.
    //
    // The read is ADVISORY — `noteFailure` re-reads and re-decides for itself, because the read and the
    // write there must stay one synchronous step. What that costs, named rather than hidden: attempts
    // arriving together all read the same count, so they all pay the same wait, and a caller buys
    // `maxConcurrentHashes` guesses per wait instead of one. Re-reading after the wait would close that
    // and open something far worse — a caller who keeps failing could then extend an honest attempt
    // without limit, which is the lockout again under a different name.
    const owed = delayMs(options.home, user, Date.now(), limit);
    if (owed > 0) await wait(owed);
    // A refusal here is not a failed attempt, so it never fills the limiter either.
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
      // The door could not DECIDE. That is never a match. The DETAIL names the home's path and the
      // other entries in it, so it goes to the operator's own channel and never to the caller.
      onFault(
        `the login door cannot read ${credentialsPath(options.home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      json(res, 503, {
        errors: ["the login door cannot read its credentials, so it refuses every login"],
      });
      return;
    }
    const entry = entryFor(credentials, user);
    let matched: boolean;
    hashesInFlight += 1;
    try {
      // A NAME NOBODY HOLDS still costs a hash, so a miss and an unknown user take the same time. No
      // branch above this point answered differently for the two, and none below does either.
      matched =
        entry === undefined
          ? await spendDecoyHash(password, decoyParamsFor(credentials, scryptParams))
          : await verifyPassword(entry, password);
    } catch (err) {
      onFault(
        `the login door could not verify a credential: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      json(res, 503, {
        errors: ["the login door cannot read its credentials, so it refuses every login"],
      });
      return;
    } finally {
      hashesInFlight -= 1;
    }
    if (!matched) {
      // The count grows, so the NEXT attempt for this name costs more. This attempt already paid.
      //
      // A WRITE FAULT MUST NOT CHANGE THE ANSWER. `readLocks` is fail-open by design, and the write
      // has to match it: an unwritable home, ENOSPC, or login-locks.json replaced by a directory
      // would otherwise reach the outer guard and turn this 401 into a 503. That direction gives a
      // local disk fault a say in what the door answers, and a fault nobody can cause is still one
      // nobody can clear. Failing open costs the count, which is a work budget, not authority.
      recordFailure(user);
      refuseLogin(res);
      return;
    }
    // The password was right. The GROUND still has to say this user exists — erasing a user record
    // must actually shut the door, and the credential file cannot know that it was erased.
    const ground = deps.ground();
    if (ground === undefined) {
      json(res, 503, { errors: ["this store's ground is not reachable, so no session opens"] });
      return;
    }
    const role = roleOf(ground.reactor, ground.operator, user);
    if (role === undefined) {
      refuseLogin(res);
      return;
    }
    // A NEW id, and any session presented dies with the old cookie value: a session must never survive
    // its own authentication (session fixation — an attacker who plants a cookie value would otherwise
    // be holding a live session id once the victim signs in).
    if (guard.held !== undefined) drop(guard.held.id);
    const opened = open(user, role);
    if (opened === undefined) {
      json(res, 503, { errors: ["this store is holding all the sessions it can"] });
      return;
    }
    // THE CORRECT PASSWORD IS ALREADY ACCEPTED, so nothing after this line may refuse it. Clearing
    // the count is a courtesy — it saves this name one wait next time — and a write fault must cost
    // exactly that courtesy and nothing more. Unguarded, it reaches the outer guard as a 503, which
    // refuses a correct password AND leaves the session `open` just seated with no cookie to reach
    // it, burning one of `maxSessions` per retry.
    forgetCount(user);
    // the nonce is spent: one login is all it was ever good for
    html(res, 200, signedInPage(user, role, opened.session.formToken), [
      setCookie(opened.id),
      clearPreCookie(),
    ]);
  };

  const postLogout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guardedSession(req, res);
    if (guard === undefined) return;
    // `drop`, never a bare delete: signing out has to revoke the bearer tokens this session minted, or
    // it answers 200 having retired nothing it issued.
    drop(guard.id);
    html(res, 200, signedOutPage(), [clearCookie(), clearPreCookie()]);
  };

  const postToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guardedSession(req, res);
    if (guard === undefined) return;
    const user = guard.session.user;
    const ground = deps.ground();
    if (ground === undefined) {
      json(res, 503, { errors: ["this store's ground is not reachable, so no token is minted"] });
      return;
    }
    // Re-read the role rather than trusting the session's copy: a role revoked (or a user erased)
    // after sign-in must stop minting tokens on the next ask, not on the next restart.
    const role = roleOf(ground.reactor, ground.operator, user);
    if (role === undefined) {
      // The ground has forgotten this user, so the session goes — and with it every token it minted.
      drop(guard.id);
      json(res, 401, { errors: ["this store no longer holds a record of that user"] });
      return;
    }
    if (role !== "operator") {
      json(res, 403, {
        errors: [
          `${user} does not hold the operator role on this store, so no token is minted — ` +
            `§36 ships the operator role only`,
        ],
      });
      return;
    }
    // One session may not mint without limit: every live token is one more entry the token table holds.
    // LIVE, counted now — a lapsed token frees its slot, or the advice below would be a lie.
    const held = liveTokens(guard.id);
    if (held.length >= maxTokensPerSession) {
      json(res, 429, {
        errors: [
          `this session already holds ${held.length} live tokens — sign out, or wait for one to lapse`,
        ],
      });
      return;
    }
    // A user is not a seed (§36). The operator ROLE is what entitles this session to the operator's
    // signing identity, so the token names that identity and the store signs as it does for the
    // operator's own bearer token. No new authority is created here.
    //
    // WHAT THIS TOKEN IS, exactly: the operator's authority on this server, for `tokenTtlMs`. Signing
    // out retires it early (see `drop`); nothing else does. So revoking the user's role closes the door
    // to NEW tokens at once, and an already-minted one lives out its window.
    const token = deps.mint({ operator: true }, tokenTtlMs);
    minted.set(guard.id, [...held, { digest: digestOf(token), expiresAt: now() + tokenTtlMs }]);
    json(res, 200, { token, expiresIn: Math.floor(tokenTtlMs / 1000), user, role });
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
      json(res, 405, { errors: [`${pathname} answers POST`] });
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
      // ONE GUARD OVER ALL FOUR DOORS, because "the caller never sees the detail" has to hold for a
      // fault nobody anticipated too. Without it an ENOSPC from the login-locks.json write, or a throw from the
      // ground read, escapes to the server's generic handler — which answers 500 with the message, and
      // those messages carry the home's absolute path. Per-call-site try blocks would each be one
      // omission away from the same leak.
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
