// §36 (T113), criteria (f) (g) (j): WHAT a session may open, and what it may not.
//
// This is the file that guards §36's load-bearing invariant. A cookie is ambient — the browser
// attaches it to any request any page makes — so cookie authority is confined to the browser-facing
// HTML doors. Every JSON door stays header-only, exactly as http.ts's own header promises. A
// browser that wants to write asks /session/token and then presents a bearer header like any other
// client.
//
// Both levels, because a token that authenticates and writes as the wrong identity is a bug no
// status code shows: the write is asserted through the READ DOOR and again on the delta the store
// actually holds.
//
// NAMED GAPS:
//   - Criterion (f) asks for authorship "through a reading" as well as at the delta level. The
//     reading here resolves the VALUE, not the author: no door resolves provenance today, so the
//     object level of the authorship claim is unasserted. A provenance gesture would close it.
//   - The 503 "ground not reachable" branch in session.ts is unrailed. It looks unreachable through
//     `serve` — the login mount is static and `mounts.remove` refuses a static mount — so driving it
//     wants makeUserDoors directly with `ground: () => undefined`. The decision worth pinning when
//     someone does: that branch must NOT drop the session, because a local fault is not a logout.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { readSeed } from "../../src/cli/config.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { serve } from "../../src/server/http.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  PASSWORD,
  SESSION_COOKIE,
  bootStore,
  createUser,
  dropHome,
  makeHome,
  postDoor,
  serveHome,
  signIn,
  storeDeltas,
  type Served,
} from "./user-fixture.js";

vi.setConfig({ testTimeout: 20000 });

const MOSS = "plant:moss";

// The refusal a caller with no credential has always received. Pinned as BYTES: criterion (j) is
// that this section added no oracle, and an oracle is a difference, however small.
const NO_CREDENTIAL_BODY = JSON.stringify({
  errors: ["a bearer token is required, and this one opens nothing"],
});

let home: string;
let served: Served;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveHome(home, {}, { "op-token": { operator: true } }, (gateway) => {
    gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
  });
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

const gql = (query: string, headers: Record<string, string>): Promise<Response> =>
  fetch(`${served.base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query }),
  });

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const cookieOnly = (cookie: string): Record<string, string> => ({
  cookie: `${SESSION_COOKIE}=${cookie}`,
});

describe("POST /session/token", () => {
  it("(f) a session buys a bearer token, and that token reads AND writes as the session user", async () => {
    const session = await signIn(served.base);
    const res = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(res.status).toBe(200);
    const { token, expiresIn } = (await res.json()) as { token: string; expiresIn: number };
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(expiresIn).toBeGreaterThan(0);

    // the read door
    const read = await gql(`{ plant(entity: "${MOSS}") { height } }`, bearer(token));
    expect(read.status).toBe(200);

    // the write door
    const wrote = await gql(
      `mutation { plant(entity: "${MOSS}", height: 7) { height } }`,
      bearer(token),
    );
    expect(wrote.status).toBe(200);
    const body = (await wrote.json()) as {
      data?: { plant?: { height?: number } };
      errors?: string[];
    };
    expect(body.errors).toBeUndefined();
    expect(body.data?.plant?.height).toBe(7);

    // through a reading: the value is live at the read door, under a fresh request
    const after = await gql(`{ plant(entity: "${MOSS}") { height } }`, bearer(token));
    expect(
      ((await after.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(7);

    // at the delta level: the landed delta is signed by the identity the session user's operator
    // role entitles them to — the home's operator, never a stranger and never nobody.
    const operator = authorForSeed(readSeed(home));
    const carriers = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(`"value":7`),
    );
    expect(carriers.length).toBe(1);
    expect(carriers[0]!.claims.author).toBe(operator);
  });

  // (f2) The role authorizes and the seed signs — so no per-user key exists to mint. Every author
  // in the ground must be a seed the home actually holds; a stranger here would mean login had
  // grown a signing identity of its own, which the three-way split forbids.
  it("(f2) no delta is authored by a key the home does not hold", async () => {
    // The sweep has to run over a store that CONTAINS a session's own write, or it says nothing about
    // login: genesis and `user create` alone would satisfy it with the whole feature deleted.
    const session = await signIn(served.base);
    const res = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const wrote = await gql(
      `mutation { plant(entity: "${MOSS}", height: 11) { height } }`,
      bearer(token),
    );
    expect(wrote.status).toBe(200);

    const known = new Set(
      readdirSync(home)
        .filter((f) => f.endsWith(".seed"))
        .map((f) => authorForSeed(readFileSync(join(home, f), "utf8").trim())),
    );
    expect(known.size).toBeGreaterThan(0);
    const deltas = await storeDeltas(home);
    // the session's write really is in the set being swept
    expect(deltas.some((d) => JSON.stringify(d.claims.pointers).includes(`"value":11`))).toBe(true);
    const authors = new Set(deltas.map((d) => d.claims.author));
    expect([...authors].filter((a) => !known.has(a))).toEqual([]);
  });

  it("(f) the token dies with its window, and the session that minted it survives", async () => {
    let ticks = 0;
    await served.close();
    served = await serveHome(
      home,
      { tokenTtlMs: 500, monotonicNow: () => ticks },
      { "op-token": { operator: true } },
      (gateway) => {
        gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
      },
    );
    const session = await signIn(served.base);
    const res = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    const { token } = (await res.json()) as { token: string };
    expect((await gql(`{ __typename }`, bearer(token))).status).toBe(200);

    ticks += 501;
    const dead = await gql(`{ __typename }`, bearer(token));
    expect(dead.status).toBe(401);
    expect(await dead.text()).toBe(NO_CREDENTIAL_BODY);
    // the session is fine: it can mint another
    const again = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(again.status).toBe(200);
  });

  it("(f) signing out retires the tokens that session minted", async () => {
    // A logout that answers 200 while the token it issued keeps writing has revoked nothing. The window
    // is short, but "short" is not "closed", and the caller asked to be signed out.
    const session = await signIn(served.base);
    const res = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    const { token } = (await res.json()) as { token: string };
    expect((await gql(`{ __typename }`, bearer(token))).status).toBe(200);

    const out = await postDoor(served.base, "/logout", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(out.status).toBe(200);
    const dead = await gql(`{ __typename }`, bearer(token));
    expect(dead.status).toBe(401);
    expect(await dead.text()).toBe(NO_CREDENTIAL_BODY);
    // and the write door is shut with it — a read refusal alone would not prove the identity is gone
    const wrote = await gql(
      `mutation { plant(entity: "${MOSS}", height: 99) { height } }`,
      bearer(token),
    );
    expect(wrote.status).toBe(401);
  });

  it("(f) a session may not mint tokens without limit, and a LAPSED one frees its slot", async () => {
    // The cap counts LIVE tokens. Counting every token ever minted would make it permanent: a session
    // that reached the cap could never mint again however long it waited, while its own sliding idle
    // window kept it alive — and the 429 body's advice ("wait for one to lapse") would be a lie.
    let ticks = 0;
    await served.close();
    served = await serveHome(
      home,
      { maxTokensPerSession: 2, tokenTtlMs: 1000, idleMs: 600_000, monotonicNow: () => ticks },
      { "op-token": { operator: true } },
      (gateway) => {
        gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
      },
    );
    const live = await signIn(served.base);
    const mint = (): Promise<Response> =>
      postDoor(served.base, "/session/token", { cookie: live.cookie, formToken: live.formToken });

    for (let i = 0; i < 2; i += 1) expect((await mint()).status, `mint ${i}`).toBe(200);
    const refused = await mint();
    expect(refused.status).toBe(429);
    expect((await refused.json()) as { errors: string[] }).toEqual({
      errors: [expect.stringMatching(/lapse/i) as unknown as string],
    });

    // waiting is the remedy the refusal names, so waiting has to work
    ticks += 1001;
    expect((await mint()).status).toBe(200);
  });

  it("(f) a user with no operator role is refused a token, and told why", async () => {
    // A running server answers from the memory it booted with, so a user created behind its back is
    // invisible to it — the store is single-writer, and that staleness is documented, not a bug.
    await served.close();
    await createUser(home, "wren", "a different password", { operator: false });
    served = await serveHome(home, {}, { "op-token": { operator: true } }, (gateway) => {
      gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
    });
    const session = await signIn(served.base, "wren", "a different password");
    const res = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { errors: string[] }).toEqual({
      errors: [expect.stringMatching(/operator role/i) as unknown as string],
    });
  });
});

// A session token is authority over the WHOLE SERVER, and the role binding that earns it is read from
// one mount's ground. So the doors refuse to open beside a second world. Both guards are new, and both
// are deletable with every other rail green — which is what earns them this one.
describe("the login doors want a single mount", () => {
  it("refuse to open at boot beside a second mount, WITHOUT leaving the socket bound", async () => {
    const other = await Gateway.boot(
      new SqliteBackend(join(home, "other.sqlite")),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    // A named port, so the refusal's timing is observable: this is a pure function of the options, so
    // it must happen BEFORE listen. Thrown after, it leaves a live listener with no doors — and the
    // only way to see that from outside is that the port stays taken.
    const port = 45771;
    try {
      await expect(
        serve({
          mounts: { default: served.gateway, other },
          tokens: { "op-token": { operator: true } },
          port,
          host: "127.0.0.1",
          users: { home, mount: "default" },
        }),
      ).rejects.toThrow(/single mount/);

      // The port is free, which is only true if nothing ever bound it. A second serve on the same port
      // succeeds; if the refused boot had left a listener, this would fail EADDRINUSE.
      const after = await serve({
        mounts: { default: served.gateway },
        tokens: { "op-token": { operator: true } },
        port,
        host: "127.0.0.1",
      });
      try {
        expect(after.port).toBe(port);
      } finally {
        await after.close();
      }
    } finally {
      await other.close();
    }
  });

  it("refuse a mount added while they are open", async () => {
    const other = await Gateway.boot(
      new SqliteBackend(join(home, "later.sqlite")),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      expect(() => served.handle.addMount("later", other)).toThrow(/server-wide authority/);
      // and the world really did not mount: its door answers as a name that never existed
      const res = await fetch(`${served.base}/later/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer("op-token") },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      expect(res.status).toBe(404);
    } finally {
      await other.close();
    }
  });

  // THE THIRD TIER the two guards above do NOT cover. A container mount is derived from the host's own
  // attachment registry, so it needs neither the boot check nor addMount — it simply appears. The
  // premise that makes this safe is stated in mounts.ts rather than checked at the seam: a container
  // shares the host's operator (§24.1), so a session token reaches it with exactly the authority the
  // host's own static operator token already had, and nothing more.
  //
  // This rail is the check that premise never had. Two-sided, because "refused" is not the property:
  // the session token and the static operator token must answer the SAME at a container mount. If a
  // later design gives a container its own identities, this goes red — which is the point.
  it("a container mount answers a session token exactly as it answers the operator token", async () => {
    // the operator's word that the name exists — a container cannot be opened without it
    await served.gateway.append([
      signClaims(
        containerClaims(
          { container: "grove", trust: "curated", posture: "separate" },
          authorForSeed(readSeed(home)),
          90_000,
        ),
        readSeed(home),
      ),
    ]);
    const c = await served.gateway.openContainer({
      name: "grove",
      backend: new SqliteBackend(join(home, "grove.sqlite")),
    });
    try {
      // give the container a queryable surface of its own, so the anchor below reads real data
      // rather than an empty-schema refusal both callers would share
      expect(c.gateway).toBeDefined();
      c.gateway!.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
      const session = await signIn(served.base);
      const token = await postDoor(served.base, "/session/token", {
        cookie: session.cookie,
        formToken: session.formToken,
      });
      expect(token.status).toBe(200);
      const minted = ((await token.json()) as { token: string }).token;

      // The container was seeded from the host, so the host's own reading answers there.
      const ask = (auth: Record<string, string>): Promise<Response> =>
        fetch(`${served.base}/grove/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify({ query: `{ plant(entity: "${MOSS}") { height } }` }),
        });
      const bySession = await ask(bearer(minted));
      const byOperator = await ask(bearer("op-token"));
      // ANCHOR THE MOUNT FIRST. Two byte-identical refusals would satisfy the equality below while the
      // container's authority went entirely unexercised — an unreachable mount name is a real failure
      // mode this repo has already hit, so equality alone is not the property.
      expect(byOperator.status).toBe(200);
      const opBody = (await byOperator.clone().json()) as {
        data?: { plant?: unknown };
        errors?: string[];
      };
      expect(opBody.errors, JSON.stringify(opBody.errors)).toBeUndefined();
      expect(opBody.data?.plant).toBeDefined();
      expect(bySession.status).toBe(byOperator.status);
      expect(await bySession.text()).toBe(await byOperator.text());
      // and the cookie ALONE still opens nothing there — the invariant holds at this tier too
      const byCookie = await fetch(`${served.base}/grove/graphql`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${session.cookie}`,
        },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      expect(byCookie.status).not.toBe(200);
    } finally {
      await c.drop();
    }
  });
});

describe("the cookie opens no JSON door", () => {
  it("(g) a valid session cookie alone is refused by graphql, append and mcp — same bytes as nothing", async () => {
    const session = await signIn(served.base);
    // the cookie IS live: it opens the door it is allowed to open
    expect(
      (
        await postDoor(served.base, "/session/token", {
          cookie: session.cookie,
          formToken: session.formToken,
        })
      ).status,
    ).toBe(200);

    const doors: [string, RequestInit][] = [
      ["/default/graphql", { method: "POST", body: JSON.stringify({ query: "{ __typename }" }) }],
      ["/default/append", { method: "POST", body: JSON.stringify({ deltas: [] }) }],
      [
        "/default/mcp",
        { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) },
      ],
    ];
    for (const [path, init] of doors) {
      const withCookie = await fetch(`${served.base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...cookieOnly(session.cookie) },
      });
      const withNothing = await fetch(`${served.base}${path}`, {
        ...init,
        headers: { "content-type": "application/json" },
      });
      expect(withCookie.status, path).toBe(withNothing.status);
      expect(await withCookie.text(), path).toBe(await withNothing.text());
      expect(withCookie.status, path).toBe(401);
    }
  });

  it("(g) a cookie cannot stand in for a token on the operator-only doors either", async () => {
    const session = await signIn(served.base);
    for (const path of ["/default/health", "/default/federate", "/default/register"]) {
      const res = await fetch(`${served.base}${path}`, {
        method: path === "/default/health" ? "GET" : "POST",
        headers: { "content-type": "application/json", ...cookieOnly(session.cookie) },
        ...(path === "/default/health" ? {} : { body: "{}" }),
      });
      expect(res.status, path).toBe(401);
      expect(await res.text(), path).toBe(NO_CREDENTIAL_BODY);
    }
  });

  it("(j) no cookie and no token gets the refusal this store always gave, byte for byte", async () => {
    // The login doors ARE open here — otherwise this rail would pass on a store that never grew
    // them, which is the one way a no-change criterion can go hollow.
    expect((await fetch(`${served.base}/login`)).status).toBe(200);
    const res = await gql("{ __typename }", {});
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(NO_CREDENTIAL_BODY);
    // and nothing in it says whether a user, a session, or a login door exists here
    const body = await (await gql("{ __typename }", {})).text();
    expect(body).not.toMatch(/user|session|login|password|credential/i);
  });

  it("(j) a junk bearer token is still refused outright, never downgraded to a session", async () => {
    const session = await signIn(served.base);
    const res = await gql("{ __typename }", {
      ...bearer("junk"),
      ...cookieOnly(session.cookie),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(NO_CREDENTIAL_BODY);
  });
});
