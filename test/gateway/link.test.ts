import { describe, expect, it } from "vitest";
import { verifyDelta } from "@bombadil/rhizomatic";
import { expandedGatherBody } from "../../src/gateway/gather.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_READING,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
  pickLatest,
} from "./fixtures.js";
import { isStoreLocal } from "../../src/gateway/recovery-cut.js";

const KEEPER_SEED = "c3".repeat(32);
const BED = "bed:shade";
const MOSS = "plant:moss";

const bedBody = expandedGatherBody({ role: "plant", schema: "Plant", reading: "Plant" });
const BED_SCHEMA = { name: "Bed", alg: 1, body: bedBody } as const;
const BED_POLICY = {
  props: new Map([
    ["plants", pickLatest],
    ["name", pickLatest],
  ]),
  default: pickLatest,
};

const world = [...garden, observed(MOSS, "height", 12, 1000, GARDENER_SEED)];

async function bedGateway(backend = new MemoryBackend()): Promise<Gateway> {
  const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(world);
  gateway.register(PLANT, PLANT_READING, [FERN, MOSS], undefined, PLANT_WRITABLE);
  gateway.register(BED_SCHEMA, BED_POLICY, [BED], undefined, ["plants", "name"]);
  return gateway;
}

const link = (entity: string, field: string, target: string): string =>
  `mutation { linkBed(entity: "${entity}", field: "${field}", target: "${target}") { plants name } }`;
const sever = (entity: string, field: string, targets?: string[]): string =>
  `mutation { severBed(entity: "${entity}", field: "${field}"${
    targets === undefined ? "" : `, targets: [${targets.map((t) => `"${t}"`).join(", ")}]`
  }) { plants } }`;

type BedView = { plants: Record<string, unknown> | null; name?: string | null };
const linked = (r: { data?: unknown }): BedView => (r.data as { linkBed: BedView }).linkBed;
const severed = (r: { data?: unknown }): BedView => (r.data as { severBed: BedView }).severBed;

describe("link / sever (§14 edge verbs): assert and retract an edge, named", () => {
  it("link asserts an edge that resolves to the child's view; sever retracts it to absence", async () => {
    const gateway = await bedGateway();
    const before = await gateway.query(`{ bed(entity: "${BED}") { plants } }`);
    expect((before.data as { bed: { plants: unknown } }).bed.plants).toBeNull();

    const after = await gateway.query(link(BED, "plants", FERN), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(linked(after).plants).toMatchObject({ height: 34 });

    const reread = await gateway.query(`{ bed(entity: "${BED}") { plants } }`);
    expect((reread.data as { bed: { plants: Record<string, unknown> } }).bed.plants).toMatchObject({
      height: 34,
    });

    const gone = await gateway.query(sever(BED, "plants"), undefined, { actor: GARDENER_SEED });
    expect(gone.errors).toBeUndefined();
    expect(severed(gone).plants).toBeNull();
    await gateway.close();
  });

  it("sever is value-scoped by target: naming one edge leaves the others standing", async () => {
    const gateway = await bedGateway();
    await gateway.query(link(BED, "plants", FERN), undefined, { actor: GARDENER_SEED });
    await gateway.query(link(BED, "plants", MOSS), undefined, { actor: GARDENER_SEED });
    const both = await gateway.query(`{ bed(entity: "${BED}") { plants } }`);
    expect((both.data as { bed: { plants: Record<string, unknown> } }).bed.plants).toMatchObject({
      height: 12,
    });

    const after = await gateway.query(sever(BED, "plants", [MOSS]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(severed(after).plants).toMatchObject({ height: 34 });
    await gateway.close();
  });

  it("linking appends one real signed edge delta, authored by the linker", async () => {
    const backend = new MemoryBackend();
    const gateway = await bedGateway(backend);
    const settled = new Set([...world, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id));
    await gateway.query(link(BED, "plants", FERN), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const fresh = (await backend.deltasSince(settled)).filter((d) => !isStoreLocal(d));
    expect(fresh).toHaveLength(1);
    const edge = fresh[0]!;
    expect(verifyDelta(edge)).toBe("verified");
    expect(edge.claims.author).toBe(GARDENER);
    const subject = edge.claims.pointers.find((p) => p.role === "subject");
    const plant = edge.claims.pointers.find((p) => p.role === "plant");
    expect(subject?.target).toMatchObject({
      kind: "entity",
      entity: { id: BED, context: "plants" },
    });
    expect(plant?.target).toMatchObject({ kind: "entity", entity: { id: FERN } });
    await gateway.close();
  });

  it("sever retracts only your own edges — a stranger severs nothing", async () => {
    const gateway = await bedGateway();
    await gateway.query(link(BED, "plants", FERN), undefined, { actor: GARDENER_SEED });
    const stranger = "e4".repeat(32);
    const after = await gateway.query(sever(BED, "plants"), undefined, { actor: stranger });
    expect(after.errors).toBeUndefined();
    expect(severed(after).plants).toMatchObject({ height: 34 });
    await gateway.close();
  });

  it("a primitive schema offers no entity-pointer write: link<Type> does not exist", async () => {
    const gateway = await bedGateway();
    const result = await gateway.query(
      `mutation { linkPlant(entity: "${FERN}", field: "height", target: "${MOSS}") { _hex } }`,
    );
    expect(result.errors?.join(" ")).toMatch(/linkPlant/);
    const ok = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 41) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect((ok.data as { plant: { height: number } }).plant.height).toBe(41);
    await gateway.close();
  });

  it("refuses an edge field the schema does not resolve — a quiet no-op would lie", async () => {
    const gateway = await bedGateway();
    const result = await gateway.query(link(BED, "nonesuch", FERN), undefined, {
      actor: GARDENER_SEED,
    });
    expect(result.errors?.join(" ")).toMatch(/nonesuch/);
    await gateway.close();
  });

  it("a seedless, actorless gateway cannot link any more than it can assert", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append(world);
    gateway.register(PLANT, PLANT_READING, [FERN, MOSS], undefined, PLANT_WRITABLE);
    gateway.register(BED_SCHEMA, BED_POLICY, [BED], undefined, ["plants", "name"]);
    const result = await gateway.query(link(BED, "plants", FERN));
    expect(result.errors?.join(" ")).toMatch(/no signing seed/);
    await gateway.close();
  });

  it("writability disciplines edges too: a read-only edge field refuses link and sever", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
    await gateway.append(governedBootstrap(KEEPER_SEED));
    await gateway.append(world);
    gateway.register(PLANT, PLANT_READING, [FERN, MOSS], undefined, PLANT_WRITABLE);
    gateway.register(BED_SCHEMA, BED_POLICY, [BED], undefined, ["name"]);
    const linkRes = await gateway.query(link(BED, "plants", FERN), undefined, {
      actor: GARDENER_SEED,
    });
    expect(linkRes.errors?.join(" ")).toMatch(/read-only/);
    const severRes = await gateway.query(sever(BED, "plants"), undefined, { actor: GARDENER_SEED });
    expect(severRes.errors?.join(" ")).toMatch(/read-only/);
    await gateway.close();
  });
});
