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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { readSeed } from "../../src/cli/config.js";
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
