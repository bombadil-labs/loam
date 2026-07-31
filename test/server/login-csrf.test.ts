// §36 phase 6 — cross-site defence (T127). Criteria (a)–(k) of
// .adlc/specs/36-06-cross-site-defence.md, transcribed. Phase 5's rail files are UNTOUCHED by
// this phase (criterion (j) is that claim, checked as a git diff in review and by rails-guard);
// every phase-5 POST already sends the token and the same-origin signal this phase starts
// refusing without.
//
// What this file deliberately does not assert: the failure COUNTER a cross-site POST must not
// fill — no counter exists until phase 9; (g) rails the property that implies it (the refusal
// evaluates no password), and phase 9 owns the counter proper.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { createHash } from "node:crypto";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";

vi.setConfig({ testTimeout: 20000 }); // real listening servers

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

async function csrfServer(doorOptions: Record<string, unknown> = {}): Promise<{
  base: string;
  handle: ServerHandle;
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([signClaims(userClaims("myk", OPERATOR, 9001), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, 9002), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-login-csrf-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", ...doorOptions },
  });
  handles.push(handle);
  return { base: handle.url, handle };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string => {
  const eq = header.indexOf("=");
  return header.slice(eq + 1, header.indexOf(";"));
};
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

async function formPair(base: string): Promise<{ token: string; nonce: string }> {
  const form = await fetch(`${base}/login`);
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
  expect(nonceCookie).toBeDefined();
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())?.[1];
  expect(token).toBeTruthy();
  return { token: token!, nonce: valueOf(nonceCookie!) };
}

function postLogin(
  base: string,
  fields: Record<string, string>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

/** A full, valid, same-origin sign-in; returns the session id and ITS page's form token. */
async function signIn(base: string): Promise<{ sessionId: string; sessionToken: string }> {
  const pair = await formPair(base);
  const res = await postLogin(
    base,
    { form_token: pair.token, user: "myk", password: PASSWORD },
    { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
  );
  expect(res.status).toBe(200);
  const sessionCookie = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  expect(sessionCookie).toBeDefined();
  const sessionToken = /name="form_token" value="([^"]+)"/.exec(await res.text())?.[1];
  expect(sessionToken).toBeTruthy();
  return { sessionId: valueOf(sessionCookie!), sessionToken: sessionToken! };
}

const signedInPage = async (base: string, sessionId: string): Promise<string> =>
  (await fetch(`${base}/login`, { headers: { cookie: `${SESSION_COOKIE}=${sessionId}` } })).text();

describe("§36 phase 6 — cross-site defence", () => {
  it("(a) the transition: a token-less login phase 5 admitted is now refused; the valid one succeeds", async () => {
    const { base } = await csrfServer();
    const pair = await formPair(base);
    const bare = await postLogin(
      base,
      { user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
    );
    expect(bare.status).toBe(403);
    expect(cookiesOf(bare)).toEqual([]);
    const full = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
    );
    expect(full.status).toBe(200);
  });

  it("(b) six cross-site shapes refuse logout, set no cookie, and change no session state", async () => {
    const { base } = await csrfServer();
    const { sessionId, sessionToken } = await signIn(base);
    const shapes: Record<string, string>[] = [
      {}, // no Origin, no Sec-Fetch-Site
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "none" },
      { origin: "https://evil.example" },
      { origin: "null" }, // a sandboxed context: refused outright, never a fall-through
      { origin: "null", "sec-fetch-site": "same-origin" },
    ];
    for (const shape of shapes) {
      const out = await fetch(`${base}/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${SESSION_COOKIE}=${sessionId}`,
          ...shape,
        },
        body: new URLSearchParams({ form_token: sessionToken }).toString(),
      });
      expect(out.status, JSON.stringify(shape)).toBe(403);
      expect(cookiesOf(out), JSON.stringify(shape)).toEqual([]);
    }
    // The state control: the session survived all six.
    expect(await signedInPage(base, sessionId)).toContain("Signed in");
  });

  it("(b2) a refused request slides no idle window; an admitted one does", async () => {
    let clock = 0;
    const { base } = await csrfServer({ idleMs: 1000, monotonicNow: () => clock });
    const first = await signIn(base);
    // Refused traffic at 900 must not extend the session past its 1000-tick window. The shape
    // matters: a SAME-ORIGIN request with a FORGED token is the one refusal that reads the
    // session row before refusing (a cross-site shape refuses before any session read), so it
    // is the path that could slide the window if peeking slid.
    clock = 900;
    const refused = await fetch(`${base}/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${first.sessionId}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: "forged" }).toString(),
    });
    expect(refused.status).toBe(403);
    clock = 1500;
    expect(await signedInPage(base, first.sessionId)).not.toContain("Signed in");

    // Two-sided: an ADMITTED request at 900 does slide the window to 1900.
    clock = 0;
    const second = await signIn(base);
    clock = 900;
    expect(await signedInPage(base, second.sessionId)).toContain("Signed in");
    clock = 1500;
    expect(await signedInPage(base, second.sessionId)).toContain("Signed in");
  });

  it("(b3) the /logout precedence phase 5 froze survives: same-origin orphan is 401, not 403", async () => {
    const { base } = await csrfServer();
    const orphan = await fetch(`${base}/logout`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(orphan.status).toBe(401);
    expect(await orphan.text()).toContain("no live session");
  });

  it("(b4) an early refusal leaves a clean keep-alive socket", async () => {
    const { base } = await csrfServer();
    const big = "x".repeat(8 * 1024 - 64);
    const refused = await fetch(`${base}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "cross-site",
      },
      body: new URLSearchParams({ user: "myk", password: big }).toString(),
    });
    expect(refused.status).toBe(403);
    await refused.text(); // fully readable
    // The next request on the same pooled connection answers normally.
    const next = await fetch(`${base}/login`);
    expect(next.status).toBe(200);
  });

  it("(c) Origin outranks the fetch-site hint, both directions", async () => {
    const { base } = await csrfServer();
    const pair = await formPair(base);
    const attempt = (headers: Record<string, string>): Promise<Response> =>
      postLogin(
        base,
        { form_token: pair.token, user: "myk", password: PASSWORD },
        { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...headers },
      );
    const foreign = await attempt({
      origin: "https://evil.example",
      "sec-fetch-site": "same-origin",
    });
    expect(foreign.status).toBe(403);
    // Positive control: the store's own origin beside the same hint succeeds.
    const { base: base2 } = await csrfServer();
    const pair2 = await formPair(base2);
    const own = await postLogin(
      base2,
      { form_token: pair2.token, user: "myk", password: PASSWORD },
      {
        cookie: `${PRESESSION_COOKIE}=${pair2.nonce}`,
        origin: base2,
        "sec-fetch-site": "same-origin",
      },
    );
    expect(own.status).toBe(200);
  });

  it("(d) forged tokens die: nonce itself, keyless digest, wrong-nonce token, empty, truncated", async () => {
    const { base } = await csrfServer();
    const pair = await formPair(base);
    const other = await formPair(base);
    const candidates: [string, string][] = [
      ["the nonce itself", pair.nonce],
      [
        "a keyless SHA-256 of the nonce",
        createHash("sha256").update(pair.nonce).digest("base64url"),
      ],
      ["a token minted for a different nonce", other.token],
      ["the empty string", ""],
      ["a valid token truncated by one", pair.token.slice(0, -1)],
    ];
    for (const [name, forged] of candidates) {
      const res = await postLogin(
        base,
        { form_token: forged, user: "myk", password: PASSWORD },
        { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
      );
      expect(res.status, name).toBe(403);
      expect(cookiesOf(res), name).toEqual([]);
    }
    // Positive control: the genuine pair still opens.
    const good = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
    );
    expect(good.status).toBe(200);
  });

  it("(e) a token issued for one cookie does not open another", async () => {
    const { base } = await csrfServer();
    const a = await formPair(base);
    const b = await formPair(base);
    const crossed = await postLogin(
      base,
      { form_token: a.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${b.nonce}`, ...SAME_ORIGIN },
    );
    expect(crossed.status).toBe(403);
    const matched = await postLogin(
      base,
      { form_token: a.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${a.nonce}`, ...SAME_ORIGIN },
    );
    expect(matched.status).toBe(200);
  });

  it("(f) once a session exists, its OWN token binds — the spent pre-session token does not", async () => {
    const { base } = await csrfServer();
    const pair = await formPair(base);
    const res = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
    );
    expect(res.status).toBe(200);
    const sessionId = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
    const sessionToken = /name="form_token" value="([^"]+)"/.exec(await res.text())?.[1];

    const withPreToken = await fetch(`${base}/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${sessionId}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: pair.token }).toString(),
    });
    expect(withPreToken.status).toBe(403);
    expect(await signedInPage(base, sessionId)).toContain("Signed in");

    const withSessionToken = await fetch(`${base}/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${sessionId}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: sessionToken! }).toString(),
    });
    expect(withSessionToken.status).toBe(200);
  });

  it("(g) a cross-site POST never reaches the hash gate — proven with the gate held shut", async () => {
    // Byte-identity alone is satisfied by hash-then-refuse (the premortem's point); parking a
    // slow scrypt on a cap of 1 makes the order observable: a cross-site POST that reached the
    // gate would answer the 503 busy body, not the provenance 403.
    const SLOW: ScryptParams = { N: 65536, r: 8, p: 2, keylen: 32 };
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([signClaims(userClaims("myk", OPERATOR, 9001), OPERATOR_SEED)]);
    await gateway.append([
      signClaims(roleClaims("myk", "operator", OPERATOR, 9002), OPERATOR_SEED),
    ]);
    await gateway.append([signClaims(userClaims("slow", OPERATOR, 9003), OPERATOR_SEED)]);
    await gateway.append([
      signClaims(roleClaims("slow", "operator", OPERATOR, 9004), OPERATOR_SEED),
    ]);
    const home = mkdtempSync(join(tmpdir(), "loam-login-csrf-"));
    homes.push(home);
    writeCredentials(home, {
      version: 1,
      users: {
        myk: await hashPassword(PASSWORD, CHEAP),
        slow: await hashPassword("ponderous", SLOW),
      },
    });
    const handle = await serve({
      mounts: { default: gateway },
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
      users: { home, mount: "default", maxConcurrentHashes: 1 },
    });
    handles.push(handle);
    const base = handle.url;

    const pair = await formPair(base);
    const withPair = (
      fields: Record<string, string>,
      headers: Record<string, string>,
    ): Promise<Response> =>
      postLogin(
        base,
        { form_token: pair.token, ...fields },
        {
          cookie: `${PRESESSION_COOKIE}=${pair.nonce}`,
          ...headers,
        },
      );

    let slowSettled = false;
    const slowLogin = withPair({ user: "slow", password: "ponderous" }, SAME_ORIGIN).then((res) => {
      slowSettled = true;
      return res;
    });
    // Witness that a same-origin probe DOES meet the busy gate, then that a cross-site probe
    // answers 403 in the same window — the refusal precedes the gate.
    let sawBusy = false;
    let crossDuring: Response | undefined;
    while ((!sawBusy || crossDuring === undefined) && !slowSettled) {
      if (!sawBusy) {
        const probe = await withPair({ user: "myk", password: PASSWORD }, SAME_ORIGIN);
        if (probe.status === 503) sawBusy = true;
      }
      if (crossDuring === undefined) {
        const cross = await withPair(
          { user: "myk", password: PASSWORD },
          { "sec-fetch-site": "cross-site" },
        );
        if (cross.status !== 200) crossDuring = cross;
      }
    }
    expect(sawBusy, "the busy gate was never witnessed — the fixture proved nothing").toBe(true);
    expect(crossDuring, "no cross-site probe landed inside the window").toBeDefined();
    expect(crossDuring!.status).toBe(403);
    await slowLogin;

    // The byte-identity control rides along: wrong and correct password, identical 403s.
    const wrong = await withPair(
      { user: "myk", password: "not it" },
      { "sec-fetch-site": "cross-site" },
    );
    const right = await withPair(
      { user: "myk", password: PASSWORD },
      { "sec-fetch-site": "cross-site" },
    );
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).toBe(await right.text());
  });

  it("(h) GET /login allocates nothing: a thousand of them leave the one seat open", async () => {
    const { base } = await csrfServer({ maxSessions: 1 });
    for (let i = 0; i < 1000; i += 1) {
      const res = await fetch(`${base}/login`);
      if (i === 0) expect(res.status).toBe(200);
      await res.body?.cancel();
    }
    const { sessionId } = await signIn(base);
    expect(sessionId).not.toBe("");
  });

  it("(i) the loopback widening admits the sibling spellings and nothing else", async () => {
    const { base } = await csrfServer();
    const port = new URL(base).port;
    const attempt = async (origin: string): Promise<number> => {
      const pair = await formPair(base);
      const res = await postLogin(
        base,
        { form_token: pair.token, user: "myk", password: PASSWORD },
        { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, origin },
      );
      return res.status;
    };
    // The bound URL is http://127.0.0.1:<port>; localhost on the SAME port is the same store.
    expect(await attempt(`http://localhost:${port}`)).toBe(200);
    expect(await attempt(`http://localhost:1`)).toBe(403);
    expect(await attempt("https://evil.example")).toBe(403);

    // The IPv6 spelling is real: URL.hostname keeps the brackets, and the widening must too.
    const { base: v6 } = await csrfServer({ publicUrl: "http://[::1]:9443" });
    const v6attempt = async (origin: string): Promise<number> => {
      const pair = await formPair(v6);
      const res = await postLogin(
        v6,
        { form_token: pair.token, user: "myk", password: PASSWORD },
        { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, origin },
      );
      return res.status;
    };
    expect(await v6attempt("http://localhost:9443")).toBe(200);
    expect(await v6attempt("http://localhost:1")).toBe(403);
  });

  it("(l) an unroutable public URL is a loud fault, not a silent universal 403", async () => {
    const faults: string[] = [];
    await csrfServer({
      publicUrl: "http://0.0.0.0:8080",
      onFault: (m: string) => faults.push(m),
    });
    expect(faults.filter((m) => m.includes("--public-url")).length).toBe(1);
  });

  it("(m) the 403 names the cure", async () => {
    const { base } = await csrfServer();
    const pair = await formPair(base);
    const refused = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, "sec-fetch-site": "cross-site" },
    );
    expect(refused.status).toBe(403);
    expect((await refused.text()).toLowerCase()).toContain("reload");
  });

  it("(k) an unparseable public URL fails closed on every Origin-bearing POST, and says so once", async () => {
    const faults: string[] = [];
    const { base } = await csrfServer({
      publicUrl: "https://[half-open",
      onFault: (m: string) => faults.push(m),
    });
    const pair = await formPair(base);
    const res = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, origin: "https://loam.example" },
    );
    expect(res.status).toBe(403);
    expect(faults.filter((m) => m.includes("public URL")).length).toBe(1);
  });
});
