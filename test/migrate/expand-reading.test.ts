// The rhizomatic 0.8 migration (issue #23): an `expand` term must name the child's `reading`, and a
// legacy (readingless) body refuses to resolve. Two things now protect a store from that shape: the
// DOOR refuses to bind such a body at all (so it is never served broken — see reading-refs.test.ts),
// and this §20 migration carries an existing store forward by filling each `reading` from the child's
// single bound lens and negating the old form.
//
// The child here is deliberately named so the migration cannot cheat: its hyperschema is `PlantGather`
// while its reading is `Plant`. A step that merely echoed the expand's own `schema` field would write
// `reading: "PlantGather"` and fail — only genuine recovery from the store's BINDINGS produces `Plant`.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims, type Delta } from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";
import { PLANT, PLANT_READING, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { definitionBodyJson, stripReadingFromExpandDefinitions } from "./legacy.js";

const seed = GARDENER_SEED;
const operator = authorForSeed(seed);
const STRANGER_SEED = "b7".repeat(32);
const BED = "bed:shade";

// The child's GATHER is named differently from its READING — the whole point (see the header).
const PLANT_GATHER = { name: "PlantGather", alg: 1, body: PLANT.body };

const bedBody = parseTerm({
  op: "expand",
  role: { exact: "plant" },
  schema: "PlantGather",
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
  await gw.publishRegistration(
    PLANT_GATHER,
    PLANT_READING,
    [FERN],
    undefined,
    undefined,
    undefined,
    [...PLANT_WRITABLE],
  );
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

// The child's binding: what the migration must recover the reading from.
const isChildBinding = (d: Delta): boolean =>
  d.claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
  ) &&
  d.claims.pointers.some(
    (p) =>
      p.role === "hyperschema" &&
      p.target.kind === "entity" &&
      p.target.entity.id === "hyperschema:PlantGather",
  );

const bedReading = (deltas: readonly Delta[]): string | undefined => {
  for (const d of deltas) {
    const body = definitionBodyJson(d) as { op?: string; reading?: string } | undefined;
    if (body?.op === "expand" && body.reading !== undefined) return body.reading;
  }
  return undefined;
};

describe("migration: a legacy (readingless) expand body is carried forward (issue #23)", () => {
  it("a readingless body is not served at all — the door refuses to bind it", async () => {
    const legacy = await forge07Store();
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas: legacy });
    // The lens does not bind, so its query field never exists. That is strictly better than the
    // shape this migration was written for, where a readingless body bound, advertised a type, and
    // threw on the first read of an entity that actually had a child pointer.
    await expect(bedPlants(gw)).rejects.toThrow(/Cannot query field/i);
    await gw.close();
  });

  it("migrate recovers the reading from the child's BINDING (not the expand's own schema name)", async () => {
    const legacy = await forge07Store();
    const { deltas, report } = migrate(legacy, { seed });

    expect(report.applied.some((a) => a.id === "expand-reading" && a.superseded === 1)).toBe(true);
    // `Plant`, the child's bound lens — NOT `PlantGather`, the expand's own schema field.
    expect(bedReading(deltas)).toBe("Plant");

    // Grow-only: the old readingless definition is still on the record, and it is negated.
    expect(
      deltas.some((d) =>
        d.claims.pointers.some((p) => p.role === "negates" && p.target.kind === "delta"),
      ),
    ).toBe(true);

    // The surface is back: the Bed binds and resolves its fern to a nested Plant view.
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas });
    expect(await bedPlants(gw)).toMatchObject({ height: 40 });
    await gw.close();
  });

  it("a FOREIGN binding cannot choose the reading the operator re-signs", async () => {
    // The sharp case: the operator's own child binding is absent from the set (not yet synced), and a
    // stranger offers one naming `schema:Attacker`. The re-sign happens under the OPERATOR's key, so a
    // map built from unfiltered deltas would let an outsider dictate its content. It must decline.
    const legacy = (await forge07Store()).filter((d) => !isChildBinding(d));
    const poison = signClaims(
      {
        timestamp: 9000,
        author: authorForSeed(STRANGER_SEED),
        pointers: [
          {
            role: "registers",
            target: {
              kind: "entity",
              entity: { id: "registration:hyperschema:PlantGather", context: CTX_REGISTRATION },
            },
          },
          {
            role: "hyperschema",
            target: {
              kind: "entity",
              entity: { id: "hyperschema:PlantGather", context: "registration" },
            },
          },
          {
            role: "schema",
            target: { kind: "entity", entity: { id: "schema:Attacker", context: "registration" } },
          },
        ],
      },
      STRANGER_SEED,
    );

    const { deltas, report } = migrate([...legacy, poison], { seed });
    expect(report.applied.some((a) => a.id === "expand-reading")).toBe(false); // declined
    expect(bedReading(deltas)).toBeUndefined(); // nothing was filled, least of all "Attacker"
    // ...and crucially the original definition was NOT negated, so nothing was retired for nothing.
    expect(
      deltas.some((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "reason" &&
            p.target.kind === "primitive" &&
            String(p.target.value).includes("issue #23"),
        ),
      ),
    ).toBe(false);
  });

  it("is idempotent: re-migrating adds no fresh supersession", async () => {
    const legacy = await forge07Store();
    const first = migrate(legacy, { seed });
    const second = migrate(first.deltas, { seed });
    expect(new Set(second.deltas.map((d) => d.id))).toEqual(new Set(first.deltas.map((d) => d.id)));
    expect(second.report.applied.some((a) => a.id === "expand-reading")).toBe(false);
  });
});
