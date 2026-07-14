// Step 4's write half: GraphQL mutate. One mutation field per registered schema, one argument
// per policy prop; each provided argument becomes a signed property-claim delta appended
// through the same validated write-through path as everything else. The mutation returns the
// re-resolved view — the response IS the re-query. A gateway holding no signing seed refuses
// to write: unsigned authority does not exist here.

import { describe, expect, it } from "vitest";
import { authorForSeed, verifyDelta, type Schema, type Policy } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
  pickLatest,
} from "./fixtures.js";

const KEEPER_SEED = "c3".repeat(32);
const KEEPER = authorForSeed(KEEPER_SEED);

async function keeperGateway(backend = new MemoryBackend()): Promise<Gateway> {
  const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED)); // the keeper governs; the authors may write
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

describe("mutate: args → signed deltas → append", () => {
  it("a mutation appends the right delta and answers with the re-resolved view", async () => {
    const backend = new MemoryBackend();
    const gateway = await keeperGateway(backend);
    const result = await gateway.query(`mutation {
      plant(entity: "${FERN}", height: 40) { height _hex }
    }`);
    expect(result.errors).toBeUndefined();
    const plant = (result.data as { plant: { height: number; _hex: string } }).plant;
    expect(plant.height).toBe(40); // the response is the re-query

    // the delta itself: signed by the gateway's keeper, shaped as a property claim, persisted
    await gateway.flush();
    const settled = [...garden, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id);
    const persisted = await backend.deltasSince(new Set(settled));
    expect(persisted).toHaveLength(1);
    const written = persisted[0]!;
    expect(verifyDelta(written)).toBe("verified");
    expect(written.claims.author).toBe(KEEPER);
    expect(written.claims.pointers).toEqual([
      {
        role: "subject",
        target: { kind: "entity", entity: { id: FERN, context: "height" } },
      },
      { role: "value", target: { kind: "primitive", value: 40 } },
    ]);

    // and a plain re-query agrees
    const requery = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((requery.data as { plant: { height: number } }).plant.height).toBe(40);
    await gateway.close();
  });

  it("several args land as several claims, one per property", async () => {
    const backend = new MemoryBackend();
    const gateway = await keeperGateway(backend);
    const result = await gateway.query(`mutation {
      plant(entity: "${FERN}", height: 41, watered: true) { height watered tag }
    }`);
    expect(result.errors).toBeUndefined();
    const plant = (result.data as { plant: { height: number; watered: boolean; tag: string[] } })
      .plant;
    expect(plant.height).toBe(41);
    expect(plant.watered).toBe(true); // absentAs no longer speaks: a real claim exists
    expect(plant.tag).toEqual(["shade", "fronds"]); // untouched props stay resolved
    await gateway.flush();
    const settled = [...garden, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id);
    const fresh = await backend.deltasSince(new Set(settled));
    expect(fresh).toHaveLength(2);
    await gateway.close();
  });

  it("list-policy props accept a value per call and union under the policy", async () => {
    const gateway = await keeperGateway();
    await gateway.query(`mutation { plant(entity: "${FERN}", tag: "evergreen") { tag } }`);
    const result = await gateway.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((result.data as { plant: { tag: string[] } }).plant.tag).toEqual([
      "shade",
      "fronds",
      "evergreen",
    ]);
    await gateway.close();
  });

  it("a seedless gateway refuses to write", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append(garden);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const result = await gateway.query(`mutation {
      plant(entity: "${FERN}", height: 99) { height }
    }`);
    expect(result.errors?.join(" ")).toMatch(/no signing seed/);
    // and nothing changed
    const requery = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((requery.data as { plant: { height: number } }).plant.height).toBe(34);
    await gateway.close();
  });

  it("a mutation naming no properties writes nothing and says so", async () => {
    const gateway = await keeperGateway();
    const result = await gateway.query(`mutation { plant(entity: "${FERN}") { height } }`);
    expect(result.errors?.join(" ")).toMatch(/no properties/);
    await gateway.close();
  });
});

describe("mutate: the deltas survive like any others", () => {
  it("what a mutation wrote, a fresh gateway replays", async () => {
    const backend = new MemoryBackend();
    const first = await keeperGateway(backend);
    await first.query(`mutation { plant(entity: "${FERN}", height: 44) { height } }`);
    await first.flush();

    const second = await Gateway.open(backend); // no seed: read-only is fine
    second.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const result = await second.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((result.data as { plant: { height: number } }).plant.height).toBe(44);
    await second.close();
  });

  it("gateway authorship is real authorship: byAuthorRank can prefer or distrust it", async () => {
    const gateway = await keeperGateway();
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 50) { height } }`);
    // Two lenses over the same ground: one trusts the keeper, one trusts the gardener.
    const trusting = (author: string): Schema => ({
      props: new Map<string, Policy>([
        ["height", { kind: "pick", order: { kind: "byAuthorRank", authors: [author] } }],
      ]),
      default: pickLatest,
    });
    gateway.register({ name: "TrustKeeper", alg: 1, body: PLANT.body }, trusting(KEEPER), [FERN]);
    gateway.register({ name: "TrustGardener", alg: 1, body: PLANT.body }, trusting(GARDENER), [
      FERN,
    ]);
    const result = await gateway.query(`{
      trustKeeper(entity: "${FERN}") { height }
      trustGardener(entity: "${FERN}") { height }
    }`);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      trustKeeper: { height: number };
      trustGardener: { height: number };
    };
    expect(data.trustKeeper.height).toBe(50); // the keeper's mutation, preferred by rank
    expect(data.trustGardener.height).toBe(30); // the gardener's old measurement, still winning
    await gateway.close();
  });

  it("a store-native name survives GraphQL mangling: write and read through legal()", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
    gateway.register(
      { name: "Plant", alg: 1, body: PLANT.body },
      {
        props: new Map<string, Policy>([["leaf-count", pickLatest]]),
        default: pickLatest,
      },
      [FERN],
      undefined,
      ["leaf-count"], // the store-native field name — writability disciplines the surface by it
    );
    // The GraphQL field is leaf_count; the claim context stays the store-native "leaf-count".
    const result = await gateway.query(`mutation {
      plant(entity: "${FERN}", leaf_count: 12) { leaf_count }
    }`);
    expect(result.errors).toBeUndefined();
    expect((result.data as { plant: { leaf_count: number } }).plant.leaf_count).toBe(12);
    const persisted = await backend.deltasSince(new Set());
    const subject = persisted[0]!.claims.pointers.find((p) => p.role === "subject");
    expect(subject?.target.kind === "entity" && subject.target.entity.context).toBe("leaf-count");
    await gateway.close();
  });
});
