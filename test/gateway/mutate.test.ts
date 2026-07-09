// Step 4's write half: GraphQL mutate. One mutation field per registered schema, one argument
// per policy prop; each provided argument becomes a signed property-claim delta appended
// through the same validated write-through path as everything else. The mutation returns the
// re-resolved view — the response IS the re-query. A gateway holding no signing seed refuses
// to write: unsigned authority does not exist here.

import { describe, expect, it } from "vitest";
import { authorForSeed, verifyDelta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, garden } from "./fixtures.js";

const KEEPER_SEED = "c3".repeat(32);
const KEEPER = authorForSeed(KEEPER_SEED);

async function keeperGateway(backend = new MemoryBackend()): Promise<Gateway> {
  const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
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
    const persisted = await backend.deltasSince(new Set(garden.map((d) => d.id)));
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
    const fresh = await backend.deltasSince(new Set(garden.map((d) => d.id)));
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
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
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
    second.register(PLANT, PLANT_POLICY, [FERN]);
    const result = await second.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((result.data as { plant: { height: number } }).plant.height).toBe(44);
    await second.close();
  });

  it("gateway authorship is real authorship: byAuthorRank can prefer or distrust it", async () => {
    const gateway = await keeperGateway();
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 50) { height } }`);
    const result = await gateway.query(`{ plant(entity: "${FERN}") { _view } }`);
    expect(result.errors).toBeUndefined(); // the keeper's claim resolves like anyone's
    await gateway.close();
  });
});
