// §36 phase 7 — the bearer bridge (T128). Criteria (a)–(k) of
// .adlc/specs/36-07-the-bearer-bridge.md, transcribed.
//
// What this file deliberately does NOT assert, and which phase owns each gap:
//   - WHOSE key signs a session's write. Phase 8 (test/server/session-authorship.test.ts) owns
//     authorship; (c) rails only that the write lands and resolves, because a rail here would
//     freeze exactly what that phase must change.
//   - The failed-login delay's interaction with minting: phase 9.
//   - `createSessionTable`'s own semantics: it is a SECOND, unused implementation (see the
//     working spec's named gap and its ticket). test/server/session-table.test.ts is green about
//     code no request in this file executes.

import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./../gateway/fixtures.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR, observed } from "../spike/garden.js";
import { toWire } from "../../src/federation/wire.js";

vi.setConfig({ testTimeout: 25000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

interface Shape {
  readonly roles?: readonly ("operator" | "actor")[];
  readonly doorOptions?: Record<string, unknown>;
  /** A second static mount, for the boot guard. */
  readonly extraMount?: boolean;
}

async function plantedGateway(roles: readonly ("operator" | "actor")[]): Promise<{
  gateway: Gateway;
  roleDeltaIds: string[];
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  // The garden fixture's deltas are signed by GARDENER; write standing is a surviving grant at
  // the store entity, so the operator says so first (the same shape test/server/http.test.ts uses).
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9000), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9001), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.append([signClaims(userClaims("myk", OPERATOR, 9001), OPERATOR_SEED)]);
  const roleDeltaIds: string[] = [];
  let ts = 9002;
  for (const role of roles) {
    const delta = signClaims(roleClaims("myk", role, OPERATOR, ts++), OPERATOR_SEED);
    roleDeltaIds.push(delta.id);
    await gateway.append([delta]);
  }
  return { gateway, roleDeltaIds };
}

async function bridgeServer(shape: Shape = {}): Promise<{
  base: string;
  handle: ServerHandle;
  gateway: Gateway;
  home: string;
  roleDeltaIds: string[];
}> {
  const { gateway, roleDeltaIds } = await plantedGateway(shape.roles ?? ["operator"]);
  const home = mkdtempSync(join(tmpdir(), "loam-session-token-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", ...(shape.doorOptions ?? {}) },
  });
  handles.push(handle);
  return { base: handle.url, handle, gateway, home, roleDeltaIds };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string => {
  const eq = header.indexOf("=");
  return header.slice(eq + 1, header.indexOf(";"));
};

async function signIn(base: string): Promise<{ sessionId: string; sessionToken: string }> {
  const form = await fetch(`${base}/login`);
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())?.[1];
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${nonce}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token!, user: "myk", password: PASSWORD }).toString(),
  });
  expect(res.status).toBe(200);
  const sessionId = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
  const sessionToken = /name="form_token" value="([^"]+)"/.exec(await res.text())?.[1];
  return { sessionId, sessionToken: sessionToken! };
}

/** The mint door, as the store's own signed-in page would ask. */
async function mint(
  base: string,
  session: { sessionId: string; sessionToken: string },
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}/session/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${session.sessionId}`,
      ...SAME_ORIGIN,
      ...headers,
    },
    body: new URLSearchParams({ form_token: session.sessionToken }).toString(),
  });
}

const READ = '{"query":"{ __typename }"}';
const gql = (base: string, token?: string): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: READ,
  });

const signedInPage = async (base: string, sessionId: string): Promise<string> =>
  (await fetch(`${base}/login`, { headers: { cookie: `${SESSION_COOKIE}=${sessionId}` } })).text();

describe("§36 phase 7 — the bearer bridge", () => {
  it("(a) the cookie alone opens no JSON door — and the cookie is proven live either side", async () => {
    const { base } = await bridgeServer();
    const session = await signIn(base);
    // Control 1: this exact cookie authenticates something.
    expect(await signedInPage(base, session.sessionId)).toContain("Signed in");

    const probes: (readonly [string, RequestInit])[] = [
      [
        "/default/graphql",
        { method: "POST", headers: { "content-type": "application/json" }, body: READ },
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
        headers: { ...init.headers, cookie: `${SESSION_COOKIE}=${session.sessionId}` },
      });
      expect(withCookie.status, path).toBe(anonymous.status);
      const body = await withCookie.text();
      expect(body, path).toBe(await anonymous.text());
      // Not merely equal to itself: the known uniform refusal.
      expect(withCookie.status, path).toBe(401);
    }
    // Control 2: the cookie is STILL live after the comparison — so the equality above was about
    // the cookie being ignored, not about the cookie being dead.
    expect(await signedInPage(base, session.sessionId)).toContain("Signed in");
  });

  it("(b) the token opens a read door and a write door", async () => {
    const { base } = await bridgeServer();
    const session = await signIn(base);
    const res = await mint(base, session);
    expect(res.status).toBe(200);
    const minted = (await res.json()) as {
      token: string;
      expiresIn: number;
      user: string;
      roles: string[];
    };
    expect(minted.user).toBe("myk");
    expect(minted.roles).toContain("operator");
    expect(minted.expiresIn).toBeGreaterThan(0);

    const read = await gql(base, minted.token);
    expect(read.status).toBe(200);

    // (c) rides here: a real signed delta, carried by the session token, lands AND resolves.
    // Signed by GARDENER because `append` is the non-custodial door — every delta carries its
    // own author, and WHOSE key a session's write uses is phase 8's question, not this one's.
    const delta = observed(FERN, "note", "through the bridge", 41_000, GARDENER_SEED);
    const write = await fetch(`${base}/default/append`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${minted.token}`,
      },
      body: JSON.stringify({ deltas: [toWire(delta)] }),
    });
    expect(write.status).toBe(200);
    expect(((await write.json()) as { accepted: number }).accepted).toBe(1);

    const back = await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${minted.token}` },
      body: JSON.stringify({ query: `{ plant(entity: "${FERN}") { _view } }` }),
    });
    expect(JSON.stringify(await back.json())).toContain("through the bridge");
  });

  it("(c2) the token names the OPERATOR identity, not merely a valid one", async () => {
    const { base } = await bridgeServer();
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    // `register` is operator-gated; `append` is not (it is non-custodial — every delta carries
    // its own signed author), so only this door distinguishes {operator:true} from any other
    // identity. This is the assertion that turns red if mint were handed {actor: "nobody"}.
    const asSession = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${minted.token}` },
      body: "{}",
    });
    const asOperator = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: "{}",
    });
    // Both reach the door and fail on the BODY, identically — an unauthorized identity would be
    // refused before that, with the uniform 401.
    expect(asSession.status).toBe(asOperator.status);
    expect(asSession.status).not.toBe(401);
    expect(await asSession.text()).toBe(await asOperator.text());
  });

  it("(e) the token dies with its window; the session survives it", async () => {
    let clock = 0;
    const { base } = await bridgeServer({
      doorOptions: { monotonicNow: () => clock, tokenTtlMs: 1000, idleMs: 100_000 },
    });
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    expect((await gql(base, minted.token)).status).toBe(200);
    clock = 2000;
    expect((await gql(base, minted.token)).status).toBe(401);
    // The session outlives the token it minted.
    expect(await signedInPage(base, session.sessionId)).toContain("Signed in");
  });

  it("(f) every path that drops a session retires its tokens — all four", async () => {
    // 1. logout
    {
      const { base } = await bridgeServer();
      const session = await signIn(base);
      const minted = (await (await mint(base, session)).json()) as { token: string };
      expect((await gql(base, minted.token)).status).toBe(200); // positive control
      const out = await fetch(`${base}/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${SESSION_COOKIE}=${session.sessionId}`,
          ...SAME_ORIGIN,
        },
        body: new URLSearchParams({ form_token: session.sessionToken }).toString(),
      });
      expect(out.status).toBe(200);
      expect((await gql(base, minted.token)).status).toBe(401);
    }
    // 2. the idle sweep
    {
      let clock = 0;
      const { base } = await bridgeServer({
        doorOptions: { monotonicNow: () => clock, idleMs: 1000, tokenTtlMs: 100_000 },
      });
      const session = await signIn(base);
      const minted = (await (await mint(base, session)).json()) as { token: string };
      expect((await gql(base, minted.token)).status).toBe(200);
      clock = 5000;
      await fetch(`${base}/login`, {
        headers: { cookie: `${SESSION_COOKIE}=${session.sessionId}` },
      });
      expect((await gql(base, minted.token)).status).toBe(401);
    }
    // 3. the ground no longer holds a role, observed by GET /login
    {
      const { base, gateway, roleDeltaIds } = await bridgeServer();
      const session = await signIn(base);
      const minted = (await (await mint(base, session)).json()) as { token: string };
      expect((await gql(base, minted.token)).status).toBe(200);
      for (const id of roleDeltaIds) {
        await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9900, id), OPERATOR_SEED)]);
      }
      expect(await signedInPage(base, session.sessionId)).not.toContain("Signed in");
      expect((await gql(base, minted.token)).status).toBe(401);
    }
    // 4. a re-login over the live session (the fixation drop) — the shape a logout-only revoke
    //    leaks past, and the one that matters most: the fixated session's token must die with it.
    {
      const { base } = await bridgeServer();
      const session = await signIn(base);
      const minted = (await (await mint(base, session)).json()) as { token: string };
      expect((await gql(base, minted.token)).status).toBe(200);
      await signIn(base); // a fresh login; the old row is replaced
      const again = await fetch(`${base}/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${SESSION_COOKIE}=${session.sessionId}`,
          ...SAME_ORIGIN,
        },
        body: new URLSearchParams({
          form_token: session.sessionToken,
          user: "myk",
          password: PASSWORD,
        }).toString(),
      });
      expect(again.status).toBe(200);
      expect((await gql(base, minted.token)).status).toBe(401);
    }
  });

  it("(g) the per-session cap refuses and recovers, on ONE clock", async () => {
    let clock = 0;
    const { base } = await bridgeServer({
      doorOptions: {
        monotonicNow: () => clock,
        maxTokensPerSession: 2,
        tokenTtlMs: 1000,
        idleMs: 100_000,
      },
    });
    const session = await signIn(base);
    const first = (await (await mint(base, session)).json()) as { token: string };
    expect((await mint(base, session)).status).toBe(200);
    const third = await mint(base, session);
    expect(third.status).toBe(429);
    expect((await third.text()).toLowerCase()).toContain("token");

    // Past the first token's TTL: a mint succeeds AND that token is refused, asserted at the
    // SAME instant — two clocks behind the pair could not satisfy both.
    clock = 2000;
    const recovered = await mint(base, session);
    expect(recovered.status).toBe(200);
    expect((await gql(base, first.token)).status).toBe(401);
  });

  it("(h) the ground is re-read at mint time, three ways", async () => {
    // roles struck after sign-in → 401, session dropped
    {
      const { base, gateway, roleDeltaIds } = await bridgeServer();
      const session = await signIn(base);
      for (const id of roleDeltaIds) {
        await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9900, id), OPERATOR_SEED)]);
      }
      const refused = await mint(base, session);
      expect(refused.status).toBe(401);
      expect(await signedInPage(base, session.sessionId)).not.toContain("Signed in");
    }
    // an actor-only user → 403, session intact
    {
      const { base } = await bridgeServer({ roles: ["actor"] });
      const session = await signIn(base);
      const refused = await mint(base, session);
      expect(refused.status).toBe(403);
      expect(await signedInPage(base, session.sessionId)).toContain("Signed in");
    }
  });

  it("(j) the mint door is behind phase 6's guard, and wants a live session", async () => {
    const { base } = await bridgeServer();
    const session = await signIn(base);
    // cross-site shape
    const cross = await mint(base, session, { "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    // valid session cookie, no form token
    const untokened = await fetch(`${base}/session/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session.sessionId}`,
        ...SAME_ORIGIN,
      },
      body: "",
    });
    expect(untokened.status).toBe(403);
    // a stateless pre-session is enough to attempt a login, not to mint
    const form = await fetch(`${base}/login`);
    const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
    const preToken = /name="form_token" value="([^"]+)"/.exec(await form.text())?.[1];
    const preOnly = await fetch(`${base}/session/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${PRESESSION_COOKIE}=${nonce}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: preToken! }).toString(),
    });
    expect(preOnly.status).toBe(401);
    // and the positive control: the real shape still mints.
    expect((await mint(base, session)).status).toBe(200);
  });

  it("(k) the one-mount guard throws BEFORE the socket binds, on a port proven free", async () => {
    const PORT = 45_871;
    const { gateway: first } = await plantedGateway(["operator"]);
    const home = mkdtempSync(join(tmpdir(), "loam-session-token-"));
    homes.push(home);
    writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });

    // The port is FREE and the fixture otherwise valid: one mount binds and answers.
    const ok = await serve({
      mounts: { default: first },
      tokens: { "op-token": { operator: true } },
      port: PORT,
      host: "127.0.0.1",
      users: { home, mount: "default" },
    });
    expect((await fetch(`${ok.url}/login`)).status).toBe(200);
    await ok.close();

    // Two mounts, same port: the guard's OWN message, asserted by text.
    const { gateway: second } = await plantedGateway(["operator"]);
    await expect(
      serve({
        mounts: { default: first, other: second },
        tokens: { "op-token": { operator: true } },
        port: PORT,
        host: "127.0.0.1",
        users: { home, mount: "default" },
      }),
    ).rejects.toThrow(/login doors/i);

    // And no listener was left behind on that port.
    const refused = await new Promise<string>((resolve) => {
      const req = request({ host: "127.0.0.1", port: PORT, path: "/login" }, (res) => {
        res.resume();
        resolve(`answered ${res.statusCode}`);
      });
      req.on("error", (err: NodeJS.ErrnoException) => resolve(err.code ?? "error"));
      req.end();
    });
    expect(refused).toBe("ECONNREFUSED");

    // addMount refuses while the doors are open.
    const live = await bridgeServer();
    const { gateway: third } = await plantedGateway(["operator"]);
    expect(() => live.handle.addMount("second", third)).toThrow(/login doors/i);
  });

  it("(i) a container's appearance closes the MINT door rather than widening the token", async () => {
    const { base, gateway, handle } = await bridgeServer();
    const session = await signIn(base);
    // Two-sided: with one world, the mint succeeds.
    expect((await mint(base, session)).status).toBe(200);

    // A container must be DECLARED by the operator before it can be opened.
    await gateway.append([
      signClaims(
        containerClaims(
          { container: "thicket", trust: "curated", posture: "separate" },
          OPERATOR,
          30_100,
        ),
        OPERATOR_SEED,
      ),
    ]);
    const container = await gateway.openContainer({
      name: "thicket",
      backend: new MemoryBackend(),
    });
    // A container is DERIVED, not registered — serve()'s options never saw it. The mint door
    // asks the live table, so a second world closes it rather than being handed operator
    // authority no role binding named.
    const refused = await mint(base, session);
    expect(refused.status).toBe(503);
    expect((await refused.text()).toLowerCase()).toContain("thicket");

    // Nothing is taken from the operator: the STATIC token still answers that container.
    const asOperator = await fetch(`${base}/thicket/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: READ,
    });
    expect(asOperator.status).toBe(200);

    await container.drop();
    void handle;
    // The world is gone again: minting resumes.
    expect((await mint(base, session)).status).toBe(200);
  });
});
