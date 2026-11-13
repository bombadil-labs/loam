import { request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import {
  decoyParamsFor,
  hashPassword,
  paramsDisagree,
  spendDecoyHash,
  writeCredentials,
  type ScryptParams,
} from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import {
  COOKIE_ATTRIBUTES,
  CSP,
  PRESESSION_COOKIE,
  SESSION_COOKIE,
} from "../../src/server/session.js";

vi.setConfig({ testTimeout: 20000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

interface StoreShape {
  readonly ground?: Record<string, readonly ("operator" | "actor")[]>;
  readonly passwords?: Record<string, string>;
  readonly scryptFor?: Record<string, ScryptParams>;
  readonly seedless?: boolean;
}

async function userGateway(
  shape: StoreShape,
): Promise<{ gateway: Gateway; roleDeltaIds: string[] }> {
  const gateway = await Gateway.open(
    new MemoryBackend(),
    shape.seedless === true ? {} : { seed: OPERATOR_SEED },
  );
  let ts = 9001;
  const roleDeltaIds: string[] = [];
  for (const [name, roles] of Object.entries(shape.ground ?? {})) {
    await gateway.append([signClaims(userClaims(name, OPERATOR, ts++), OPERATOR_SEED)]);
    for (const role of roles) {
      const delta = signClaims(roleClaims(name, role, OPERATOR, ts++), OPERATOR_SEED);
      roleDeltaIds.push(delta.id);
      await gateway.append([delta]);
    }
  }
  return { gateway, roleDeltaIds };
}

async function makeHome(shape: StoreShape): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "loam-login-door-"));
  homes.push(home);
  const users: Record<string, Awaited<ReturnType<typeof hashPassword>>> = {};
  for (const [name, password] of Object.entries(shape.passwords ?? {})) {
    users[name] = await hashPassword(password, shape.scryptFor?.[name] ?? CHEAP);
  }
  writeCredentials(home, { version: 1, users });
  return home;
}

async function loginServer(
  shape: StoreShape = { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
  doorOptions: Record<string, unknown> = {},
): Promise<{
  base: string;
  handle: ServerHandle;
  gateway: Gateway;
  home: string;
  roleDeltaIds: string[];
}> {
  const { gateway, roleDeltaIds } = await userGateway(shape);
  const home = await makeHome(shape);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", ...doorOptions },
  });
  handles.push(handle);
  return { base: handle.url, handle, gateway, home, roleDeltaIds };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();

const valueOf = (header: string): string => {
  const eq = header.indexOf("=");
  return header.slice(eq + 1, header.indexOf(";"));
};

async function getLogin(base: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/login`, { headers, redirect: "manual" });
}

const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

async function postLogin(
  base: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...SAME_ORIGIN, ...headers },
    body,
  });
}

async function formPair(base: string): Promise<{ token: string; nonceCookie: string }> {
  const form = await getLogin(base);
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
  expect(nonceCookie).toBeDefined();
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())?.[1];
  expect(token).toBeTruthy();
  return { token: token!, nonceCookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie!)}` };
}

async function attemptLogin(base: string, user: string, password: string): Promise<Response> {
  const pair = await formPair(base);
  return postLogin(
    base,
    new URLSearchParams({ form_token: pair.token, user, password }).toString(),
    { cookie: pair.nonceCookie },
  );
}

async function signIn(
  base: string,
  user: string,
  password: string,
): Promise<{ res: Response; sessionId: string; formToken: string }> {
  const pair = await formPair(base);
  const res = await postLogin(
    base,
    new URLSearchParams({ form_token: pair.token, user, password }).toString(),
    { cookie: pair.nonceCookie },
  );
  const sessionCookie = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const body = await res.clone().text();
  const sessionToken = /name="form_token" value="([^"]+)"/.exec(body)?.[1];
  return {
    res,
    sessionId: sessionCookie === undefined ? "" : valueOf(sessionCookie),
    formToken: sessionToken ?? pair.token,
  };
}

async function postLogout(base: string, sessionId: string, formToken: string): Promise<Response> {
  return fetch(`${base}/logout`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: formToken }).toString(),
  });
}

describe("§36 phase 5 — the login door", () => {
  it("(a) GET issues the token surface; POST accepts it and ignores its absence", async () => {
    const { base } = await loginServer();
    const form = await getLogin(base);
    expect(form.status).toBe(200);
    const preCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
    expect(preCookie).toBeDefined();
    const html = await form.text();
    const token = /name="form_token" value="([^"]+)"/.exec(html)?.[1];
    expect(token).toBeTruthy();

    const withToken = await signIn(base, "myk", PASSWORD);
    expect(withToken.res.status).toBe(200);
    expect(await withToken.res.text()).toContain("Signed in");
  });

  it("(b) the pre-session has its own cookie, and a nonce write cannot orphan a session", async () => {
    const { base } = await loginServer();
    const anonymous = await getLogin(base);
    const anonCookies = cookiesOf(anonymous);
    expect(anonCookies.some((c) => c.startsWith(`${PRESESSION_COOKIE}=`))).toBe(true);
    expect(anonCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    const { sessionId } = await signIn(base, "myk", PASSWORD);
    expect(sessionId).not.toBe("");

    const signedIn = await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` });
    expect(await signedIn.text()).toContain("Signed in");
    expect(cookiesOf(signedIn)).toEqual([]);

    const crossSite = await getLogin(base, { "sec-fetch-site": "cross-site" });
    const crossCookies = cookiesOf(crossSite);
    expect(crossCookies.some((c) => c.startsWith(`${PRESESSION_COOKIE}=`))).toBe(true);
    expect(crossCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    const after = await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` });
    expect(await after.text()).toContain("Signed in");
  });

  it("(c) the attribute string is one pinned literal, no Domain anywhere", async () => {
    const { base } = await loginServer();
    expect(COOKIE_ATTRIBUTES).toBe("HttpOnly; Secure; SameSite=Lax; Path=/");
    const form = await getLogin(base);
    for (const header of cookiesOf(form)) {
      expect(header.endsWith(`; ${COOKIE_ATTRIBUTES}`)).toBe(true);
      expect(header).not.toContain("Domain");
    }
    const { res, sessionId, formToken } = await signIn(base, "myk", PASSWORD);
    const setters = cookiesOf(res);
    expect(setters.length).toBeGreaterThan(0);
    for (const header of setters) {
      expect(
        header.endsWith(`; ${COOKIE_ATTRIBUTES}`) ||
          header.endsWith(`; ${COOKIE_ATTRIBUTES}; Max-Age=0`),
      ).toBe(true);
      expect(header).not.toContain("Domain");
    }
    const out = await postLogout(base, sessionId, formToken);
    const clears = cookiesOf(out);
    expect(clears.length).toBe(2);
    for (const header of clears)
      expect(header.endsWith(`; ${COOKIE_ATTRIBUTES}; Max-Age=0`)).toBe(true);
  });

  it("(d) the cookie string is header-blind, raw Host included", async () => {
    const { base } = await loginServer();
    const plain = await getLogin(base);
    const forwarded = await getLogin(base, {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "evil.example",
    });
    expect(cookiesOf(plain).length).toBeGreaterThan(0);
    const shapeOf = (headers: string[]): string[] =>
      headers.map((h) => h.replace(/=[^;]*/, "=<nonce>"));
    expect(shapeOf(cookiesOf(forwarded))).toEqual(shapeOf(cookiesOf(plain)));

    const u = new URL(base);
    const rawSetCookie = await new Promise<string[]>((resolve, reject) => {
      const req = request(
        {
          host: u.hostname,
          port: u.port,
          path: "/login",
          headers: { host: "evil.example:9443" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.headers["set-cookie"] ?? []));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(shapeOf(rawSetCookie)).toEqual(shapeOf(cookiesOf(plain)));
  });

  it("(e) exactly one session cookie is set, and a doubled cookie reads as none", async () => {
    const { base } = await loginServer();
    const { res, sessionId } = await signIn(base, "myk", PASSWORD);
    const sessionSetters = cookiesOf(res).filter((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionSetters.length).toBe(1);
    const preClears = cookiesOf(res).filter((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
    expect(preClears.length).toBe(1);
    expect(preClears[0]).toContain("Max-Age=0");

    const doubled = await getLogin(base, {
      cookie: `${SESSION_COOKIE}=${sessionId}; ${SESSION_COOKIE}=${sessionId}`,
    });
    const body = await doubled.text();
    expect(body).not.toContain("Signed in");
    expect(body).toContain("form_token");
  });

  it("(f) login over a live session mints a different id, and the old id opens nothing", async () => {
    const { base } = await loginServer();
    const first = await signIn(base, "myk", PASSWORD);
    expect(first.sessionId).not.toBe("");

    const page = await getLogin(base, { cookie: `${SESSION_COOKIE}=${first.sessionId}` });
    const token = /name="form_token" value="([^"]+)"/.exec(await page.text())?.[1];
    expect(token).toBeTruthy();
    const again = await postLogin(
      base,
      new URLSearchParams({ form_token: token!, user: "myk", password: PASSWORD }).toString(),
      { cookie: `${SESSION_COOKIE}=${first.sessionId}` },
    );
    expect(again.status).toBe(200);
    const second = cookiesOf(again).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(second).toBeDefined();
    expect(valueOf(second!)).not.toBe(first.sessionId);

    const stale = await getLogin(base, { cookie: `${SESSION_COOKIE}=${first.sessionId}` });
    expect(await stale.text()).not.toContain("Signed in");
    const fresh = await getLogin(base, { cookie: `${SESSION_COOKIE}=${valueOf(second!)}` });
    expect(await fresh.text()).toContain("Signed in");
  });

  it("(g) one refusal for three causes, with the positive control", async () => {
    const { base } = await loginServer({
      ground: { myk: ["operator"], norole: [] },
      passwords: { myk: PASSWORD, norole: "quiet water" },
    });
    const attempt = (user: string, password: string): Promise<Response> =>
      attemptLogin(base, user, password);

    const wrongPassword = await attempt("myk", "not it");
    const unknownName = await attempt("ghost", "anything");
    const roleless = await attempt("norole", "quiet water");
    expect(wrongPassword.status).toBe(401);
    expect(unknownName.status).toBe(401);
    expect(roleless.status).toBe(401);
    const bodies = await Promise.all([wrongPassword.text(), unknownName.text(), roleless.text()]);
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);

    const good = await attempt("myk", PASSWORD);
    expect(good.status).toBe(200);
  });

  it("(h) the whole CSP is one pinned literal on every page, and no page carries script", async () => {
    const { base } = await loginServer();
    expect(CSP).toBe(
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
        "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const form = await getLogin(base);
    const { res, sessionId, formToken } = await signIn(base, "myk", PASSWORD);
    const out = await postLogout(base, sessionId, formToken);
    for (const page of [form, res, out]) {
      expect(page.headers.get("content-security-policy")).toBe(CSP);
    }
    for (const body of await Promise.all([form.text(), res.text(), out.text()])) {
      expect(body).not.toContain("<script");
    }
  });

  it("(i) the pre-§36 bytes survive: data doors and /login answer as before", async () => {
    const shape: StoreShape = { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } };
    const withUsers = await loginServer(shape);
    const bare = await serve({
      mounts: { default: (await userGateway(shape)).gateway },
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
    });
    handles.push(bare);

    const probes: (readonly [string, RequestInit?])[] = [
      [
        "/default/graphql",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"query":"{ __typename }"}',
        },
      ],
      [
        "/default/append",
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      ],
      [
        "/default/mcp",
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      ],
    ];
    for (const [path, init] of probes) {
      const a = await fetch(`${withUsers.base}${path}`, init);
      const b = await fetch(`${bare.url}${path}`, init);
      expect(a.status).toBe(b.status);
      expect(await a.text()).toBe(await b.text());
    }
    const login = await fetch(`${bare.url}/login`);
    const other = await fetch(`${bare.url}/zzz`);
    expect(login.status).toBe(other.status);
    expect(await login.text()).toBe(await other.text());
  });

  it("(j) a session cookie opens no data door", async () => {
    const { base } = await loginServer();
    const { sessionId } = await signIn(base, "myk", PASSWORD);
    const probes: (readonly [string, RequestInit])[] = [
      [
        "/default/graphql",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"query":"{ __typename }"}',
        },
      ],
      [
        "/default/append",
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      ],
      [
        "/default/mcp",
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      ],
    ];
    for (const [path, init] of probes) {
      const anonymous = await fetch(`${base}${path}`, init);
      const withCookie = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...init.headers, cookie: `${SESSION_COOKIE}=${sessionId}` },
      });
      expect(withCookie.status).toBe(anonymous.status);
      expect(await withCookie.text()).toBe(await anonymous.text());
    }
  });

  it("(k) logout ends the session; logout with no session answers 401", async () => {
    const { base } = await loginServer();
    const { sessionId, formToken } = await signIn(base, "myk", PASSWORD);
    const out = await postLogout(base, sessionId, formToken);
    expect(out.status).toBe(200);
    expect(await out.text()).toContain("Signed out");
    const clears = cookiesOf(out);
    expect(clears.length).toBe(2);
    for (const header of clears) expect(header).toContain("Max-Age=0");

    const stale = await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` });
    expect(await stale.text()).not.toContain("Signed in");

    const orphan = await fetch(`${base}/logout`, { method: "POST", headers: SAME_ORIGIN });
    expect(orphan.status).toBe(401);
  });

  it("(n) method discipline: the doors name POST", async () => {
    const { base } = await loginServer();
    const getLogout = await fetch(`${base}/logout`);
    expect(getLogout.status).toBe(405);
    expect(await getLogout.text()).toContain("POST");
    const putLogin = await fetch(`${base}/login`, { method: "PUT" });
    expect(putLogin.status).toBe(405);
    expect(await putLogin.text()).toContain("POST");
  });

  it("(o) the session dies of inactivity on the injected clock, and a backstep cannot revive it", async () => {
    let clock = 0;
    const { base } = await loginServer(undefined, {
      idleMs: 1000,
      monotonicNow: () => clock,
    });
    const { sessionId } = await signIn(base, "myk", PASSWORD);

    clock = 900;
    expect(
      await (await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` })).text(),
    ).toContain("Signed in");
    clock = 1800;
    expect(
      await (await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` })).text(),
    ).toContain("Signed in");

    clock = 3000;
    const lapsed = await (
      await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` })
    ).text();
    expect(lapsed).not.toContain("Signed in");
    expect(lapsed).toContain("Sign in.");
    clock = 100;
    const revenant = await (
      await getLogin(base, { cookie: `${SESSION_COOKIE}=${sessionId}` })
    ).text();
    expect(revenant).not.toContain("Signed in");
    expect(revenant).toContain("Sign in.");
  });

  it("(p) the table refuses past its cap, never evicts a live session, and sweeps lapsed rows", async () => {
    let clock = 0;
    const { base } = await loginServer(undefined, {
      idleMs: 1000,
      maxSessions: 1,
      monotonicNow: () => clock,
    });
    const first = await signIn(base, "myk", PASSWORD);
    expect(first.res.status).toBe(200);

    const second = await attemptLogin(base, "myk", PASSWORD);
    expect(second.status).toBe(503);
    expect(
      await (await getLogin(base, { cookie: `${SESSION_COOKIE}=${first.sessionId}` })).text(),
    ).toContain("Signed in");

    const replaced = await postLogin(
      base,
      new URLSearchParams({
        form_token: first.formToken,
        user: "myk",
        password: PASSWORD,
      }).toString(),
      { cookie: `${SESSION_COOKIE}=${first.sessionId}` },
    );
    expect(replaced.status).toBe(200);
    const replacedCookie = cookiesOf(replaced).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(replacedCookie).toBeDefined();
    expect(valueOf(replacedCookie!)).not.toBe(first.sessionId);

    clock = 5000;
    const third = await signIn(base, "myk", PASSWORD);
    expect(third.res.status).toBe(200);
  });

  it("(q) the hash cap refuses the surplus with no hash spent, and recovers", async () => {
    const SLOW: ScryptParams = { N: 65536, r: 8, p: 2, keylen: 32 };
    const { base } = await loginServer(
      {
        ground: { myk: ["operator"], slow: ["operator"] },
        passwords: { myk: PASSWORD, slow: "ponderous" },
        scryptFor: { slow: SLOW },
      },
      { maxConcurrentHashes: 1 },
    );
    const pair = await formPair(base);
    const withPair = (user: string, password: string): Promise<Response> =>
      postLogin(base, new URLSearchParams({ form_token: pair.token, user, password }).toString(), {
        cookie: pair.nonceCookie,
      });
    let slowSettled = false;
    const slowLogin = withPair("slow", "ponderous").then((res) => {
      slowSettled = true;
      return res;
    });
    let sawBusy: Response | undefined;
    while (sawBusy === undefined && !slowSettled) {
      const probe = await withPair("myk", PASSWORD);
      if (probe.status === 503) sawBusy = probe;
    }
    expect(sawBusy, "the slow hash settled before any probe met the cap").toBeDefined();
    expect((await sawBusy!.text()).toLowerCase()).toContain("busy");

    expect((await slowLogin).status).toBe(200);
    const recovered = await withPair("myk", PASSWORD);
    expect(recovered.status).toBe(200);
  });

  it("(r) wire-encoded credentials round-trip; a lone % is a 401, never a 503", async () => {
    const tricky = "a+b c%wö";
    const { base } = await loginServer({
      ground: { myk: ["operator"] },
      passwords: { myk: tricky },
    });
    const pair = await formPair(base);
    const wire = `form_token=${encodeURIComponent(pair.token)}&user=myk&password=${encodeURIComponent(
      tricky,
    ).replace(/%20/g, "+")}`;
    expect(wire).toContain("+");
    const good = await postLogin(base, wire, { cookie: pair.nonceCookie });
    expect(good.status).toBe(200);

    const page = await getLogin(base);
    expect(page.headers.get("content-type")).toContain("charset=utf-8");

    const mangledPair = await formPair(base);
    const mangled = await postLogin(
      base,
      `form_token=${encodeURIComponent(mangledPair.token)}&user=myk&password=%zz%`,
      { cookie: mangledPair.nonceCookie },
    );
    expect(mangled.status).toBe(401);
  });

  it("(s) cannot-decide is not gone: seedless ground and vanished mount answer 503; a struck role drops", async () => {
    const seedless = await loginServer({
      seedless: true,
      ground: {},
      passwords: { myk: PASSWORD },
    });
    const refused = await attemptLogin(seedless.base, "myk", PASSWORD);
    expect(refused.status).toBe(503);

    const { gateway: dynGateway } = await userGateway({ ground: { myk: ["operator"] } });
    const dynHome = await makeHome({ passwords: { myk: PASSWORD } });
    const dynHandle = await serve({
      mounts: {},
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
      users: { home: dynHome, mount: "dyn" },
    });
    handles.push(dynHandle);
    dynHandle.addMount("dyn", dynGateway);
    const { sessionId } = await signIn(dynHandle.url, "myk", PASSWORD);
    const removed = await dynHandle.removeMount("dyn");
    expect(removed).toBe(true);
    const during = await getLogin(dynHandle.url, { cookie: `${SESSION_COOKIE}=${sessionId}` });
    expect(during.status).toBe(503);
    dynHandle.addMount("dyn", dynGateway);
    const after = await getLogin(dynHandle.url, { cookie: `${SESSION_COOKIE}=${sessionId}` });
    expect(await after.text()).toContain("Signed in");

    const struck = await loginServer();
    const live = await signIn(struck.base, "myk", PASSWORD);
    expect(live.sessionId).not.toBe("");
    expect(struck.roleDeltaIds.length).toBeGreaterThan(0);
    for (const id of struck.roleDeltaIds) {
      await struck.gateway.append([
        signClaims(makeNegationClaims(OPERATOR, 9900, id), OPERATOR_SEED),
      ]);
    }
    const dropped = await getLogin(struck.base, { cookie: `${SESSION_COOKIE}=${live.sessionId}` });
    expect(await dropped.text()).not.toContain("Signed in");
    expect(
      await (await getLogin(struck.base, { cookie: `${SESSION_COOKIE}=${live.sessionId}` })).text(),
    ).not.toContain("Signed in");
  });

  it("(u) the decoy machinery is not deletable whole: parameter borrowing, disagreement, and its one warning", async () => {
    const cheapEntry = await hashPassword("x", CHEAP);
    const dearEntry = await hashPassword("y", { ...CHEAP, N: 2048 });
    const uniform = {
      version: 1 as const,
      users: { a: cheapEntry, b: await hashPassword("z", CHEAP) },
    };
    const mixed = { version: 1 as const, users: { a: cheapEntry, b: dearEntry } };
    const empty = { version: 1 as const, users: {} };
    const FALLBACK: ScryptParams = { N: 4096, r: 8, p: 1, keylen: 32 };
    expect(decoyParamsFor(uniform, FALLBACK)).toEqual(CHEAP);
    expect(decoyParamsFor(empty, FALLBACK)).toEqual(FALLBACK);
    expect(paramsDisagree(uniform)).toBe(false);
    expect(paramsDisagree(mixed)).toBe(true);
    expect(await spendDecoyHash("anything", CHEAP)).toBe(false);

    const faults: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { onFault: (m: string) => faults.push(m) },
    );
    expect(faults.filter((m) => m.includes("scrypt"))).toEqual([]);
    writeCredentials(home, mixed);
    await attemptLogin(base, "a", "x");
    await attemptLogin(base, "a", "x");
    expect(faults.filter((m) => m.includes("scrypt cost")).length).toBe(1);
  });

  it("(v) a fault's detail reaches the operator channel and never the caller", async () => {
    const faults: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { onFault: (m: string) => faults.push(m) },
    );
    const pair = await formPair(base);
    rmSync(join(home, "credentials.json"));
    mkdirSync(join(home, "credentials.json"));
    const refused = await postLogin(
      base,
      new URLSearchParams({ form_token: pair.token, user: "myk", password: PASSWORD }).toString(),
      { cookie: pair.nonceCookie },
    );
    expect(refused.status).toBe(503);
    const body = await refused.text();
    expect(body).not.toContain(home);
    expect(body).not.toContain("credentials.json");
    expect(faults.some((m) => m.includes(home))).toBe(true);
  });
});
