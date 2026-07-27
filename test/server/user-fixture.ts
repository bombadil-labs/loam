// The shared world §36's rails grow from: a temp home, a store booted from genesis, a credential
// entry written by the bootstrap CLI, and a live server with the login doors open.
//
// Every home here comes from mkdtempSync and is removed by the test that made it. Nothing in this
// file reads or writes a real ~/.loam.
//
// The login helpers are deliberately LOW-LEVEL — `beginLogin` and `postLogin` are separate, and
// every guard header is a parameter — because four of §36's criteria are about what happens when a
// browser-shaped request is missing one of them. A single `login()` that always sent the right
// headers would hide exactly the states those rails exist to pin.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { serve, type ServerHandle, type UserDoorOptions } from "../../src/server/http.js";
import { run } from "../../src/cli/cli.js";
import { initHome, readSeed, storePath } from "../../src/cli/config.js";
import { SESSION_COOKIE } from "../../src/server/session.js";

// scrypt at production cost is ~100ms a call, and one rail spends six of them on purpose. These
// params keep the suite quick while leaving the ALGORITHM and the comparison exactly as shipped.
export const TEST_SCRYPT = { N: 1024, r: 8, p: 1, keylen: 64 } as const;

export const PASSWORD = "correct horse battery staple";

export interface TestIo {
  readonly out: string[];
  readonly err: string[];
  readonly io: { out(line: string): void; err(line: string): void };
}

export function testIo(): TestIo {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

export function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "loam-users-"));
}

export function dropHome(home: string): void {
  // maxRetries rides out a Windows EBUSY if the OS has not released a just-closed sqlite handle.
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Init the home and land genesis in its store, so a later `user create` appends nothing else. */
export async function bootStore(home: string): Promise<void> {
  initHome(home);
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  await gateway.close();
}

/** Every delta the home's store holds, read straight off the backend — the delta level. */
export async function storeDeltas(home: string): Promise<
  {
    id: string;
    claims: { author: string; timestamp: number; pointers: readonly unknown[] };
  }[]
> {
  const backend = new SqliteBackend(storePath(home));
  const deltas = await backend.deltasSince(new Set());
  await backend.close();
  return deltas;
}

/** Run `loam user create`, answering both password prompts with `password`. */
export async function createUser(
  home: string,
  name: string,
  password: string,
  opts: { operator?: boolean; confirm?: string } = {},
): Promise<{ code: number; io: TestIo }> {
  const io = testIo();
  const answers = [password, opts.confirm ?? password];
  const code = await run(
    ["user", "create", name, ...(opts.operator === false ? [] : ["--operator"]), "--home", home],
    io.io,
    { readSecret: () => Promise.resolve(answers.shift() ?? ""), scrypt: TEST_SCRYPT },
  );
  return { code: code as number, io };
}

export interface Served {
  readonly handle: ServerHandle;
  readonly gateway: Gateway;
  readonly base: string;
  close(): Promise<void>;
}

/** Serve the home's store with the login doors open. */
export async function serveHome(
  home: string,
  users: Partial<UserDoorOptions> = {},
  tokens: Record<string, { actor?: string; operator?: true }> = { "op-token": { operator: true } },
  prepare?: (gateway: Gateway) => void | Promise<void>,
): Promise<Served> {
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  await prepare?.(gateway);
  const handle = await serve({
    mounts: { default: gateway },
    tokens,
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", scrypt: TEST_SCRYPT, ...users },
  });
  // close() is IDEMPOTENT on purpose: a test that restarts the server mid-way leaves the module-level
  // handle pointing at a closed one, and an afterEach that closed it twice would fail every test
  // downstream with a fault that has nothing to do with what it was asserting.
  let closed = false;
  return {
    handle,
    gateway,
    base: handle.url,
    async close() {
      if (closed) return;
      closed = true;
      await handle.close();
      await gateway.close();
    },
  };
}

// Imported, never re-typed: a rail that spelled the cookie name itself would go quietly green if the
// shipped name changed, and the name carries the `__Host-` prefix that host-locks it.
export { SESSION_COOKIE } from "../../src/server/session.js";

/**
 * The login door's own refusal, pinned. It is deliberately DIFFERENT from the mount-level
 * "a bearer token is required" refusal — without that difference, a rail asserting "a wrong password
 * answers 401" would pass on a store where `/login` is just an unresolvable mount name.
 */
export const LOGIN_REFUSED_BODY = JSON.stringify({ errors: ["the login was refused"] });

/** The session id a Set-Cookie header carries, or undefined when it carries none. */
export function cookieFrom(res: Response): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return header?.slice(`${SESSION_COOKIE}=`.length).split(";")[0];
}

/** Everything after the cookie's value — the attribute string criteria (d) and (e) pin. */
export function cookieAttributes(res: Response): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (header === undefined) return undefined;
  const semi = header.indexOf(";");
  return semi < 0 ? "" : header.slice(semi + 2);
}

const FORM_TOKEN = /name="form_token" value="([^"]+)"/;

/** GET /login: the pre-session cookie and the form token its page carries. */
export async function beginLogin(
  base: string,
): Promise<{ cookie: string; formToken: string; res: Response; body: string }> {
  const res = await fetch(`${base}/login`);
  const body = await res.text();
  return {
    cookie: cookieFrom(res) ?? "",
    formToken: FORM_TOKEN.exec(body)?.[1] ?? "",
    res,
    body,
  };
}

/** The form token a signed-in page carries — how a caller chains to /logout or /session/token. */
export async function formTokenFor(base: string, cookie: string): Promise<string> {
  const res = await fetch(`${base}/login`, { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
  return FORM_TOKEN.exec(await res.text())?.[1] ?? "";
}

export interface PostOptions {
  readonly cookie?: string;
  /** Explicitly `undefined` sends no form token at all — a shape criterion (i) has to reach. */
  readonly formToken?: string | undefined;
  /** Omit for the browser-shaped default (`same-origin`); null sends none at all. */
  readonly secFetchSite?: string | null;
  readonly origin?: string;
  readonly headers?: Record<string, string>;
}

const guardHeaders = (opts: PostOptions): Record<string, string> => ({
  ...(opts.cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${opts.cookie}` }),
  ...(opts.secFetchSite === null ? {} : { "sec-fetch-site": opts.secFetchSite ?? "same-origin" }),
  ...(opts.origin === undefined ? {} : { origin: opts.origin }),
  ...opts.headers,
});

/** POST /login, form-encoded, exactly as the page's own form does. */
export function postLogin(
  base: string,
  name: string,
  password: string,
  opts: PostOptions = {},
): Promise<Response> {
  const body = new URLSearchParams({
    user: name,
    password,
    ...(opts.formToken === undefined ? {} : { form_token: opts.formToken }),
  });
  return fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...guardHeaders(opts) },
    body: body.toString(),
  });
}

/** POST /logout or POST /session/token — same body shape, same guards. */
export function postDoor(base: string, path: string, opts: PostOptions = {}): Promise<Response> {
  const body = new URLSearchParams(
    opts.formToken === undefined ? {} : { form_token: opts.formToken },
  );
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...guardHeaders(opts) },
    body: body.toString(),
  });
}

/** Sign in and hold everything a later request needs: the cookie and the live form token. */
export async function signIn(
  base: string,
  name = "myk",
  password = PASSWORD,
): Promise<{ cookie: string; formToken: string }> {
  const begun = await beginLogin(base);
  const res = await postLogin(base, name, password, {
    cookie: begun.cookie,
    formToken: begun.formToken,
  });
  if (res.status !== 200) throw new Error(`the fixture could not sign in: ${res.status}`);
  const cookie = cookieFrom(res) ?? begun.cookie;
  return { cookie, formToken: await formTokenFor(base, cookie) };
}
