// Step 3's contract: the read gateway. A Gateway fronts one StoreBackend — it boots by
// replaying the store into a Reactor, writes every accepted delta through, and serves GraphQL
// whose shape is DERIVED from (HyperSchema, Schema): field names from the policy's props,
// field shapes from each Policy's kind. A query resolves via resolveView over the live
// materialization, and its `_hex` is the content-addressed snapshot — stable across arrival
// order, stable across processes, changed only by relevant new deltas.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  makeDelta,
  parseTerm,
  publishHyperSchemaClaims,
  signClaims,
  termHash,
  type Delta,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER, GARDENER_SEED, PLANT_BODY, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_READING,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
  pickLatest,
} from "./fixtures.js";

const QUERY = `{
  plant(entity: "${FERN}") {
    _entity
    _hex
    height
    tag
    watered
    readings
  }
}`;

type PlantRow = {
  _entity: string;
  _hex: string;
  height: number;
  tag: string[];
  watered: boolean;
  readings: number;
};

async function openGateway(deltas: readonly Delta[] = garden): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend());
  await gateway.append(deltas);
  gateway.register(PLANT, PLANT_READING, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

async function queryPlant(gateway: Gateway): Promise<PlantRow> {
  const result = await gateway.query(QUERY);
  expect(result.errors).toBeUndefined();
  return (result.data as { plant: PlantRow }).plant;
}

const tmp = mkdtempSync(join(tmpdir(), "loam-gateway-"));
// maxRetries rides out a Windows EBUSY if the OS hasn't released a just-closed sqlite handle.
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe("the read gateway: GraphQL derived from (HyperSchema, Schema)", () => {
  it("a query returns the resolved view, shaped by the policy", async () => {
    const gateway = await openGateway();
    const plant = await queryPlant(gateway);
    expect(plant._entity).toBe(FERN);
    expect(plant.height).toBe(34); // pick byTimestamp desc
    expect(plant.tag).toEqual(["shade", "fronds"]); // all → list
    expect(plant.watered).toBe(false); // absentAs speaks for silence
    expect(plant.readings).toBe(2); // merge count → the COUNT (the values are 7 and 9)
    expect(plant._hex).toMatch(/^[0-9a-f]+$/);
    await gateway.close();
  });

  it("boots by replaying the backend: a store written yesterday answers today", async () => {
    const backend = new MemoryBackend();
    await backend.append(garden);
    const gateway = await Gateway.open(backend);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    expect((await queryPlant(gateway)).height).toBe(34);
    await gateway.close();
  });

  it("append moves the view and the hex; an irrelevant delta moves neither", async () => {
    const gateway = await openGateway();
    const before = await queryPlant(gateway);
    await gateway.append([observed("plant:moss", "height", 2, 2500, GARDENER_SEED)]);
    const unmoved = await queryPlant(gateway);
    expect(unmoved._hex).toBe(before._hex);
    await gateway.append([observed(FERN, "height", 37, 3000, GARDENER_SEED)]);
    const after = await queryPlant(gateway);
    expect(after.height).toBe(37);
    expect(after._hex).not.toBe(before._hex);
    await gateway.close();
  });

  it("the snapshot hash is stable: same deltas, any arrival order, any process", async () => {
    const forward = await openGateway(garden);
    const backward = await openGateway([...garden].reverse());
    const a = await queryPlant(forward);
    const b = await queryPlant(backward);
    expect(a._hex).toBe(b._hex);
    expect((await queryPlant(forward))._hex).toBe(a._hex); // re-query: same pin
    await forward.close();
    await backward.close();
  });

  it("loadHyperSchema: schema-defining deltas meta-resolve through HYPER_SCHEMA_SCHEMA into a HyperSchema", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    const published = signClaims(
      publishHyperSchemaClaims(PLANT, "schema:Plant", GARDENER, 1000),
      GARDENER_SEED,
    );
    const loaded = await gateway.loadHyperSchema([published], "schema:Plant");
    expect(loaded.name).toBe("Plant");
    expect(termHash(loaded.body)).toBe(termHash(PLANT.body));
    // the loaded schema serves queries like the hand-built one
    await gateway.append(garden);
    gateway.register(loaded, PLANT_POLICY, [FERN]);
    expect((await queryPlant(gateway)).height).toBe(34);
    await gateway.close();
  });

  it("writes through: everything the gateway accepted is durably in the backend", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend);
    await gateway.append(garden);
    await gateway.flush();
    const persisted = await backend.deltasSince(new Set());
    expect(persisted.map((d) => d.id).sort()).toEqual(garden.map((d) => d.id).sort());
    await gateway.close();
  });

  it("a forged delta is refused whole: nothing ingested, nothing persisted", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend);
    const forged: Delta = { ...garden[0]!, id: `1e20${"00".repeat(32)}` };
    await expect(gateway.append([forged])).rejects.toThrow(/rejected/);
    expect(await backend.deltasSince(new Set())).toEqual([]);
    await gateway.close();
  });

  it("the whole road survives a process death: sqlite → close → reopen → same view, same hex", async () => {
    const path = join(tmp, "garden.sqlite");
    const first = await Gateway.open(new SqliteBackend(path));
    await first.append(garden);
    first.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const before = await queryPlant(first);
    await first.close();

    const second = await Gateway.open(new SqliteBackend(path));
    second.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const after = await queryPlant(second);
    expect(after).toEqual(before);
    await second.close();
  });

  it("an entity nobody has spoken about resolves by policy: absence is an answer", async () => {
    const gateway = await openGateway();
    const result = await gateway.query(
      `{ plant(entity: "plant:unheard-of") { watered height readings } }`,
    );
    expect(result.errors).toBeUndefined();
    const ghost = (
      result.data as {
        plant: { watered: boolean; height: number | null; readings: number | null };
      }
    ).plant;
    expect(ghost.watered).toBe(false); // absentAs still speaks
    expect(ghost.height).toBeNull(); // pick over silence is null
    expect(ghost.readings).toBeNull(); // and so is a count of nothing
    await gateway.close();
  });

  it("append receipts are exact: accepted counts, duplicates count, dupes persist once", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    expect(await gateway.append(garden)).toEqual({ accepted: 6, duplicates: 0 });
    expect(await gateway.append(garden.slice(0, 2))).toEqual({ accepted: 0, duplicates: 2 });
    await gateway.close();
  });

  it("query before anything is registered refuses plainly", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await expect(gateway.query(`{ plant(entity: "x") { _hex } }`)).rejects.toThrow(
      /nothing is registered/,
    );
    await gateway.close();
  });

  it("two schemas serve side by side; an expand ref nests the child view through ViewValue", async () => {
    const BED = "bed:shade";
    const bedBody = parseTerm({
      op: "expand",
      role: { exact: "plant" },
      schema: "Plant",
      reading: "Plant", // issue #23: the child resolves through its own Plant reading
      in: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "drop", in: "input" },
        },
      },
    });
    const planting = signClaims(
      {
        timestamp: 1100,
        author: GARDENER,
        pointers: [
          { role: "bed", target: { kind: "entity", entity: { id: BED, context: "plants" } } },
          { role: "plant", target: { kind: "entity", entity: { id: FERN, context: "planted" } } },
        ],
      },
      GARDENER_SEED,
    );
    const gateway = await openGateway([...garden, planting]);
    gateway.register(
      { name: "BedWithPlants", alg: 1, body: bedBody },
      { props: new Map([["plants", pickLatest]]), default: pickLatest },
      [BED],
    );
    const result = await gateway.query(`{
      plant(entity: "${FERN}") { height }
      bedWithPlants(entity: "${BED}") { plants _view }
    }`);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      plant: { height: number };
      bedWithPlants: { plants: Record<string, unknown>; _view: Record<string, unknown> };
    };
    expect(data.plant.height).toBe(34);
    expect(data.bedWithPlants.plants).toMatchObject({ height: 34 }); // the nested child view
    expect(data.bedWithPlants._view).toHaveProperty("plants");
    await gateway.close();
  });

  it("_view carries dynamic properties the policy never named", async () => {
    const gateway = await openGateway([
      ...garden,
      observed(FERN, "kind", "fern", 1200, GARDENER_SEED), // no policy prop for "kind"
    ]);
    const result = await gateway.query(`{ plant(entity: "${FERN}") { _view } }`);
    const view = (result.data as { plant: { _view: Record<string, unknown> } }).plant._view;
    expect(view["kind"]).toBe("fern");
    await gateway.close();
  });

  it("a refused registration leaves the gateway exactly as it was", async () => {
    const gateway = await openGateway();
    // duplicate schema name → refused by the registry
    expect(() =>
      gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE),
    ).toThrow();
    // a colliding property name → refused by the gql builder
    expect(() =>
      gateway.register(
        { name: "Plant2", alg: 1, body: PLANT_BODY },
        { props: new Map([["_hex", pickLatest]]), default: pickLatest },
        [FERN],
      ),
    ).toThrow(/collides/);
    // and the gateway still answers as before
    expect((await queryPlant(gateway)).height).toBe(34);
    await gateway.close();
  });

  it("loadHyperSchema proves the definition before anything lands: a bad batch persists nothing", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend);
    const stray = observed(FERN, "height", 30, 1000, GARDENER_SEED); // defines no schema
    await expect(gateway.loadHyperSchema([stray], "schema:Nope")).rejects.toThrow(
      /no surviving schema definition/,
    );
    expect(await backend.deltasSince(new Set())).toEqual([]); // append-only stores forgive nothing
    await gateway.close();
  });

  it("a failed write means nothing happened: not ingested, not served, retry welcome", async () => {
    class FailingBackend extends MemoryBackend {
      failNow = false;
      override append(deltas: Iterable<Delta>): Promise<number> {
        if (this.failNow) return Promise.reject(new Error("disk failure"));
        return super.append(deltas);
      }
    }
    const backend = new FailingBackend();
    const gateway = await Gateway.open(backend, { seed: "c3".repeat(32) });
    await gateway.append(governedBootstrap("c3".repeat(32)));
    await gateway.append(garden);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const before = await queryPlant(gateway);

    backend.failNow = true;
    const failed = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
    );
    expect(failed.errors?.join(" ")).toMatch(/disk failure/);
    // the mutation that failed is NOT being served: no phantom state
    expect((await queryPlant(gateway)).height).toBe(before.height);
    expect((await queryPlant(gateway))._hex).toBe(before._hex);

    // the disk heals; the same write simply works — a failed append is retryable, not fatal
    backend.failNow = false;
    const retried = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
    );
    expect(retried.errors).toBeUndefined();
    expect((await queryPlant(gateway)).height).toBe(99);
    await gateway.close();
  });

  it("the gateway refuses unsigned deltas — authority is always attested here", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    const unsigned = makeDelta({
      timestamp: 1,
      author: "did:key:zAnyoneAtAll",
      pointers: [{ role: "note", target: { kind: "primitive", value: "trust me" } }],
    });
    await expect(gateway.append([unsigned])).rejects.toThrow(/unsigned/);
    await gateway.close();
  });
});
