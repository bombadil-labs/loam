import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { publicClaims } from "../../src/gateway/public.js";
import { readRegistrationVersions } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { FERN, PLANT_BODY, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const BOOK = { name: "Book", alg: 1, body: PLANT_BODY };

vi.setConfig({ testTimeout: 20000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const WRITER_SEED = "a1".repeat(32);
const STRANGER_SEED = "e4".repeat(32);

let gateway: Gateway;
let server: ServerHandle;
let base: string;

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
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, authorForSeed(WRITER_SEED), "write", OPERATOR, 2)],
    }),
  );
  await gateway.publishRegistration(
    BOOK,
    PLANT_POLICY,
    ["book:dune"],
    undefined,
    undefined,
    undefined,
    [...PLANT_WRITABLE],
  );
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
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`, "op-token");
    expect((viaGql.body as { data: { plant: { height: number } } }).data.plant.height).toBe(31);
  });
});

describe("agreement on the time axis: one ground, one asOf, both doors (SPEC §26)", () => {
  const CLOCK = "plant:asof";
  const enc = encodeURIComponent(CLOCK);

  it("GET /rest?asOf agrees with GraphQL asOf — same view, same _hex, same annotation", async () => {
    await gateway.append([
      observed(CLOCK, "height", 10, 100, OPERATOR_SEED),
      observed(CLOCK, "height", 20, 200, OPERATOR_SEED),
    ]);

    const viaGql = await gql(
      `{ plant(entity: "${CLOCK}", asOf: 150) { height _hex _asOf _forgotten } }`,
      "op-token",
    );
    const viaRest = await rest(`/rest/v1/Plant/${enc}?asOf=150`, {}, "op-token");
    expect(viaRest.status).toBe(200);
    const gqlPlant = (viaGql.body as { data: { plant: Record<string, unknown> } }).data.plant;
    const restBody = (await viaRest.json()) as {
      view: { height: number };
      _hex: string;
      _asOf: number;
      _forgotten: number[];
    };
    expect(gqlPlant["height"]).toBe(10);
    expect(restBody.view.height).toBe(10);
    expect(restBody._hex).toBe(gqlPlant["_hex"]);
    expect(restBody._asOf).toBe(150);
    expect(gqlPlant["_asOf"]).toBe(150);
    expect(restBody._forgotten).toEqual(gqlPlant["_forgotten"]);
    expect(restBody._forgotten).toEqual([]);
  });

  it("the present tense is unchanged through both doors — every prior query keeps its meaning", async () => {
    const viaGql = await gql(`{ plant(entity: "${CLOCK}") { height _asOf } }`, "op-token");
    const viaRest = await rest(`/rest/v1/Plant/${enc}`, {}, "op-token");
    const gqlPlant = (viaGql.body as { data: { plant: Record<string, unknown> } }).data.plant;
    const restBody = (await viaRest.json()) as { view: { height: number }; _asOf?: number };
    expect(gqlPlant["height"]).toBe(20);
    expect(restBody.view.height).toBe(20);
    expect(gqlPlant["_asOf"]).toBeNull();
    expect(restBody._asOf).toBeUndefined();
  });

  it("a malformed asOf refuses plainly (400), never a resolver 500", async () => {
    const res = await rest(`/rest/v1/Plant/${enc}?asOf=nonsense`, {}, "op-token");
    expect(res.status).toBe(400);
  });
});

describe("parity: every refusal, both doors, the same posture", () => {
  it("no token, nothing public: both doors refuse identically (no mount oracle)", async () => {
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`);
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`);
    const viaSpec = await rest(`/openapi.json`);
    expect(viaGql.status).toBe(viaRest.status);
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
    await gateway.append([signClaims(publicClaims(["Plant"], OPERATOR, 9_100_000), OPERATOR_SEED)]);
    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`);
    const viaRest = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`);
    expect(viaGql.status).toBe(200);
    expect(viaRest.status).toBe(200);
    const restBody = (await viaRest.json()) as { _hex: string };
    const gqlPlant = (await gql(`{ plant(entity: "${FERN}") { _hex } }`)).body as {
      data: { plant: { _hex: string } };
    };
    expect(restBody._hex).toBe(gqlPlant.data.plant._hex);

    const gqlWrite = await gql(`mutation { plant(entity: "${FERN}", height: 1) { height } }`);
    const restWrite = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {
      method: "POST",
      body: JSON.stringify({ height: 1 }),
    });
    expect(JSON.stringify(gqlWrite.body)).toMatch(/mutation|refused|denied|not/i);
    expect(restWrite.status).toBeGreaterThanOrEqual(400);

    const spec = await rest(`/openapi.json`);
    expect(spec.status).toBe(200);
    const doc = (await spec.json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths);
    expect(paths.some((p) => p.includes("/Plant/"))).toBe(true);
    expect(paths.some((p) => p.includes("/Book/"))).toBe(false);
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
    const versions0 = readRegistrationVersions(gateway.reactor, gateway.validityNow(), OPERATOR);
    const plantV1 = versions0.find((v) => v.hyperschema.name === "Plant" && v.version === 1);
    expect(plantV1).toBeDefined();
    v1Hash = plantV1!.deltaId;

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
    await gateway.publishRegistration(PLANT, evolved, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);
    await gateway.query(
      `mutation { plant(entity: "${FERN}", note: "evolved and thriving") { height } }`,
    );

    const versions = readRegistrationVersions(gateway.reactor, gateway.validityNow(), OPERATOR);
    const plants = versions.filter((v) => v.hyperschema.name === "Plant");
    expect(plants.map((v) => v.version)).toEqual([1, 2]);

    const v1 = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    const v2 = await rest(`/rest/v2/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    const v1Body = (await v1.json()) as { view: Record<string, unknown>; _hex: string };
    const v2Body = (await v2.json()) as { view: Record<string, unknown>; _hex: string };
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
    expect(JSON.stringify(doc)).toContain(v1Hash);
  });

  it("the public door serves ONE version per name: the latest, aliased v1 — history is not anonymous", async () => {
    const v1 = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`);
    expect(v1.status).toBe(200);
    const body = (await v1.json()) as { view: Record<string, unknown> };
    expect(body.view["note"]).toEqual(["evolved and thriving"]);
    const v2 = await rest(`/rest/v2/Plant/${encodeURIComponent(FERN)}`);
    expect(v2.status).toBe(404);
    const spec = await rest(`/openapi.json`);
    const paths = Object.keys(((await spec.json()) as { paths: Record<string, unknown> }).paths);
    expect(paths.filter((p) => p.includes("/Plant/")).length).toBe(1);
  });

  it("an anonymous @hash probe learns nothing: uniform 404 for held, withdrawn, and imaginary hashes alike", async () => {
    const bookHash = readRegistrationVersions(
      gateway.reactor,
      gateway.validityNow(),
      OPERATOR,
    ).find((v) => v.hyperschema.name === "Book")!.deltaId;
    const probes = [
      `/rest/@${bookHash}/Book/${encodeURIComponent("book:dune")}`,
      `/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`,
      `/rest/@${"ab".repeat(34)}/Plant/${encodeURIComponent(FERN)}`,
    ];
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
    const byHash = await rest(`/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(byHash.status).toBe(410);
    const anonProbe = await rest(`/rest/@${v1Hash}/Plant/${encodeURIComponent(FERN)}`);
    expect(anonProbe.status).toBe(404);
    const wrongName = await rest(
      `/rest/@${v1Hash}/Book/${encodeURIComponent(FERN)}`,
      {},
      "op-token",
    );
    expect(wrongName.status).toBe(404);
    const versions = readRegistrationVersions(gateway.reactor, gateway.validityNow(), OPERATOR);
    const plants = versions.filter((v) => v.hyperschema.name === "Plant");
    expect(plants).toHaveLength(1);
    expect(plants[0]!.version).toBe(1);
    const v1Now = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    const body = (await v1Now.json()) as { view: Record<string, unknown> };
    expect(body.view["note"]).toEqual(["evolved and thriving"]);
  });

  it("a version that never existed refuses plainly", async () => {
    const missing = await rest(`/rest/v9/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(missing.status).toBe(404);
    const noSchema = await rest(`/rest/v1/Nonesuch/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(noSchema.status).toBe(404);
  });
});

describe("retraction: DELETE clears your own, in agreement with GraphQL clear (§14)", () => {
  it("DELETE /rest retracts the writer's own contribution — the field falls to what survives", async () => {
    await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ height: 88 }) },
      "writer-token",
    );
    const seen = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {}, "op-token");
    expect(((await seen.json()) as { view: { height: number } }).view.height).toBe(88);

    const del = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "DELETE", body: JSON.stringify(["height"]) },
      "writer-token",
    );
    expect(del.status).toBe(200);
    const after = (await del.json()) as { view: { height: number } };
    expect(after.view.height).toBe(30);

    const viaGql = await gql(`{ plant(entity: "${FERN}") { height } }`, "op-token");
    expect((viaGql.body as { data: { plant: { height: number } } }).data.plant.height).toBe(30);
  });

  it("a field-scoped DELETE honors its body: clearing one field leaves the writer's others", async () => {
    await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ height: 66, watered: true }) },
      "writer-token",
    );
    const del = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "DELETE", body: JSON.stringify(["height"]) },
      "writer-token",
    );
    expect(del.status).toBe(200);
    const after = (await del.json()) as { view: { height: number; watered: boolean } };
    expect(after.view.height).toBe(30);
    expect(after.view.watered).toBe(true);
  });

  it("a DELETE with an empty body clears every prop the writer contributed", async () => {
    await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ height: 77 }) },
      "writer-token",
    );
    const del = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "DELETE" },
      "writer-token",
    );
    expect(del.status).toBe(200);
    const after = (await del.json()) as { view: { height: number } };
    expect(after.view.height).toBe(30);
  });

  it("the public door cannot retract any more than it can write", async () => {
    const anon = await rest(`/rest/v1/Plant/${encodeURIComponent(FERN)}`, {
      method: "DELETE",
      body: JSON.stringify(["height"]),
    });
    expect(anon.status).toBe(403);
  });

  it("an object DELETE body removes specific values the writer contributed (value-scoped)", async () => {
    await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "POST", body: JSON.stringify({ tag: "ephemeral" }) },
      "writer-token",
    );
    const before = await gql(`{ plant(entity: "${FERN}") { tag } }`, "op-token");
    expect((before.body as { data: { plant: { tag: string[] } } }).data.plant.tag).toContain(
      "ephemeral",
    );

    const del = await rest(
      `/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      { method: "DELETE", body: JSON.stringify({ tag: ["ephemeral"] }) },
      "writer-token",
    );
    expect(del.status).toBe(200);
    const after = await gql(`{ plant(entity: "${FERN}") { tag } }`, "op-token");
    const tag = (after.body as { data: { plant: { tag: string[] | null } } }).data.plant.tag;
    expect(tag ?? []).not.toContain("ephemeral");
  });
});
