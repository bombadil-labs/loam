import { describe, expect, it } from "vitest";
import { verifyDelta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";
import { isStoreLocal } from "../../src/gateway/recovery-cut.js";

const KEEPER_SEED = "c3".repeat(32);

async function keeperGateway(backend = new MemoryBackend()): Promise<Gateway> {
  const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

const clear = (entity: string, fields: string[]): string =>
  `mutation { clearPlant(entity: "${entity}", fields: [${fields
    .map((f) => `"${f}"`)
    .join(", ")}]) { height tag readings watered } }`;

type PlantView = { height: number | null; tag: string[]; readings: number; watered: boolean };
const viewOf = (r: { data?: unknown }): PlantView =>
  (r.data as { clearPlant: PlantView }).clearPlant;

describe("clear (§14): retraction is the dual of resolution", () => {
  it("pick — retracting your own hands the field to the next survivor, then to absence", async () => {
    const gateway = await keeperGateway();
    let read = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(34);

    const afterSurveyor = await gateway.query(clear(FERN, ["height"]), undefined, {
      actor: SURVEYOR_SEED,
    });
    expect(afterSurveyor.errors).toBeUndefined();
    expect(viewOf(afterSurveyor).height).toBe(30);

    const afterGardener = await gateway.query(clear(FERN, ["height"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(viewOf(afterGardener).height).toBeNull();

    read = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number | null } }).plant.height).toBeNull();
    await gateway.close();
  });

  it("retract-your-own is scoped: a clear never touches another author's contribution", async () => {
    const gateway = await keeperGateway();
    const after = await gateway.query(clear(FERN, ["tag"]), undefined, { actor: GARDENER_SEED });
    expect(after.errors).toBeUndefined();
    expect(viewOf(after).tag).toEqual(["fronds"]);
    await gateway.close();
  });

  it("merge — a clear withdraws your addend, and the reduction recomputes", async () => {
    const gateway = await keeperGateway();
    const read = await gateway.query(`{ plant(entity: "${FERN}") { readings } }`);
    expect((read.data as { plant: { readings: number } }).plant.readings).toBe(2);
    const after = await gateway.query(clear(FERN, ["readings"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(viewOf(after).readings).toBe(1);
    await gateway.close();
  });

  it("absence renders per absentAs — a cleared field falls to the lens's fallback, not null", async () => {
    const gateway = await keeperGateway();
    await gateway.query(
      `mutation { plant(entity: "${FERN}", watered: true) { watered } }`,
      undefined,
      {
        actor: GARDENER_SEED,
      },
    );
    const after = await gateway.query(clear(FERN, ["watered"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(viewOf(after).watered).toBe(false);
    await gateway.close();
  });

  it("you clear what you said, not what the world said: a fresh assertion repopulates", async () => {
    const gateway = await keeperGateway();
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: SURVEYOR_SEED });
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    const repopulated = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 50) { height } }`,
      undefined,
      { actor: SURVEYOR_SEED },
    );
    expect((repopulated.data as { plant: { height: number } }).plant.height).toBe(50);
    await gateway.close();
  });

  it("clearing appends a real signed negation, authored by the clearer, honored at the mask", async () => {
    const backend = new MemoryBackend();
    const gateway = await keeperGateway(backend);
    const settled = new Set([...garden, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id));
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const fresh = (await backend.deltasSince(settled)).filter((d) => !isStoreLocal(d));
    expect(fresh).toHaveLength(1);
    const neg = fresh[0]!;
    expect(verifyDelta(neg)).toBe("verified");
    expect(neg.claims.author).toBe(GARDENER);
    expect(neg.claims.pointers.some((p) => p.role === "negates" && p.target.kind === "delta")).toBe(
      true,
    );
    await gateway.close();
  });

  it("is idempotent: clearing an already-cleared field adds no new negation", async () => {
    const backend = new MemoryBackend();
    const gateway = await keeperGateway(backend);
    const settled = new Set([...garden, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id));
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const afterFirst = (await backend.deltasSince(settled)).length;
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const afterSecond = (await backend.deltasSince(settled)).length;
    expect(afterSecond).toBe(afterFirst);
    await gateway.close();
  });

  it("refuses a field the schema does not resolve — a quiet no-op would lie about clearing", async () => {
    const gateway = await keeperGateway();
    const result = await gateway.query(clear(FERN, ["nonesuch"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(result.errors?.join(" ")).toMatch(/no field "nonesuch"|nonesuch/);
    await gateway.close();
  });

  it("a seedless, actorless gateway cannot retract any more than it can assert", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append(garden);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const result = await gateway.query(clear(FERN, ["height"]));
    expect(result.errors?.join(" ")).toMatch(/no signing seed/);
    await gateway.close();
  });

  it("a stranger with nothing of their own clears nothing — retraction has no reach beyond you", async () => {
    const gateway = await keeperGateway();
    const stranger = "e4".repeat(32);
    const after = await gateway.query(clear(FERN, ["height"]), undefined, { actor: stranger });
    expect(after.errors).toBeUndefined();
    expect(viewOf(after).height).toBe(34);
    await gateway.close();
  });
});

const remove = (entity: string, field: string, values: (string | number)[]): string =>
  `mutation { removePlant(entity: "${entity}", field: "${field}", values: [${values
    .map((v) => (typeof v === "string" ? `"${v}"` : v))
    .join(", ")}]) { tag readings } }`;
const removed = (r: { data?: unknown }): PlantView =>
  (r.data as { removePlant: PlantView }).removePlant;

describe("remove (§14 amendment): value-scoped retraction", () => {
  it("withdraws only your own contribution of a value — the rest of the field stands", async () => {
    const gateway = await keeperGateway();
    const after = await gateway.query(remove(FERN, "tag", ["shade"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(removed(after).tag).toEqual(["fronds"]);
    await gateway.close();
  });

  it("cannot remove a value you did not author — retract-your-own holds for a single value too", async () => {
    const gateway = await keeperGateway();
    const after = await gateway.query(remove(FERN, "tag", ["fronds"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(removed(after).tag).toEqual(["shade", "fronds"]);
    await gateway.close();
  });

  it("withdraws a specific merge addend — the reduction recomputes without it", async () => {
    const gateway = await keeperGateway();
    const mine = await gateway.query(remove(FERN, "readings", [7]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(removed(mine).readings).toBe(1);
    const notMine = await gateway.query(remove(FERN, "readings", [9]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(removed(notMine).readings).toBe(1);
    await gateway.close();
  });

  it("refuses a field the schema does not resolve", async () => {
    const gateway = await keeperGateway();
    const result = await gateway.query(remove(FERN, "nonesuch", ["x"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(result.errors?.join(" ")).toMatch(/no field "nonesuch"|nonesuch/);
    await gateway.close();
  });
});

describe("writability (§14 amendment): front-door discipline", () => {
  async function writableGateway(): Promise<Gateway> {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
    await gateway.append(governedBootstrap(KEEPER_SEED));
    await gateway.append(garden);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, ["height"]);
    return gateway;
  }

  it("a read-only field is not even offered as a per-prop mutation argument", async () => {
    const gateway = await writableGateway();
    const result = await gateway.query(
      `mutation { plant(entity: "${FERN}", tag: "x") { tag } }`,
      undefined,
      {
        actor: GARDENER_SEED,
      },
    );
    expect(result.errors?.join(" ")).toMatch(/tag|unknown|not defined/i);
    const ok = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 40) { height } }`,
      undefined,
      {
        actor: GARDENER_SEED,
      },
    );
    expect(ok.errors).toBeUndefined();
    expect((ok.data as { plant: { height: number } }).plant.height).toBe(40);
    await gateway.close();
  });

  it("clear and remove refuse a read-only field with a reason", async () => {
    const gateway = await writableGateway();
    const cleared = await gateway.query(clear(FERN, ["tag"]), undefined, { actor: GARDENER_SEED });
    expect(cleared.errors?.join(" ")).toMatch(/read-only/);
    const removedRes = await gateway.query(remove(FERN, "tag", ["shade"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(removedRes.errors?.join(" ")).toMatch(/read-only/);
    const okClear = await gateway.query(clear(FERN, ["height"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(okClear.errors).toBeUndefined();
    await gateway.close();
  });

  it("writability survives as data: a published registration re-enforces it after reopen", async () => {
    const backend = new MemoryBackend();
    const gw = await Gateway.open(backend, { seed: KEEPER_SEED });
    await gw.append(governedBootstrap(KEEPER_SEED));
    await gw.append(garden);
    await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    await gw.flush();

    const reopened = await Gateway.open(backend, { seed: KEEPER_SEED });
    const cleared = await reopened.query(clear(FERN, ["tag"]), undefined, { actor: GARDENER_SEED });
    expect(cleared.errors?.join(" ")).toMatch(/read-only/);
    await reopened.close();
  });
});
