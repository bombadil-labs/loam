// The §21 wave in practice (SPEC §20 + §21 + §14 wave B). One migration carries two coupled
// breaking changes for stores already on disk: the hyperschema-definition entity moves off the
// `schema:` prefix (`schema:<Name>` → `hyperschema:<Name>`), and — because immutable-by-default
// flips silence from "everything writable" to "nothing writable" — every registration gains an
// explicit `writable` list naming all its fields, preserving the pre-flip surface exactly. The step
// re-signs each affected delta into the new form at its original timestamp and NEGATES the old with
// a `supersededBy` link and a reason — supersede, never rewrite. This suite forges a pre-rename
// store (registrations under `schema:Plant`, no `writable`), proves it reads-but-cannot-write under
// the new posture, migrates it, and proves the surface is whole again — writes and all.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { CTX_REGISTRATION, registrationClaims } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const seed = GARDENER_SEED;
const operator = authorForSeed(seed);
const OLD_ENTITY = "schema:Plant";

// A pre-rename store: a definition + registration filed under `schema:Plant` (the registration
// carrying NO `writable` list, as every pre-flip registration did), plus the operator marker so a
// gateway can boot it, and one data claim so there is a view to resolve.
const oldDef = signClaims(publishHyperSchemaClaims(PLANT, OLD_ENTITY, operator, 1), seed);
const oldReg = signClaims(registrationClaims(OLD_ENTITY, PLANT_POLICY, [FERN], operator, 2), seed);
const marker = signClaims(operatorMarkerClaims(operator), seed);
const data = observed(FERN, "height", 40, 5000, seed);
const oldStore: Delta[] = [marker, oldDef, oldReg, data];

const isNegation = (d: Delta): boolean => d.claims.pointers.some((p) => p.role === "negates");
const entityId = (d: Delta, role: string): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

describe("migration: §21 hyperschema-entity rename + immutable-by-default writable", () => {
  it("the old registration has no writable, and files under the schema: prefix", () => {
    expect(oldReg.claims.pointers.some((p) => p.role === "writable")).toBe(false);
    expect(entityId(oldReg, "hyperschema")).toBe("schema:Plant");
  });

  it("a pre-flip store still READS but can no longer WRITE (the posture the wave introduces)", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas: oldStore });
    // reads are untouched — resolution is a universal function of the data, wherever the entity sits
    const read = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(40);
    // but the registration named no writable fields, and silence now means "you may not"
    const write = await gw.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["height"]) { height } }`,
    );
    expect(write.errors?.join(" ")).toContain("read-only");
    await gw.close();
  });

  it("re-signs both deltas to the new form, negates the old, and adds the writable list", () => {
    const { deltas, report } = migrate(oldStore, { seed });

    // the definition and registration now speak the hyperschema: prefix
    const newReg = deltas.find(
      (d) => !isNegation(d) && entityId(d, "hyperschema") === "hyperschema:Plant",
    );
    expect(newReg, "a registration now points at hyperschema:Plant").toBeDefined();
    const newDef = deltas.find(
      (d) =>
        !isNegation(d) &&
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.id === "hyperschema:Plant",
        ) &&
        d.id !== newReg!.id,
    );
    expect(newDef, "the definition moved to hyperschema:Plant").toBeDefined();

    // the registration files under the renamed registration entity, too
    expect(
      newReg!.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === CTX_REGISTRATION &&
          p.target.entity.id === "registration:hyperschema:Plant",
      ),
      "files under registration:hyperschema:Plant",
    ).toBe(true);

    // an explicit writable list was added, naming exactly all of the schema's fields
    const writable = newReg!.claims.pointers.find((p) => p.role === "writable");
    const listed =
      writable?.target.kind === "primitive"
        ? (JSON.parse(writable.target.value as string) as string[])
        : undefined;
    expect(listed).toEqual([...PLANT_WRITABLE]);

    // each old delta is negated, the negation points at its replacement, and carries a reason
    for (const oldId of [oldDef.id, oldReg.id]) {
      const negation = deltas.find((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "negates" && p.target.kind === "delta" && p.target.deltaRef.delta === oldId,
        ),
      );
      expect(negation, `old delta ${oldId} is negated`).toBeDefined();
      const forward = negation!.claims.pointers.find((p) => p.role === "supersededBy");
      expect(forward?.target.kind === "delta" ? "delta" : forward?.target.kind).toBe("delta");
      expect(negation!.claims.pointers.some((p) => p.role === "reason")).toBe(true);
      expect(negation!.claims.author).toBe(operator);
    }

    // grow-only: the old forms remain on the record; the data claim passes through untouched
    expect(deltas.some((d) => d.id === oldDef.id)).toBe(true);
    expect(deltas.some((d) => d.id === oldReg.id)).toBe(true);
    expect(deltas.some((d) => d.id === data.id)).toBe(true);
    expect(report.applied).toEqual([{ id: "hyperschema-entity-rename", superseded: 2 }]);
  });

  it("the migrated store resolves every view AND writes again (behavior preserved)", async () => {
    const { deltas } = migrate(oldStore, { seed });
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas });

    // the very read the old store answered still answers
    const read = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(40);

    // and a surface write is lawful again — the added writable list restored the pre-flip surface
    const write = await gw.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    expect(write.errors).toBeUndefined();
    expect((write.data as { plant: { height: number } }).plant.height).toBe(41);

    // the bound registration reports the renamed entity
    expect(gw.registrationVersions()[0]!.entity).toBe("hyperschema:Plant");
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
      registrationClaims(OLD_ENTITY, PLANT_POLICY, [FERN], operator, 2, undefined, ["height"]),
      seed,
    );
    const { deltas } = migrate([marker, oldDef, regWithWritable, data], { seed });
    const newReg = deltas.find(
      (d) => !isNegation(d) && entityId(d, "hyperschema") === "hyperschema:Plant",
    );
    const writable = newReg!.claims.pointers.find((p) => p.role === "writable");
    const listed =
      writable?.target.kind === "primitive"
        ? (JSON.parse(writable.target.value as string) as string[])
        : undefined;
    expect(listed, "the operator's narrower writable is preserved, not widened").toEqual([
      "height",
    ]);
  });

  it("is not a signing oracle: a foreign-authored old-prefix delta is never re-signed", () => {
    const strangerSeed = "cd".repeat(32);
    const foreign = signClaims(
      registrationClaims(OLD_ENTITY, PLANT_POLICY, [FERN], authorForSeed(strangerSeed), 3),
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
