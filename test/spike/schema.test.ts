// SPEC §2, "Self-hosting schema-schema": schemas are data. publishSchemaClaims turns a
// HyperSchema into claims; loadSchema grows it back from deltas; evolution is append and
// deprecation is negation. The metacircular seed (SCHEMA_SCHEMA) round-trips through itself.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  SCHEMA_SCHEMA,
  evalTerm,
  loadSchema,
  makeDelta,
  makeNegationClaims,
  publishSchemaClaims,
  resultCanonicalHex,
  termHash,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { FERN, GARDENER, PLANT_BODY, GARDENER_SEED, observed } from "./garden.js";

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

  it("evolution is append: the newer definition supersedes", () => {
    const v1 = publishSchemaClaims(PLANT, "schema:Evolving", GARDENER, 1000);
    const v2 = publishSchemaClaims(
      { name: "PlantV2", alg: 1, body: PLANT_BODY },
      "schema:Evolving",
      GARDENER,
      2000,
    );
    const loaded = loadSchema(DeltaSet.from([makeDelta(v1), makeDelta(v2)]), "schema:Evolving");
    expect(loaded.name).toBe("PlantV2");
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
