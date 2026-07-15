// The full §21 migration chain in practice (SPEC §20 + §21 + §14 wave B). A store already on disk in
// the PRE-§21 shape — registrations under `schema:Plant`, the resolution Schema quoted INLINE, no
// `writable` — is carried forward by two composed steps:
//   • slice 1 (hyperschema-entity-rename): `schema:<Name>` → `hyperschema:<Name>`, and every
//     registration gains an explicit `writable` list (immutable-by-default flips silence from
//     "everything writable" to "nothing writable", so the list preserves the pre-flip surface exactly).
//   • slice 2 (inline-schema-to-entity): the inline Schema is LIFTED to a first-class `schema:<Name>`
//     entity with a frozen VersionedSchema snapshot, and the registration becomes a BINDING that
//     references both — §21's decoupling, finished.
// Each step re-signs the affected deltas into the new form at their original timestamps and NEGATES
// the old with a `supersededBy` link and a reason — supersede, never rewrite. This suite forges the
// pre-§21 store, proves its surface is DARK until migration (the inline shape no longer binds), runs
// the chain, and proves the surface is whole again — reads, writes, and a first-class Schema entity.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  authorForSeed,
  loadSchema,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { legacyInlineRegistrationClaims } from "./legacy.js";

const seed = GARDENER_SEED;
const operator = authorForSeed(seed);
const OLD_ENTITY = "schema:Plant";

// A pre-§21 store: a definition + registration filed under `schema:Plant`, the registration carrying
// the Schema INLINE and NO `writable` list (as every pre-flip registration did), plus the operator
// marker so a gateway can boot it, and one data claim so there is a view to resolve.
const oldDef = signClaims(publishHyperSchemaClaims(PLANT, OLD_ENTITY, operator, 1), seed);
const oldReg = signClaims(
  legacyInlineRegistrationClaims(OLD_ENTITY, PLANT_POLICY, [FERN], operator, 2),
  seed,
);
const marker = signClaims(operatorMarkerClaims(operator), seed);
const data = observed(FERN, "height", 40, 5000, seed);
const oldStore: Delta[] = [marker, oldDef, oldReg, data];

const isNegation = (d: Delta): boolean => d.claims.pointers.some((p) => p.role === "negates");
const entityId = (d: Delta, role: string): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};
// The surviving, entity-form BINDING for a hyperschema (its `schema` role is an entity pointer, the
// slice-2 shape) — distinct from any negated legacy inline registration still on the record.
const boundBinding = (deltas: Delta[], hyperschema: string): Delta | undefined =>
  deltas.find(
    (d) =>
      !isNegation(d) &&
      entityId(d, "hyperschema") === hyperschema &&
      d.claims.pointers.some((p) => p.role === "schema" && p.target.kind === "entity"),
  );

describe("migration: the full §21 chain (rename + writable + inline-schema lift)", () => {
  it("the old registration has no writable, quotes its Schema inline, and files under schema:", () => {
    expect(oldReg.claims.pointers.some((p) => p.role === "writable")).toBe(false);
    expect(entityId(oldReg, "hyperschema")).toBe("schema:Plant");
    // the legacy shape carries the Schema as an inline primitive, not an entity reference
    const schemaRole = oldReg.claims.pointers.find((p) => p.role === "schema");
    expect(schemaRole?.target.kind).toBe("primitive");
  });

  it("an un-migrated store's surface is DARK until migration (the inline shape no longer binds)", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas: oldStore });
    // the registration is the legacy inline shape; the reader wants entity references, so it binds
    // nothing — the store boots, but Plant is unregistered until `loam migrate` lifts it, and with no
    // bound surface at all the gateway has no schema to answer against.
    await expect(gw.query(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /nothing is registered/,
    );
    await gw.close();
  });

  it("lifts the Schema to an entity, binds it, negates the legacy forms, and preserves the surface", () => {
    const { deltas, report } = migrate(oldStore, { seed });

    // the surviving binding speaks the hyperschema: prefix and references entities, not inline bytes
    const binding = boundBinding(deltas, "hyperschema:Plant");
    expect(
      binding,
      "a binding now points at hyperschema:Plant with an entity schema role",
    ).toBeDefined();
    expect(entityId(binding!, "schema")).toBe("schema:Plant"); // the living Schema entity
    const snapshot = entityId(binding!, "schemaVersion");
    expect(snapshot?.startsWith("schema:Plant@")).toBe(true); // the frozen VersionedSchema

    // the living Schema entity actually LOADS — the (now-negated) old hyperschema deltas that a
    // migrated store still holds at `schema:Plant` are masked by the SCHEMA_SCHEMA gather, so
    // loadSchema sees only the lifted resolution Schema, and it round-trips the inline policy's fields
    const lifted = loadSchema(DeltaSet.from(deltas), "schema:Plant");
    expect(lifted.name).toBe("Plant");
    expect([...lifted.props.keys()].sort()).toEqual([...PLANT_WRITABLE].sort());

    // it files under the renamed registration entity, and carries the added writable list
    expect(
      binding!.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === CTX_REGISTRATION &&
          p.target.entity.id === "registration:hyperschema:Plant",
      ),
      "files under registration:hyperschema:Plant",
    ).toBe(true);
    const writable = binding!.claims.pointers.find((p) => p.role === "writable");
    const listed =
      writable?.target.kind === "primitive"
        ? (JSON.parse(writable.target.value as string) as string[])
        : undefined;
    expect(listed).toEqual([...PLANT_WRITABLE]);

    // each legacy delta is negated, the negation points at its replacement, and carries a reason
    for (const oldId of [oldDef.id, oldReg.id]) {
      const negation = deltas.find((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "negates" && p.target.kind === "delta" && p.target.deltaRef.delta === oldId,
        ),
      );
      expect(negation, `old delta ${oldId} is negated`).toBeDefined();
      expect(negation!.claims.pointers.some((p) => p.role === "supersededBy")).toBe(true);
      expect(negation!.claims.pointers.some((p) => p.role === "reason")).toBe(true);
      expect(negation!.claims.author).toBe(operator);
    }

    // grow-only: the legacy forms remain on the record; the data claim passes through untouched
    expect(deltas.some((d) => d.id === oldDef.id)).toBe(true);
    expect(deltas.some((d) => d.id === oldReg.id)).toBe(true);
    expect(deltas.some((d) => d.id === data.id)).toBe(true);
    // both steps applied in order: the rename superseded the def + inline reg, the lift the renamed reg
    expect(report.applied).toEqual([
      { id: "hyperschema-entity-rename", superseded: 2 },
      { id: "inline-schema-to-entity", superseded: 1 },
    ]);
  });

  it("the migrated store resolves every view AND writes again (behavior preserved)", async () => {
    const { deltas } = migrate(oldStore, { seed });
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas });

    // the very read the old store could never answer un-migrated now answers
    const read = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(40);

    // and a surface write is lawful again — the added writable list restored the pre-flip surface
    const write = await gw.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    expect(write.errors).toBeUndefined();
    expect((write.data as { plant: { height: number } }).plant.height).toBe(41);

    // the bound registration reports the renamed entity, and the Schema is a first-class entity now
    expect(gw.registrationVersions()[0]!.entity).toBe("hyperschema:Plant");
    expect(gw.registrationVersions()[0]!.schema.name).toBe("Plant");
    await gw.close();
  });

  it("is idempotent: re-migrating adds nothing new and supersedes nothing new", () => {
    const first = migrate(oldStore, { seed });
    const second = migrate(first.deltas, { seed });
    expect(new Set(second.deltas.map((d) => d.id))).toEqual(new Set(first.deltas.map((d) => d.id)));
    expect(second.report.applied, "a re-run reports no fresh supersessions").toEqual([]);
  });

  it("respects an existing writable list rather than overwriting it", () => {
    const regWithWritable = signClaims(
      legacyInlineRegistrationClaims(OLD_ENTITY, PLANT_POLICY, [FERN], operator, 2, ["height"]),
      seed,
    );
    const { deltas } = migrate([marker, oldDef, regWithWritable, data], { seed });
    const binding = boundBinding(deltas, "hyperschema:Plant");
    const writable = binding!.claims.pointers.find((p) => p.role === "writable");
    const listed =
      writable?.target.kind === "primitive"
        ? (JSON.parse(writable.target.value as string) as string[])
        : undefined;
    expect(listed, "the operator's narrower writable is preserved, not widened").toEqual([
      "height",
    ]);
  });

  it("is not a signing oracle: a foreign-authored legacy delta is never re-signed", () => {
    const strangerSeed = "cd".repeat(32);
    const foreign = signClaims(
      legacyInlineRegistrationClaims(
        OLD_ENTITY,
        PLANT_POLICY,
        [FERN],
        authorForSeed(strangerSeed),
        3,
      ),
      strangerSeed,
    );
    const { deltas } = migrate([...oldStore, foreign], { seed });
    // passed through, but never re-expressed under the operator's key at the new prefix
    expect(deltas.some((d) => d.id === foreign.id)).toBe(true);
    const reExpressedForeign = deltas.some(
      (d) =>
        d.claims.author === authorForSeed(strangerSeed) &&
        entityId(d, "hyperschema") === "hyperschema:Plant",
    );
    expect(reExpressedForeign).toBe(false);
  });
});
