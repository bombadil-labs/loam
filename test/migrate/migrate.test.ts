// The migration policy in practice (the standing rule: every breaking on-wire change ships a
// migration). The chain is composable: a store many versions back is carried forward one step at a
// time — each step re-signs the deltas it changes into the new form and NEGATES the old with a
// negation that points `supersededBy` at its replacement and records a reason. Grow-only: nothing is
// removed; history reads as a linked chain of supersessions. This suite fabricates a genuine 0.2-era
// store (a hyperschema definition on the OLD `rhizomatic.schema.*` vocabulary at a `schema:` entity,
// with an INLINE registration — the shape that predates every later step), proves it has no surface,
// migrates it all the way forward, and proves the surface is back, with every supersession recorded.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  computeId,
  publishHyperSchemaClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { legacyInlineRegistrationClaims } from "./legacy.js";

const NEW = "rhizomatic.hyperschema.";
const OLD = "rhizomatic.schema.";

// The inverse of the 0.3 realignment: move hyperschema.* roles back to schema.*, to forge a 0.2-era
// definition delta from a native one.
const downgrade = (claims: Claims): Claims => ({
  ...claims,
  pointers: claims.pointers.map((p) =>
    p.role.startsWith(NEW) ? { ...p, role: OLD + p.role.slice(NEW.length) } : p,
  ),
});

// A genuine 0.2-era store, forged from the ground up — nothing a later step touched has arrived yet:
//   • the hyperschema definition sits at the OLD `schema:Plant` entity, on the OLD `rhizomatic.schema.*`
//     vocabulary (downgraded from a native 0.3 definition);
//   • the registration is the legacy INLINE form (the Schema quoted as canonical JSON, no `writable`);
//   • plus the operator marker and one data claim so there is a view to (fail to, then) resolve.
const seed = GARDENER_SEED;
const operator = authorForSeed(seed);
const OLD_ENTITY = "schema:Plant";
const marker = signClaims(operatorMarkerClaims(operator), seed);
const oldDef = signClaims(
  downgrade(publishHyperSchemaClaims(PLANT, OLD_ENTITY, operator, 1)),
  seed,
);
const oldReg = signClaims(
  legacyInlineRegistrationClaims(OLD_ENTITY, PLANT_POLICY, [FERN], operator, 2),
  seed,
);
const data = observed(FERN, "height", 40, 5000, seed);
const oldStore: Delta[] = [marker, oldDef, oldReg, data];

describe("migration: the composable chain, from a 0.2-era store", () => {
  it("a 0.2-era store's schema does not bind (the breakage the migration heals)", async () => {
    let bound = false;
    try {
      const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas: oldStore });
      bound = gw.registrationVersions().some((v) => v.hyperschema.name === "Plant");
      await gw.close();
    } catch {
      bound = false; // the definition is unreadable on the old vocabulary; nothing binds
    }
    expect(bound).toBe(false);
  });

  it("runs every step in order, negates each old form, and the store answers again", async () => {
    const { deltas, report } = migrate(oldStore, { seed });

    // The whole chain fires in order: vocabulary realignment, then the entity rename + writability
    // flip, then the inline-Schema lift. Each supersedes exactly the deltas it re-expresses.
    expect(report.applied).toEqual([
      { id: "hyperschema-roles", superseded: 1 },
      { id: "hyperschema-entity-rename", superseded: 2 },
      { id: "inline-schema-to-entity", superseded: 1 },
    ]);

    // The original 0.2-era definition is negated, and its negation points forward with a reason.
    const negation = deltas.find((d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "negates" &&
          p.target.kind === "delta" &&
          p.target.deltaRef.delta === oldDef.id,
      ),
    );
    expect(negation, "the old definition is negated").toBeDefined();
    expect(negation!.claims.pointers.some((p) => p.role === "supersededBy")).toBe(true);
    expect(
      negation!.claims.pointers.some((p) => p.role === "reason" && p.target.kind === "primitive"),
    ).toBe(true);
    expect(negation!.claims.author, "the operator authors the supersession").toBe(operator);

    // Grow-only: every old form is still on the record; data passes through intact.
    expect(deltas.some((d) => d.id === oldDef.id)).toBe(true);
    expect(deltas.some((d) => d.id === oldReg.id)).toBe(true);
    expect(deltas.some((d) => d.id === data.id)).toBe(true);

    // The surface is back: the migrated store answers the very query the old one couldn't.
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas });
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((res.data as { plant: { height: number } }).plant.height).toBe(40);
    await gw.close();
  });

  it("is idempotent: re-migrating adds no new deltas and supersedes nothing new", () => {
    const first = migrate(oldStore, { seed });
    const second = migrate(first.deltas, { seed });
    expect(new Set(second.deltas.map((d) => d.id))).toEqual(new Set(first.deltas.map((d) => d.id)));
    expect(second.report.applied, "a re-run reports no fresh supersessions").toEqual([]);
  });

  it("is not a signing oracle: a delta it cannot verify is never re-signed", () => {
    // A forgery: it CLAIMS the operator's (public) author and is shaped like an old definition,
    // but it is not actually signed by the operator. The migrator must pass it through, never
    // re-sign its attacker-chosen content under the operator's real key.
    const forgedClaims: Claims = {
      timestamp: 9,
      author: operator,
      pointers: [
        {
          role: "rhizomatic.schema.defines",
          target: { kind: "entity", entity: { id: "schema:Evil", context: "definition" } },
        },
        { role: "rhizomatic.schema.name", target: { kind: "primitive", value: "Evil" } },
        { role: "rhizomatic.schema.alg", target: { kind: "primitive", value: 1 } },
        { role: "rhizomatic.schema.term", target: { kind: "primitive", value: "a0" } },
      ],
    };
    const forged: Delta = {
      id: computeId(forgedClaims),
      claims: forgedClaims,
      sig: "0".repeat(128),
    };

    const { deltas, report } = migrate([...oldStore, forged], { seed });

    // passed through untouched, but NEVER re-expressed into the new form under the operator's key
    expect(deltas.some((d) => d.id === forged.id)).toBe(true);
    const reExpressedEvil = deltas.some((d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "rhizomatic.hyperschema.name" &&
          p.target.kind === "primitive" &&
          p.target.value === "Evil",
      ),
    );
    expect(reExpressedEvil, "a forged old-def must not be re-signed").toBe(false);
    // only the operator's own legitimate 0.2-era store migrates; the forgery supersedes nothing
    expect(report.applied).toEqual([
      { id: "hyperschema-roles", superseded: 1 },
      { id: "hyperschema-entity-rename", superseded: 2 },
      { id: "inline-schema-to-entity", superseded: 1 },
    ]);
  });
});
