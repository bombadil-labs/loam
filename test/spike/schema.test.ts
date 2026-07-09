// SPEC §2, "Self-hosting schema-schema": schemas are data. publishSchemaClaims turns a
// HyperSchema into claims; loadSchema grows it back from deltas; evolution is append and
// deprecation is negation. The metacircular seed (SCHEMA_SCHEMA) round-trips through itself.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  SCHEMA_SCHEMA,
  SchemaRegistry,
  collectRefs,
  evalTerm,
  loadSchema,
  makeDelta,
  makeNegationClaims,
  parseTerm,
  publishSchemaClaims,
  resolveView,
  resultCanonicalHex,
  signClaims,
  termHash,
  type HyperSchema,
  type View,
} from "@bombadil/rhizomatic";
import { FERN, GARDENER, GARDENER_SEED, PLANT_BODY, SURVEYOR_SEED, observed } from "./garden.js";

const PLANT: HyperSchema = { name: "Plant", alg: 1, body: PLANT_BODY };

describe("spike: loadSchema(deltas) → HyperSchema", () => {
  it("publish → load round-trips a schema through deltas", () => {
    const claims = publishSchemaClaims(PLANT, "schema:Plant", GARDENER, 1000);
    const dset = DeltaSet.from([makeDelta(claims)]);
    const loaded = loadSchema(dset, "schema:Plant");
    expect(loaded.name).toBe("Plant");
    expect(loaded.alg).toBe(PLANT.alg);
    expect(termHash(loaded.body)).toBe(termHash(PLANT.body));
  });

  it("the loaded schema evaluates identically to the original", () => {
    const world = DeltaSet.from([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      makeDelta(publishSchemaClaims(PLANT, "schema:Plant", GARDENER, 1000)),
    ]);
    const loaded = loadSchema(world, "schema:Plant");
    const viaLoaded = evalTerm(loaded.body, world, FERN);
    const viaOriginal = evalTerm(PLANT.body, world, FERN);
    expect(resultCanonicalHex(viaLoaded)).toBe(resultCanonicalHex(viaOriginal));
  });

  it("evolution is append: the newer definition supersedes, body and all", () => {
    // v2's body genuinely differs from v1's — otherwise supersession of the term is unprovable.
    const v2Body = parseTerm({ op: "group", key: "byRole", in: "input" });
    const v1 = publishSchemaClaims(PLANT, "schema:Evolving", GARDENER, 1000);
    const v2 = publishSchemaClaims(
      { name: "PlantV2", alg: 1, body: v2Body },
      "schema:Evolving",
      GARDENER,
      2000,
    );
    const loaded = loadSchema(DeltaSet.from([makeDelta(v1), makeDelta(v2)]), "schema:Evolving");
    expect(loaded.name).toBe("PlantV2");
    expect(termHash(loaded.body)).toBe(termHash(v2Body));
    expect(termHash(loaded.body)).not.toBe(termHash(PLANT.body));
  });

  it("deprecation is negation: a negated definition does not load", () => {
    const only = makeDelta(publishSchemaClaims(PLANT, "schema:Dead", GARDENER, 1000));
    const negation = makeDelta(makeNegationClaims(GARDENER, 1100, only.id));
    expect(() => loadSchema(DeltaSet.from([only, negation]), "schema:Dead")).toThrow(
      /no surviving schema definition/,
    );
  });

  it("the metacircular seed: SCHEMA_SCHEMA round-trips through its own machinery", () => {
    const claims = publishSchemaClaims(SCHEMA_SCHEMA, "schema:schema", GARDENER, 1);
    const loaded = loadSchema(DeltaSet.from([makeDelta(claims)]), "schema:schema");
    expect(loaded.name).toBe(SCHEMA_SCHEMA.name);
    expect(termHash(loaded.body)).toBe(termHash(SCHEMA_SCHEMA.body));
  });
});

describe("spike: schema refs — the recursion step 3's nested GraphQL types stand on", () => {
  // A bed holds plants: the BedWithPlants schema expands each "plant" edge through the Plant
  // schema, nesting a child HView inside the parent's bucket.
  const BED = "bed:shade";
  const BED_BODY = parseTerm({
    op: "expand",
    role: { exact: "plant" },
    schema: "Plant",
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
  const registry = SchemaRegistry.build([PLANT, { name: "BedWithPlants", alg: 1, body: BED_BODY }]);

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
  const world = DeltaSet.from([planting, observed(FERN, "height", 30, 1000, SURVEYOR_SEED)]);

  it("collectRefs names the dependency", () => {
    expect(collectRefs(BED_BODY)).toEqual([{ kind: "name", name: "Plant" }]);
  });

  it("expansion nests the child HView; resolveView recurses through it", () => {
    const result = evalTerm(BED_BODY, world, BED, registry);
    if (result.sort !== "hview") throw new Error(`expected an hview, got ${result.sort}`);
    const entries = result.hview.props.get("plants");
    expect(entries).toHaveLength(1);
    expect(entries![0]!.expanded?.size).toBe(1);

    const view = resolveView(
      { props: new Map(), default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } } },
      result.hview,
    ) as Record<string, View>;
    // The child carries its own properties AND the back-edge that led there: the planting delta
    // files under the fern too, so the expanded view shows `planted: bed` — the graph is honest
    // about both directions of the edge.
    expect(view["plants"]).toEqual({ height: 30, planted: BED });
  });
});
