// The rhizomatic 0.8 migration (issue #23): an `expand` term must name the child's `reading`, and a
// legacy (readingless) body now REFUSES to resolve its expansions — loudly, with no parent-Schema
// fallback. Every store that holds an expand body must therefore be carried forward: the definition
// re-signed with `reading` filled from the child's single lens (pre-0.8 stores are single-lens, so
// the choice is mechanical), the old form negated. This suite forges a genuine 0.7-era store — a real
// 0.8 store with `reading` stripped back out of its Bed definition — proves the Bed can't resolve,
// migrates it, and proves the timeline of nested Plant views comes back.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims, type Delta } from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { PLANT, PLANT_READING, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { definitionBodyJson, stripReadingFromExpandDefinitions } from "./legacy.js";

const seed = GARDENER_SEED;
const operator = authorForSeed(seed);
const BED = "bed:shade";

// A Bed gathers what points at it, then EXPANDS the `plant` role into the child's Plant view — the
// body names both halves of the child's lens (0.8), so stripping `reading` makes it a 0.7-era body.
const bedBody = parseTerm({
  op: "expand",
  role: { exact: "plant" },
  schema: "Plant",
  reading: "Plant",
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
const PICK = {
  kind: "pick" as const,
  order: { kind: "byTimestamp" as const, dir: "desc" as const },
};
const BED_HYPER = { name: "BedWithPlants", alg: 1, body: bedBody };
const BED_SCHEMA = {
  name: "BedWithPlants",
  alg: 1,
  props: new Map([["plants", PICK]]),
  default: PICK,
};

// One fern planted in the bed, plus a height for it to read — a real nested view to (fail to) resolve.
const planting = signClaims(
  {
    timestamp: 1100,
    author: operator,
    pointers: [
      { role: "bed", target: { kind: "entity", entity: { id: BED, context: "plants" } } },
      { role: "plant", target: { kind: "entity", entity: { id: FERN, context: "planted" } } },
    ],
  },
  seed,
);

// Forge a genuine 0.7-era store: build a native 0.8 store through the real registration path, then
// strip `reading` back out of the Bed's definition blob — nothing else touched.
async function forge07Store(): Promise<Delta[]> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed });
  await gw.append([signClaims(operatorMarkerClaims(operator), seed)]);
  await gw.append([observed(FERN, "height", 40, 5000, seed), planting]);
  await gw.publishRegistration(PLANT, PLANT_READING, [FERN], undefined, undefined, undefined, [
    ...PLANT_WRITABLE,
  ]);
  await gw.publishRegistration(BED_HYPER, BED_SCHEMA, [BED]);
  const deltas = await backend.deltasSince(new Set());
  await gw.close();
  return stripReadingFromExpandDefinitions(deltas, seed);
}

const bedPlants = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ bedWithPlants(entity: "${BED}") { plants } }`);
  if (res.errors && res.errors.length > 0) throw new Error(res.errors.join("; "));
  return (res.data as { bedWithPlants: { plants: unknown } }).bedWithPlants.plants;
};

describe("migration: a legacy (readingless) expand body is carried forward (issue #23)", () => {
  it("the forged store's Bed cannot resolve its expansion — the breakage the migration heals", async () => {
    const legacy = await forge07Store();
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas: legacy });
    // The expand refuses without a reading — loudly, no parent-Schema fallback.
    await expect(bedPlants(gw)).rejects.toThrow(/reading/i);
    await gw.close();
  });

  it("migrate fills `reading` from the child's single lens; the nested view comes back", async () => {
    const legacy = await forge07Store();
    const { deltas, report } = migrate(legacy, { seed });

    // The new step fired and superseded the one readingless Bed definition.
    expect(report.applied.some((a) => a.id === "expand-reading" && a.superseded === 1)).toBe(true);

    // The migrated Bed definition's body now NAMES the child's reading.
    const migratedBedDef = deltas.find((d) => {
      const body = definitionBodyJson(d) as { op?: string; reading?: string } | undefined;
      return body?.op === "expand" && body.reading === "Plant";
    });
    expect(migratedBedDef, "a reading-bearing Bed definition exists after migration").toBeDefined();

    // Grow-only: the old readingless definition is still on the record, and it is negated.
    const negated = deltas.some((d) =>
      d.claims.pointers.some((p) => p.role === "negates" && p.target.kind === "delta"),
    );
    expect(negated).toBe(true);

    // The surface is back: the Bed resolves its fern to a nested Plant view.
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas });
    expect(await bedPlants(gw)).toMatchObject({ height: 40 });
    await gw.close();
  });

  it("is idempotent: re-migrating adds no fresh supersession", async () => {
    const legacy = await forge07Store();
    const first = migrate(legacy, { seed });
    const second = migrate(first.deltas, { seed });
    expect(new Set(second.deltas.map((d) => d.id))).toEqual(new Set(first.deltas.map((d) => d.id)));
    expect(second.report.applied.some((a) => a.id === "expand-reading")).toBe(false);
  });
});
