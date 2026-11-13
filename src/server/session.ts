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
import { readUserSeed, userSeedPath } from "../cli/config.js";

export interface UserDoorOptions {
  readonly home: string;
  readonly mount: string;

  readonly publicUrl?: string;
  readonly idleMs?: number;
  readonly maxSessions?: number;
  readonly tokenTtlMs?: number;
  readonly maxTokensPerSession?: number;
  readonly maxConcurrentHashes?: number;
  readonly scrypt?: ScryptParams;
  readonly limit?: LimitPolicy;

  readonly limitNow?: () => number;

  readonly waitFor?: (ms: number) => Promise<void>;
  readonly monotonicNow?: () => number;

  readonly onFault?: (message: string) => void;
}

export interface UserDoorDeps {
  readonly options: UserDoorOptions;
  readonly publicUrl: string;
  ground(): { reactor: Reactor; operator: string | undefined } | undefined;

  mint(
    identity: { actor?: string; operator?: true },
    ttlMs: number,
    stillLive: () => boolean,
  ): { readonly token: string; readonly expiresAt: number };
  revoke(digests: readonly string[]): void;

  otherWorlds(): readonly string[];
}

export interface SessionView {
  readonly user: string;
  readonly formToken: string;
}

export interface SessionGate {
  peek(req: IncomingMessage): SessionView | undefined;
  admit(req: IncomingMessage): SessionView | undefined;
  fromThisPage(req: IncomingMessage): boolean;

  loginForm(
    req: IncomingMessage,
    continuation?: string,
  ): { readonly body: string; readonly cookie: string };
}

export interface UserDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
  readonly gate: SessionGate;
}

export const SESSION_COOKIE = "__Host-loam_session";

export const PRESESSION_COOKIE = "__Host-loam_form";

export const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/";

export const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const MAX_BODY = 8 * 1024;

const DOOR_DEFAULTS = {
  idleMs: 30 * 60_000,
  tokenTtlMs: 5 * 60_000,
  maxSessions: 4096,
  maxTokensPerSession: 16,
  maxConcurrentHashes: 4,
};

interface BrowserSession {
  readonly user: string;
  roles: ReadonlySet<UserRole>;
  readonly formToken: string;
  expiresAt: number;
}

const opaqueId = (): string => randomBytes(32).toString("base64url");

function sessionIdFrom(req: IncomingMessage): string | undefined {
  return cookieValue(req, SESSION_COOKIE);
}

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
  /* A withheld name is amber: the store is refusing, not failing. The markup says so too
     (a heading and a list), so a reader with no stylesheet loses the colour and nothing else. */
  .contested { border-left: 0.25rem solid #b57314; padding-left: 0.9rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6dfd4; background: #1f1b17; }
    code { background: #ffffff1f; }
    .contested { border-left-color: #e0a33c; }
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
  readBodyLenient(req, MAX_BODY);

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
  const limitNow = options.limitNow ?? ((): number => Date.now());
  const waitFor =
    options.waitFor ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

  const ownOrigins = ((): ReadonlySet<string> => {
    let url: URL;
    try {
      url = new URL(deps.publicUrl);
    } catch {
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

  let publicUrlDisagreed = false;
  const notePublicUrlDisagreement = (origin: string): void => {
    if (publicUrlDisagreed) return;
    let sent: URL;
    try {
      sent = new URL(origin);
    } catch {
      return;
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

  const fromThisPage = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "") {
      if (ownOrigins.has(origin)) return true;
      notePublicUrlDisagreement(origin);
      return false;
    }
    return req.headers["sec-fetch-site"] === "same-origin";
  };

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
  } catch {}

  const sessions = new Map<string, BrowserSession>();

  let hashesInFlight = 0;

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

  const minted = new Map<string, { digest: string; expiresAt: number }[]>();

  const drop = (id: string): void => {
    sessions.delete(id);
    const held = minted.get(id);
    if (held !== undefined) {
      minted.delete(id);
      deps.revoke(held.map((m) => m.digest));
    }
  };

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

  const touch = (req: IncomingMessage): { id: string; session: BrowserSession } | undefined => {
    const held = peek(req);
    if (held === undefined) return undefined;
    held.session.expiresAt = now() + idleMs;
    return held;
  };

  const open = (
    user: string,
    roles: ReadonlySet<UserRole>,
    replacing?: string,
  ): { id: string; session: BrowserSession } | undefined => {
    sweep();
    const displaced = replacing !== undefined && sessions.has(replacing) ? 1 : 0;
    if (sessions.size - displaced >= maxSessions) return undefined;
    if (replacing !== undefined) drop(replacing);
    const id = opaqueId();
    const moment = now();
    sessions.set(id, { formToken: opaqueId(), expiresAt: moment + idleMs, user, roles });
    return { id, session: sessions.get(id)! };
  };

  const formKey = randomBytes(32);
  const preSessionToken = (nonce: string): string =>
    createHmac("sha256", formKey).update(nonce).digest("base64url");

  const json = (res: ServerResponse, status: number, body: unknown, cookie?: string): void =>
    endJson(res, status, body, {
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

  const refusalFormToken = (req: IncomingMessage): string | undefined => {
    const held = peek(req);
    if (held !== undefined) return held.session.formToken;
    const nonce = preSessionIdFrom(req);
    if (nonce !== undefined) return preSessionToken(nonce);
    return undefined;
  };

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

  const LOGIN_REFUSED = "the login was refused";

  const NOT_THIS_PAGE =
    "this request did not come from this store's own page, so it is refused — reload the " +
    "page and try again";

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
      await readDoorBody(req);
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

  const groundRoles = (user: string): ReadonlySet<UserRole> | undefined => {
    const ground = deps.ground();
    if (ground === undefined || ground.operator === undefined) return undefined;
    return rolesOf(ground.reactor, ground.operator, Date.now(), user);
  };

  const getLogin = (req: IncomingMessage, res: ServerResponse): void => {
    const held = touch(req);
    if (held !== undefined) {
      const roles = groundRoles(held.session.user);
      if (roles === undefined) {
        cannotDecide(req, res, "this store's ground is not reachable, so this page cannot load");
        return;
      }
      if (roles.size > 0) {
        held.session.roles = roles;
        html(res, 200, signedInPage(held.session.user, roles, held.session.formToken));
        return;
      }
      drop(held.id);
    }
    const nonce = preSessionIdFrom(req) ?? opaqueId();
    html(res, 200, loginPage(preSessionToken(nonce)), setPreCookie(nonce));
  };

  const postLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = await guarded(req, res);
    if (guard === undefined) return;
    const body = guard.body;
    const user = body.get("user") ?? "";
    const password = body.get("password") ?? "";
    const carried = authorizeContinuation(body.get(CONTINUE_FIELD) ?? "");
    if (userNameDefect(user) !== undefined) {
      refuseDoor(req, res, 401, LOGIN_REFUSED, user, carried);
      return;
    }
    const owed = delayMs(options.home, user, limitNow(), limit);
    if (owed > 0) await waitFor(owed);
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
      recordFailure(user);
      refuseDoor(req, res, 401, LOGIN_REFUSED, user, carried);
      return;
    }
    const roles = groundRoles(user);
    if (roles === undefined) {
      cannotDecide(req, res, "this store's ground is not reachable, so no session opens", carried);
      return;
    }
    if (roles.size === 0) {
      refuseDoor(req, res, 401, LOGIN_REFUSED, user, carried);
      return;
    }
    const opened = open(user, roles, guard.held?.id);
    if (opened === undefined) {
      cannotDecide(req, res, "this store is holding all the sessions it can", carried);
      return;
    }
    forgetCount(user);
    const cookies = [setCookie(opened.id), clearPreCookie()];
    const resume = carried === undefined ? undefined : resumeTarget(carried);
    if (resume !== undefined) {
      res.writeHead(303, {
        location: resume,
        "content-security-policy": CSP,
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
    if (!fromThisPage(req)) {
      await readDoorBody(req);
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
      json(res, 401, { errors: ["no live session is presented here"] });
      return;
    }
    const { id, session } = guard.held;
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
    const roles = groundRoles(session.user);
    if (roles === undefined) {
      cannotDecide(req, res, "this store's ground is not reachable, so no token is minted");
      return;
    }
    if (roles.size === 0) {
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
          `${session.user} holds the operator role but has no usable signing key on this box, ` +
            `so no token is minted — a session must write under its own name, never the ` +
            `store's. This user already holds the role, so mint a fresh key with ` +
            `\`loam user remove-role ${session.user} --role=operator\` then ` +
            `\`loam user assign-role ${session.user} --role=operator\`.`,
        ],
      });
      return;
    }
    const stillLive = (): boolean => {
      const row = sessions.get(id);
      return row !== undefined && row.expiresAt > now();
    };
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
