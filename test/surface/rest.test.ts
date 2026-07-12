// The REST door (SPEC §17). A registration is interface-agnostic truth; this suite holds the
// second door to the first one's answers. Three laws under test: AGREEMENT (one ground, one
// registration — the same view through both doors, _hex for _hex), PARITY (every refusal the
// GraphQL door makes, the REST door makes — the matrix below, row by row through BOTH),
// and VERSIONING (§17 amendment: publishing is append-only — an evolved registration mints
// v2 and v1 stays answerable; a struck version stops being served and its hash answers
// 410 Gone; the version's true name is the registration delta's content address).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { publicClaims } from "../../src/gateway/public.js";
import { readRegistrationVersions } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { FERN, PLANT_BODY } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

// A second, NEVER-DECLARED schema: the smaller-world assertions need a real thing to be
// missing, and the oracle probes need a live undeclared registration hash to ask about.
const BOOK = { name: "Book", alg: 1, body: PLANT_BODY };

vi.setConfig({ testTimeout: 20000 }); // one real HTTP server carries the whole suite

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const WRITER_SEED = "a1".repeat(32);
const STRANGER_SEED = "e4".repeat(32);

let gateway: Gateway;
let server: ServerHandle;
let base: string; // http://host:port/plants

const rest = (path: string, init: RequestInit = {}, token?: string) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(init.headers ?? {}),
    },
  });

const gql = async (query: string, token?: string) => {
  const res = await fetch(`${base}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  gateway = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN] }],
      grants: [grantClaims(STORE_ENTITY, authorForSeed(WRITER_SEED), "write", OPERATOR, 2)],
    }),
  );
  await gateway.publishRegistration(BOOK, PLANT_POLICY, ["book:dune"]);
  await gateway.query(`mutation { plant(entity: "${FERN}", height: 30) { height } }`);
  server = await serve({
    mounts: { plants: gateway },
    tokens: {
      "op-token": { operator: true },
      "writer-token": { actor: WRITER_SEED },
      "stranger-token": { actor: STRANGER_SEED },
    },
    port: 0,
    host: "127.0.0.1",
  });
  base = `${server.url}/plants`;
});

afterAll(async () => {
  await server.close();
  await gateway.close();
});

describe("agreement: one registration, two doors, the same answer", () => {
  it("GET /rest answers the SAME view as GraphQL — _hex for _hex", async () => {
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height _hex _hviewHex } }`, "op-token");
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(viaRest.status).toBe(200);
    const body = (await viaRest.json()) as {
      entity: string;
      view: { height: number };
      _hex: string;
      _hviewHex: string;
    };
    const gqlPlant = (viaGql.body as { data: { plant: Record<string, unknown> } }).data.plant;
    expect(body.entity).toBe(FERN);
    expect(body.view.height).toBe(30);
    expect(body._hex).toBe(gqlPlant["_hex"]);
    expect(body._hviewHex).toBe(gqlPlant["_hviewHex"]);
  });

  it("POST /rest writes through the same door discipline and answers the re-resolved view", async () => {
    const res = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ height: 31 }) },
      "writer-token",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { view: { height: number } };
    expect(body.view.height).toBe(31);
    // and the OTHER door sees the write immediately — one ground
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`, "op-token");
    expect((viaGql.body as { data: { plant: { height: number } } }).data.plant.height).toBe(31);
  });
});

describe("parity: every refusal, both doors, the same posture", () => {
  it("no token, nothing public: both doors refuse identically (no mount oracle)", async () => {
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`);
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`);
    const viaSpec = await rest(`/openapi.json`);
    expect(viaGql.status).toBe(viaRest.status); // the same uniform refusal
    expect(viaRest.status).toBe(viaSpec.status);
    expect(viaRest.status).toBeGreaterThanOrEqual(400);
  });

  it("a presented-but-wrong token never downgrades to anonymous, on either door", async () => {
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`, "not-a-token");
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "not-a-token");
    expect(viaGql.status).toBe(viaRest.status);
    expect(viaRest.status).toBeGreaterThanOrEqual(400);
  });

  it("a write without standing is refused with the same reason through both doors", async () => {
    const viaGql = await gql(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
      "stranger-token",
    );
    const viaRest = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ height: 99 }) },
      "stranger-token",
    );
    const gqlErr = JSON.stringify(viaGql.body);
    const restBody = (await viaRest.json()) as { errors?: string[] };
    expect(gqlErr).toMatch(/not permitted/);
    expect(viaRest.status).toBeGreaterThanOrEqual(400);
    expect((restBody.errors ?? []).join(" ")).toMatch(/not permitted/);
  });

  it("the public projection is a smaller world through both doors", async () => {
    // Before any declaration both anonymous doors refuse (asserted above). Open ONE lens:
    await gateway.append([signClaims(publicClaims(["Plant"], OPERATOR, 9_100_000), OPERATOR_SEED)]);
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`);
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`);
    expect(viaGql.status).toBe(200);
    expect(viaRest.status).toBe(200);
    const restBody = (await viaRest.json()) as { _hex: string };
    const gqlPlant = (await gql(`{ plant(entity: "${FERN}") { _hex } }`)).body as {
      data: { plant: { _hex: string } };
    };
    expect(restBody._hex).toBe(gqlPlant.data.plant._hex); // agreement holds anonymously too

    // ...and writing anonymously is impossible through either door
    const gqlWrite = await gql(`mutation { plant(entity: "${FERN}", height: 1) { height } }`);
    const restWrite = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {
      method: "POST",
      body: JSON.stringify({ height: 1 }),
    });
    expect(JSON.stringify(gqlWrite.body)).toMatch(/mutation|refused|denied|not/i);
    expect(restWrite.status).toBeGreaterThanOrEqual(400);

    // ...and the anonymous OpenAPI document describes ONLY the declared world — Book is a
    // real, live, registered lens on this store, and the document must not know it
    const spec = await rest(`/openapi.json`);
    expect(spec.status).toBe(200);
    const doc = (await spec.json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths);
    expect(paths.some((p) => p.includes("/Plant/"))).toBe(true);
    expect(paths.some((p) => p.includes("/Book/"))).toBe(false);
    // ...and reaching Book by name anonymously is a plain 404, no oracle
    const bookRest = await rest(`/rest/v1/Book/${encodeURIComponent("book:dune")}`);
    expect(bookRest.status).toBe(404);
  });

  it("reads under an ACTOR token agree across doors too — identity is not just for writes", async () => {
    const viaGql = await gql(`{ plant(entity: "${FERN}") { _hex } }`, "writer-token");
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "writer-token");
    expect(viaRest.status).toBe(200);
    const restBody = (await viaRest.json()) as { _hex: string };
    const gqlPlant = (viaGql.body as { data: { plant: { _hex: string } } }).data.plant;
    expect(restBody._hex).toBe(gqlPlant._hex);
  });

  it("malformed writes refuse plainly: unknown prop 400, wrong verb 405", async () => {
    const unknown = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ nonesuch: 1 }) },
      "op-token",
    );
    expect(unknown.status).toBe(400);
    const put = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "PUT", body: JSON.stringify({ height: 1 }) },
      "op-token",
    );
    expect(put.status).toBe(405);
  });
});

describe("versioning: publishing is append-only (SPEC §17 amendment)", () => {
  let v1Hash: string;

  it("evolution mints v2; v1 stays answerable, without the new prop", async () => {
    const versions0 = readRegistrationVersions(gateway.reactor, OPERATOR);
    const plantV1 = versions0.find((v) => v.hyperschema.name === "Plant" && v.version === 1);
    expect(plantV1).toBeDefined();
    v1Hash = plantV1!.deltaId;

    // Evolve: add a `note` prop (all). The registration entity is the identity; same name.
    const evolved = {
      ...PLANT_POLICY,
      props: new Map([
        ...PLANT_POLICY.props,
        [
          "note",
          { kind: "all" as const, order: { kind: "byTimestamp" as const, dir: "asc" as const } },
        ],
      ]),
    };
    await gateway.publishRegistration(PLANT, evolved, [FERN]);
    await gateway.query(
      `mutation { plant(entity: "${FERN}", note: "evolved and thriving") { height } }`,
    );

    const versions = readRegistrationVersions(gateway.reactor, OPERATOR);
    const plants = versions.filter((v) => v.hyperschema.name === "Plant");
    expect(plants.map((v) => v.version)).toEqual([1, 2]);

    const v1 = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    const v2 = await rest(`/rest/v2/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    const v1Body = (await v1.json()) as { view: Record<string, unknown>; _hex: string };
    const v2Body = (await v2.json()) as { view: Record<string, unknown>; _hex: string };
    // Two lenses, one ground: v2 declares `note` as ALL (a list); v1 never named it, so its
    // DEFAULT (pick latest) answers a scalar. Same fact, different resolutions, different
    // content addresses — nothing was mutated, and both answers are true under their law.
    expect(v2Body.view["note"]).toEqual(["evolved and thriving"]);
    expect(v1Body.view["note"]).toBe("evolved and thriving");
    expect(v1Body._hex).not.toBe(v2Body._hex);
  });

  it("a version's true name is its registration hash; @hash answers the same view", async () => {
    const byAlias = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    const byHash = await rest(`/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(byHash.status).toBe(200);
    const a = (await byAlias.json()) as { _hex: string };
    const h = (await byHash.json()) as { _hex: string };
    expect(h._hex).toBe(a._hex);
  });

  it("the OpenAPI document names every surviving version and its hash", async () => {
    const res = await rest(`/openapi.json`, {}, "op-token");
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      info: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3\.1/);
    const paths = Object.keys(doc.paths);
    expect(paths.some((p) => p.includes("/rest/v1/Plant/"))).toBe(true);
    expect(paths.some((p) => p.includes("/rest/v2/Plant/"))).toBe(true);
    expect(JSON.stringify(doc)).toContain(v1Hash); // the true name travels in the doc
  });

  it("the public door serves ONE version per name: the latest, aliased v1 — history is not anonymous", async () => {
    // Plant is declared public and now has two versions. The anonymous world sees exactly
    // one: the latest policy, at v1 — its version count is its own business.
    const v1 = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`);
    expect(v1.status).toBe(200);
    const body = (await v1.json()) as { view: Record<string, unknown> };
    expect(body.view["note"]).toEqual(["evolved and thriving"]); // the LATEST lens (all → list)
    const v2 = await rest(`/rest/v2/Plant/${encodeURIComponent(FERN)}`);
    expect(v2.status).toBe(404);
    const spec = await rest(`/openapi.json`);
    const paths = Object.keys(((await spec.json()) as { paths: Record<string, unknown> }).paths);
    expect(paths.filter((p) => p.includes("/Plant/")).length).toBe(1);
  });

  it("an anonymous @hash probe learns nothing: uniform 404 for held, withdrawn, and imaginary hashes alike", async () => {
    // A LIVE registration of an undeclared schema — the ground holds it; the stranger must
    // not learn that.
    const bookHash = readRegistrationVersions(gateway.reactor, OPERATOR).find(
      (v) => v.hyperschema.name === "Book",
    )!.deltaId;
    const probes = [
      `/rest/@${bookHash}/Book/${encodeURIComponent("book:dune")}`,
      `/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`, // still surviving at this point
      `/rest/@${"ab".repeat(34)}/Plant/${encodeURIComponent(FERN)}`, // imaginary
    ];
    // (The Plant v1 hash is still surviving here, so it ANSWERS anonymously? No — the public
    // door serves only the latest; a non-latest hash is outside its world: 404, same as all.)
    for (const p of probes) {
      const res = await rest(p);
      expect(res.status, p).toBe(404);
    }
  });

  it("withdrawing a version is the operator striking its registration delta: served no longer, remembered forever", async () => {
    await gateway.append([
      signClaims(
        makeNegationClaims(OPERATOR, 9_200_000, v1Hash, "v1 shipped a bug"),
        OPERATOR_SEED,
      ),
    ]);
    // The hash answers 410 Gone — withdrawn is not the same silence as never-existed. The
    // distinction is the FULL door's alone: anonymously the same probe is a uniform 404.
    const byHash = await rest(`/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(byHash.status).toBe(410);
    const anonProbe = await rest(`/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`);
    expect(anonProbe.status).toBe(404);
    // And a surviving hash reached under the WRONG name is a 404, never a false 410.
    const wrongName = await rest(
      `/rest/@${v1Hash}/Book/${encodeURIComponent(FERN)}`,
      {},
      "op-token",
    );
    expect(wrongName.status).toBe(404);
    // Aliases shift: the surviving registration is now v1 (the Nth SURVIVING, in ground order).
    const versions = readRegistrationVersions(gateway.reactor, OPERATOR);
    const plants = versions.filter((v) => v.hyperschema.name === "Plant");
    expect(plants).toHaveLength(1);
    expect(plants[0]!.version).toBe(1);
    const v1Now = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    const body = (await v1Now.json()) as { view: Record<string, unknown> };
    expect(body.view["note"]).toEqual(["evolved and thriving"]); // v1 now aliases the evolved lens
  });

  it("a version that never existed refuses plainly", async () => {
    const missing = await rest(`/rest/v9/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(missing.status).toBe(404);
    const noSchema = await rest(`/rest/v1/Nonesuch/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(noSchema.status).toBe(404);
  });
});
