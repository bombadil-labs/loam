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

import { randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Reactor } from "@bombadil/rhizomatic";
import {
  CredentialsUnreadable,
  DEFAULT_SCRYPT,
  entryFor,
  readCredentials,
  spendDecoyHash,
  verifyPassword,
  type ScryptParams,
} from "./credentials.js";
import {
  DEFAULT_LIMIT,
  forgetFailures,
  lockedMs,
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
  readonly maxSessions?: number; // live sessions, pre-login ones included (default 4096)
  readonly maxConcurrentHashes?: number; // unauthenticated scrypt work in flight (default 4)
  readonly scrypt?: ScryptParams;
  readonly limit?: LimitPolicy;
  /** A monotonic millisecond source. Injectable so a rail can drive it; never Date.now(). */
  readonly monotonicNow?: () => number;
}

export interface UserDoorDeps {
  readonly options: UserDoorOptions;
  /** The public URL, already settled — the bound URL when the operator named none. */
  readonly publicUrl: string;
  /** The mount's ground, re-asked every request: a mount can vanish, and erase re-seats a reactor. */
  ground(): { reactor: Reactor; operator: string | undefined } | undefined;
  /** Mint a short-lived bearer token for an identity the caller has already authorized. */
  mint(identity: { actor?: string; operator?: true }, ttlMs: number): string;
}

export interface UserDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export const SESSION_COOKIE = "loam_session";

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

const DEFAULTS = {
  idleMs: 30 * 60_000,
  tokenTtlMs: 5 * 60_000,
  maxSessions: 4096,
  maxConcurrentHashes: 4,
};

interface Session {
  /** Absent until a password verifies: GET /login mints a pre-session to carry the form token. */
  user?: string;
  role?: UserRole;
  formToken: string;
  expiresAt: number;
}

const opaque = (): string => randomBytes(32).toString("base64url");

const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

/** The session id a Cookie header carries, or undefined. Never trusts a value's shape. */
export function sessionIdFrom(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) return undefined;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(eq + 1).trim();
    return value === "" ? undefined : value;
  }
  return undefined;
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
  const maxHashes = options.maxConcurrentHashes ?? DEFAULTS.maxConcurrentHashes;
  const scryptParams = options.scrypt ?? DEFAULT_SCRYPT;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const now = options.monotonicNow ?? ((): number => performance.now());
  const publicOrigin = ((): string | undefined => {
    try {
      return new URL(deps.publicUrl).origin;
    } catch {
      return undefined;
    }
  })();

  const sessions = new Map<string, Session>();
  let hashesInFlight = 0;

  const sweep = (): void => {
    const moment = now();
    for (const [id, session] of sessions) if (session.expiresAt <= moment) sessions.delete(id);
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
      sessions.delete(id);
      return undefined;
    }
    session.expiresAt = moment + idleMs;
    return { id, session };
  };

  const open = (user?: string, role?: UserRole): { id: string; session: Session } | undefined => {
    if (sessions.size >= maxSessions) {
      sweep();
      if (sessions.size >= maxSessions) return undefined;
    }
    const id = opaque();
    const session: Session = {
      formToken: opaque(),
      expiresAt: now() + idleMs,
      ...(user === undefined ? {} : { user }),
      ...(role === undefined ? {} : { role }),
    };
    sessions.set(id, session);
    return { id, session };
  };

  const json = (res: ServerResponse, status: number, body: unknown, cookie?: string): void => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(JSON.stringify(body));
  };

  const html = (res: ServerResponse, status: number, body: string, cookie?: string): void => {
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
   * Did this POST come from this store's own page? `Origin`, when present, must BE the configured
   * public origin — a foreign Origin is refused even when Sec-Fetch-Site says same-origin, because a
   * caller writes both. With no Origin at all, the browser's own Sec-Fetch-Site must say same-origin.
   */
  const fromThisPage = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "" && origin !== "null") {
      return publicOrigin !== undefined && origin === publicOrigin;
    }
    return req.headers["sec-fetch-site"] === "same-origin";
  };

  // A POST door's shared preamble: the origin signal, the body, the live session, the form token. It
  // returns the session or answers the refusal itself — no door may skip a step by forgetting one.
  const guarded = async (
    req: IncomingMessage,
    res: ServerResponse,
    wantSignedIn: boolean,
  ): Promise<{ id: string; session: Session; body: Map<string, string> } | undefined> => {
    if (!fromThisPage(req)) {
      notThisPage(res);
      return undefined;
    }
    const body = fields(await readBody(req), req.headers["content-type"]);
    const held = touch(req);
    if (held === undefined || (wantSignedIn && held.session.user === undefined)) {
      json(res, 401, { errors: ["no live session is presented here"] });
      return undefined;
    }
    if (!sameSecret(body.get("form_token") ?? "", held.session.formToken)) {
      notThisPage(res);
      return undefined;
    }
    return { ...held, body };
  };

  const getLogin = (req: IncomingMessage, res: ServerResponse): void => {
    const held = touch(req);
    if (held?.session.user !== undefined) {
      html(
        res,
        200,
        signedInPage(held.session.user, held.session.role ?? "actor", held.session.formToken),
      );
      return;
    }
    if (held !== undefined) {
      html(res, 200, loginPage(held.session.formToken)); // an existing pre-session keeps its token
      return;
    }
    const opened = open();
    if (opened === undefined) {
      json(res, 503, { errors: ["this store is holding all the login sessions it can"] });
      return;
    }
    html(res, 200, loginPage(opened.session.formToken), setCookie(opened.id));
  };

  const postLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guarded(req, res, false);
    if (guard === undefined) return;
    const user = guard.body.get("user") ?? "";
    const password = guard.body.get("password") ?? "";
    if (userNameDefect(user) !== undefined) {
      // Not a name any user could hold, so there is nothing to hash and nothing to count.
      refuseLogin(res);
      return;
    }
    const lockRemains = lockedMs(options.home, user, Date.now());
    if (lockRemains > 0) {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, Math.ceil(lockRemains / 1000))),
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ errors: ["too many failed attempts: this login is locked"] }));
      return;
    }
    // The budget, checked BEFORE any hashing: scrypt is expensive on purpose, and an unauthenticated
    // caller must not be able to spend the box's CPU by asking. A refusal here is not a failed
    // attempt, so it never fills the limiter either.
    if (hashesInFlight >= maxHashes) {
      json(res, 503, {
        errors: ["the login door is busy: too much unauthenticated work is already in flight"],
      });
      return;
    }
    let matched: boolean;
    hashesInFlight += 1;
    try {
      const entry = entryFor(readCredentials(options.home), user);
      matched =
        entry === undefined
          ? await spendDecoyHash(password, scryptParams) // same cost as a miss: no timing oracle
          : await verifyPassword(entry, password);
    } catch (err) {
      // The door could not DECIDE. That is never a match, and it is the operator's fault to see.
      const why =
        err instanceof CredentialsUnreadable ? err.message : "the credential store failed";
      json(res, 503, { errors: [`the login door cannot read its credentials: ${why}`] });
      return;
    } finally {
      hashesInFlight -= 1;
    }
    if (!matched) {
      noteFailure(options.home, user, Date.now(), limit);
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
    // A NEW id, and the presented one dies: a session must never survive its own authentication
    // (session fixation — an attacker who plants a pre-session id would otherwise hold a live one).
    sessions.delete(guard.id);
    const opened = open(user, role);
    if (opened === undefined) {
      json(res, 503, { errors: ["this store is holding all the login sessions it can"] });
      return;
    }
    forgetFailures(options.home, user);
    html(res, 200, signedInPage(user, role, opened.session.formToken), setCookie(opened.id));
  };

  const postLogout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guarded(req, res, false);
    if (guard === undefined) return;
    sessions.delete(guard.id);
    html(res, 200, signedOutPage(), clearCookie());
  };

  const postToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guarded(req, res, true);
    if (guard === undefined) return;
    const user = guard.session.user!;
    const ground = deps.ground();
    if (ground === undefined) {
      json(res, 503, { errors: ["this store's ground is not reachable, so no token is minted"] });
      return;
    }
    // Re-read the role rather than trusting the session's copy: a role revoked (or a user erased)
    // after sign-in must stop minting tokens on the next ask, not on the next restart.
    const role = roleOf(ground.reactor, ground.operator, user);
    if (role === undefined) {
      sessions.delete(guard.id);
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
    // A user is not a seed (§36). The operator ROLE is what entitles this session to the operator's
    // signing identity, so the token names that identity and the store signs as it does for the
    // operator's own bearer token. No new authority is created here.
    const token = deps.mint({ operator: true }, tokenTtlMs);
    json(res, 200, { token, expiresIn: Math.floor(tokenTtlMs / 1000), user, role });
  };

  return {
    owns: (pathname) =>
      pathname === "/login" || pathname === "/logout" || pathname === "/session/token",
    async handle(pathname, req, res) {
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
    },
  };
}
