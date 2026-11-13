import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { coordinatesFromPage } from "../../src/gateway/artifact-page.js";
import { queryFieldFor } from "../../src/gateway/gql.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const BYSTANDER_SEED = "b7".repeat(32);
const BYSTANDER = authorForSeed(BYSTANDER_SEED);
const PEN_SEED = "9e".repeat(32);
const PEN = authorForSeed(PEN_SEED);

const BUNDLE = 'export default (n) => "<p>h=" + n.view.height + "</p>";';

let handle: ServerHandle;
let base: string;
let gateway: Gateway;

const heightDeltas = (gw: Gateway) =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "height",
    ),
  );

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    pens: { editor: PEN_SEED },
  });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
    signClaims(grantClaims(STORE_ENTITY, PEN, "write", OP, 9003), OP_SEED),
  ]);
  await gateway.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    writable: [...PLANT_WRITABLE],
    pen: "editor",
    bundle: BUNDLE,
  });
  await gateway.declareArtifact(["plant"]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: {
      "op-token": { operator: true },
      "viewer-token": { actor: GARDENER_SEED },
      "bystander-token": { actor: BYSTANDER_SEED },
    },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const viaArtifact = async (
  token: string,
  mutation: string,
): Promise<{ isError?: boolean; text: string }> => {
  const res = await fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "loam_mutate", arguments: { mutation } },
    }),
  });
  const body = (await res.json()) as {
    result: { content: Array<{ text: string }>; isError?: boolean };
  };
  return { ...body.result, text: body.result.content[0]?.text ?? "" };
};

const viaGraphql = async (token: string, mutation: string): Promise<string> => {
  const res = await fetch(`${base}/garden/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: mutation }),
  });
  return JSON.stringify(await res.json());
};

const setHeight = (v: number): string =>
  `mutation { plant(entity: ${JSON.stringify(FERN)}, height: ${v}) { _entity _hex _view } }`;

describe("§30 criterion 10: the landed delta's author is the VIEWER, not the pen", () => {
  it("writes as the viewer's own actor — the pen never rides an artifact", async () => {
    const before = heightDeltas(gateway).length;
    const out = await viaArtifact("viewer-token", setHeight(42));
    expect(out.isError).toBeUndefined();
    const added = heightDeltas(gateway).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.claims.author).toBe(GARDENER);
    expect(added[0]!.claims.author).not.toBe(PEN);
    expect(added[0]!.claims.author).not.toBe(OP);
    expect(out.text).toContain("42");
  });

  it("and the SAME route's host-target POST still signs as the pen — two hosts, two identities", async () => {
    const before = heightDeltas(gateway).length;
    const res = await fetch(`${base}/garden/app/plant/${encodeURIComponent(FERN)}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Bearer viewer-token",
      },
      body: "height=77",
    });
    expect(res.status).toBe(200);
    const added = heightDeltas(gateway).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.claims.author).toBe(PEN);
  });
});

describe("§30 criterion 10: a viewer with no write standing gets the store's own refusal", () => {
  it("refuses, and the ground does not move", async () => {
    const before = heightDeltas(gateway).length;
    const out = await viaArtifact("bystander-token", setHeight(999));
    expect(out.isError).toBe(true);
    expect(heightDeltas(gateway)).toHaveLength(before);
    expect(
      heightDeltas(gateway).some((d) => d.claims.author === BYSTANDER),
      "no bystander-authored fact",
    ).toBe(false);
  });

  it("and BOTH doors refuse identically — the page is a convenience over existing standing", async () => {
    const document = setHeight(1234);
    const viaTool = await viaArtifact("bystander-token", document);
    const viaDoor = await viaGraphql("bystander-token", document);
    const toolErrors = (JSON.parse(viaTool.text) as { errors?: string[] }).errors ?? [];
    const doorErrors = (JSON.parse(viaDoor) as { errors?: string[] }).errors ?? [];
    expect(toolErrors.length).toBeGreaterThan(0);
    expect(doorErrors.length).toBeGreaterThan(0);
    expect(toolErrors.join("|")).toBe(doorErrors.join("|"));
  });

  it("a field the SCHEMA does not open refuses on both doors too", async () => {
    const document = `mutation { plant(entity: ${JSON.stringify(FERN)}, nope: 1) { _entity } }`;
    const viaTool = await viaArtifact("viewer-token", document);
    const viaDoor = await viaGraphql("viewer-token", document);
    expect(viaTool.isError).toBe(true);
    expect(viaTool.text).toContain("nope");
    expect(viaDoor).toContain("nope");
  });
});

describe("§30 criterion 19 (delta half): the bundle's own attempt lands NOTHING", () => {
  it("a confined bundle's mutation reaches no door, and the store's count is unchanged", () => {
    const before = heightDeltas(gateway).length;
    const page = gateway.packArtifact("plant", FERN, {
      server: "My Loam",
      acknowledgePen: true,
      acknowledgeWritable: true,
    }).page;
    expect(heightDeltas(gateway)).toHaveLength(before);
    expect(page).not.toContain("viewer-token");
    expect(page).not.toContain(GARDENER_SEED);
    expect(page).not.toContain(PEN_SEED);
    expect(coordinatesFromPage(page)!.manifest).toEqual(["loam_query", "loam_mutate"]);
  });

  it("and a named live BYSTANDER survives every refusal above — the store still answers", async () => {
    const out = await viaArtifact("viewer-token", setHeight(5));
    expect(out.isError).toBeUndefined();
    const read = await fetch(`${base}/garden/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer viewer-token" },
      body: JSON.stringify({
        query: `query { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity _hex _view } }`,
      }),
    });
    expect(JSON.stringify(await read.json())).toContain("5");
  });
});
