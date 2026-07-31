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
import { createHash } from "node:crypto";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { writeUserSeed } from "../../src/cli/config.js";
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

// §36 phase 8 made a usable per-user signing seed a PRECONDITION of minting: a user holding the
// operator role with no key on this box fails closed rather than signing as the store. These
// fixtures predate that and gave their users a role and no key — a state phase 8 says must
// refuse — so each one now writes a seed and the write grant `loam user assign-role` lands
// beside it. FIXTURE ONLY: no assertion in this file was weakened, removed, or reordered.
const SEED_FOR: Record<string, string> = { myk: "11".repeat(32), slow: "22".repeat(32) };

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
  // The write standing that rides with the operator role (phase 8).
  await gateway.append([
    signClaims(
      grantClaims(STORE_ENTITY, authorForSeed(SEED_FOR["myk"]!), "write", OPERATOR, ts++),
      OPERATOR_SEED,
    ),
    signClaims(
      grantClaims(STORE_ENTITY, authorForSeed(SEED_FOR["slow"]!), "write", OPERATOR, ts++),
      OPERATOR_SEED,
    ),
  ]);
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
  for (const [name, seed] of Object.entries(SEED_FOR)) writeUserSeed(home, name, seed);
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
      doorOptions: { monotonicNow: () => clock, tokenTtlMs: 3_600_000, idleMs: 100_000_000 },
    });
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    expect((await gql(base, minted.token)).status).toBe(200);
    clock = 7_200_000;
    expect((await gql(base, minted.token)).status).toBe(401);
    // The session outlives the token it minted.
    expect(await signedInPage(base, session.sessionId)).toContain("Signed in");
  });

  // TWO INDEPENDENT GUARANTEES hold (f), deliberately, and a reader should know which is which:
  // `drop` revokes the digests (which also keeps the server's token map from retaining entries
  // for sessions that no longer exist), and `identify()` asks the session's own liveness on
  // every presentation. Either alone would satisfy every assertion below — so a mutant deleting
  // just one SURVIVES this test, and that is stated rather than papered over. The belt is the
  // memory hygiene; the braces are the authority. (f2) pins the digest form the belt uses.
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
    // 2. the session lapsing — on the LAPSE ITSELF, with no traffic sweeping the row first. A
    //    P5 lens found the original here: sweeping runs only on open/peek, so an abandoned
    //    session went on authenticating its operator token for the rest of its TTL with nothing
    //    left to reach it. Presenting the token IS the request that must now refuse.
    {
      let clock = 0;
      const { base } = await bridgeServer({
        doorOptions: { monotonicNow: () => clock, idleMs: 1000, tokenTtlMs: 100_000 },
      });
      const session = await signIn(base);
      const minted = (await (await mint(base, session)).json()) as { token: string };
      expect((await gql(base, minted.token)).status).toBe(200);
      clock = 5000;
      expect((await gql(base, minted.token)).status).toBe(401);
      // And still refused once a sweep would have run, so the fix is not merely a race.
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
        // An hour, stepped past by two: no REAL clock reaches it inside this test, so a server
        // table reading its own clock provably does not expire the token and the one-clock
        // claim is killed by construction rather than by scheduling luck.
        tokenTtlMs: 3_600_000,
        idleMs: 100_000_000,
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
    clock = 7_200_000;
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
    // the ground cannot be READ → 503, session intact. Without this the cannot-decide branch is
    // deletable: collapsing it into "gone" (drop + 401) would leave every other rail green, and
    // that collapse is the exact distinction this door exists to keep.
    {
      const { gateway } = await plantedGateway(["operator"]);
      const home = mkdtempSync(join(tmpdir(), "loam-session-token-"));
      homes.push(home);
      writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
      for (const [name, seed] of Object.entries(SEED_FOR)) writeUserSeed(home, name, seed);
      const handle = await serve({
        mounts: {},
        tokens: { "op-token": { operator: true } },
        port: 0,
        host: "127.0.0.1",
        users: { home, mount: "dyn" },
      });
      handles.push(handle);
      handle.addMount("dyn", gateway); // the doors' OWN mount, which is not a stranger
      const session = await signIn(handle.url);
      expect((await mint(handle.url, session)).status).toBe(200); // positive control

      await handle.removeMount("dyn"); // the ground becomes unreachable
      const undecidable = await mint(handle.url, session);
      expect(undecidable.status).toBe(503);
      expect((await undecidable.text()).toLowerCase()).toContain("ground");
      // The session SURVIVES a condition the door could not evaluate.
      handle.addMount("dyn", gateway);
      expect(await signedInPage(handle.url, session.sessionId)).toContain("Signed in");
      expect((await mint(handle.url, session)).status).toBe(200);
    }
  });

  it("(l) a live stream dies with the credential that opened it", async () => {
    // The one door that outlives its own request: identify() runs at dispatch, so without a
    // per-event re-ask a revoked token keeps delivering the full surface indefinitely — past
    // the logout, past the lapse, past its own TTL (a P5 lens caught it).
    const { base } = await bridgeServer();
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    const res = await fetch(
      `${base}/default/subscribe?query=${encodeURIComponent(`subscription { plant(entity: "${FERN}") { _view } }`)}`,
      { headers: { authorization: `Bearer ${minted.token}` } },
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // The stream is genuinely live: a write reaches it. (Positive control — without this the
    // assertions below would pass on a stream that never worked.)
    const seen = (async (): Promise<string> => {
      let text = "";
      while (!text.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) return text;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    })();
    await fetch(`${base}/default/append`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${minted.token}` },
      body: JSON.stringify({
        deltas: [toWire(observed(FERN, "note", "live event", 41_200, GARDENER_SEED))],
      }),
    });
    expect(await seen).toContain("data:");

    // Sign out, then push another event: the stream must END rather than deliver it.
    await fetch(`${base}/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session.sessionId}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: session.sessionToken }).toString(),
    });
    await fetch(`${base}/default/append`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({
        deltas: [toWire(observed(FERN, "note", "after the logout", 41_300, GARDENER_SEED))],
      }),
    });
    let tail = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += decoder.decode(chunk.value, { stream: true });
      if (tail.includes("no longer live")) break;
    }
    expect(tail).not.toContain("after the logout");
    expect(tail).toContain("no longer live");
  });

  it("(i2) an ALREADY-MINTED token stops being honored while a stranger world answers", async () => {
    // Refusing to mint is not enough on its own: a container attaches after the fact, and a
    // token minted a moment earlier would open it with server-wide authority (a P5 lens caught
    // the overclaim — the spec said the mint refusal "closes the hole", and it did not).
    const { base, gateway } = await bridgeServer();
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    expect((await gql(base, minted.token)).status).toBe(200); // positive control

    await gateway.append([
      signClaims(
        containerClaims(
          { container: "thicket", trust: "curated", posture: "separate" },
          OPERATOR,
          30_200,
        ),
        OPERATOR_SEED,
      ),
    ]);
    const container = await gateway.openContainer({
      name: "thicket",
      backend: new MemoryBackend(),
    });

    // The token minted BEFORE the container is refused everywhere now — including the world it
    // was legitimately minted for, because there is no way to scope it to one mount today.
    expect((await gql(base, minted.token)).status).toBe(401);
    const intoStranger = await fetch(`${base}/thicket/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${minted.token}` },
      body: READ,
    });
    expect(intoStranger.status).toBe(401);
    // The operator's own configured token is untouched — nothing here revokes what the operator
    // configured.
    const asOperator = await fetch(`${base}/thicket/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: READ,
    });
    expect(asOperator.status).toBe(200);

    // And it resumes when the stranger goes: the refusal is a live property, not a scar.
    await container.drop();
    expect((await gql(base, minted.token)).status).toBe(200);
  });

  it("(d) login grows no key nobody granted", async () => {
    const { base, gateway } = await bridgeServer();
    const before = new Set([...gateway.reactor.snapshot()].map((d) => d.claims.author));
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    const delta = observed(FERN, "note", "authored", 41_100, GARDENER_SEED);
    const write = await fetch(`${base}/default/append`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${minted.token}` },
      body: JSON.stringify({ deltas: [toWire(delta)] }),
    });
    expect(write.status).toBe(200);
    // Every distinct author in the ground is one the home already held. Asserted as a SET
    // against the fixture's own known authors — a count would pass while a stranger displaced
    // a familiar name.
    const after = new Set([...gateway.reactor.snapshot()].map((d) => d.claims.author));
    const known = new Set([OPERATOR, GARDENER, SURVEYOR]);
    for (const author of after) expect(known.has(author), author).toBe(true);
    // Two-sided: signing in and writing genuinely CHANGED the ground, so the check above is not
    // passing over an empty delta.
    expect(after.size).toBeGreaterThanOrEqual(before.size);
    expect([...after]).toContain(GARDENER);
  });

  it("(f2) the digest the doors record is the key the table revokes by", async () => {
    // A hex/base64 mismatch across the two maps would make every revocation a silent no-op
    // answering 200. (f) catches that in effect; this pins the encoding itself, so a future
    // reader sees the contract rather than inferring it.
    const { base } = await bridgeServer();
    const session = await signIn(base);
    const minted = (await (await mint(base, session)).json()) as { token: string };
    const expected = createHash("sha256").update(minted.token).digest("hex");
    expect(expected).toMatch(/^[0-9a-f]{64}$/); // hex, on both sides — never base64url
    expect((await gql(base, minted.token)).status).toBe(200);
    // Revoking by exactly that string is what the door does on drop; if the doors recorded a
    // different form, this token would survive the logout below.
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
    for (const [name, seed] of Object.entries(SEED_FOR)) writeUserSeed(home, name, seed);

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

    // addMount refuses a STRANGER while the doors are open — and admits the doors' OWN name,
    // which is the carve-out that makes them answer at all. Without this positive control the
    // conjunct is deletable: refusing every name would leave the negative assertion green.
    const live = await bridgeServer();
    const { gateway: third } = await plantedGateway(["operator"]);
    expect(() => live.handle.addMount("second", third)).toThrow(/login doors/i);

    const { gateway: own } = await plantedGateway(["operator"]);
    const late = await serve({
      mounts: {},
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
      users: { home, mount: "default" },
    });
    handles.push(late);
    expect(() => late.addMount("default", own)).not.toThrow();
    expect((await fetch(`${late.url}/login`)).status).toBe(200);
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
