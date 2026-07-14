// The migration policy in practice (the standing rule: every breaking on-wire change ships a
// migration). The 0.2→0.3 step re-signs schema-definition deltas into the hyperschema.* vocabulary
// and NEGATES each old delta with a negation that points `supersededBy` at its replacement and
// records a reason. Grow-only: nothing is removed; the store's history reads as a linked chain of
// supersessions. This suite fabricates a 0.2-era store (a native 0.3 genesis with its schema
// definition downgraded to the old roles), proves it has no surface under 0.3, migrates it, and
// proves the surface is back — with the supersession recorded.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  computeId,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const NEW = "rhizomatic.hyperschema.";
const OLD = "rhizomatic.schema.";
const hasRolePrefix = (d: Delta, prefix: string): boolean =>
  d.claims.pointers.some((p) => p.role.startsWith(prefix));

// The inverse of the migration: move hyperschema.* roles back to schema.*, to forge a 0.2-era delta.
const downgrade = (claims: Claims): Claims => ({
  ...claims,
  pointers: claims.pointers.map((p) =>
    p.role.startsWith(NEW) ? { ...p, role: OLD + p.role.slice(NEW.length) } : p,
  ),
});

// A 0.2-era store: a real 0.3 genesis (operator marker + Plant definition + registration) with the
// definition downgraded to the old vocabulary, plus one data claim.
const seed = GARDENER_SEED;
const operator = authorForSeed(seed);
const genesis = assembleGenesis({
  operatorSeed: seed,
  registrations: [
    { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
  ],
});
const nativeDef = genesis.deltas.find((d) => hasRolePrefix(d, NEW))!;
const oldDef = signClaims(downgrade(nativeDef.claims), seed);
const data = observed(FERN, "height", 40, 5000, seed);
const oldStore: Delta[] = genesis.deltas
  .map((d) => (d.id === nativeDef.id ? oldDef : d))
  .concat(data);

describe("migration: 0.2 → 0.3 schema-definition vocabulary", () => {
  it("a 0.2-era store's schema does not bind under 0.3 (the breakage the migration heals)", async () => {
    let bound = false;
    try {
      const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: seed, deltas: oldStore });
      bound = gw.registrationVersions().some((v) => v.hyperschema.name === "Plant");
      await gw.close();
    } catch {
      bound = false; // 0.3 may refuse to bind a registration whose definition it cannot read
    }
    expect(bound).toBe(false);
  });

  it("re-signs the definition to the new form, negates the old, and the store answers again", async () => {
    const { deltas, report } = migrate(oldStore, { seed });

    // The re-expressed definition is byte-identical to a native 0.3 definition (same content address).
    expect(
      deltas.some((d) => d.id === nativeDef.id),
      "new-form definition present, same id as a native 0.3 def",
    ).toBe(true);

    // The old definition is negated, and the negation points at the replacement with a reason.
    const negation = deltas.find((d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "negates" &&
          p.target.kind === "delta" &&
          p.target.deltaRef.delta === oldDef.id,
      ),
    );
    expect(negation, "the old definition is negated").toBeDefined();
    const forward = negation!.claims.pointers.find((p) => p.role === "supersededBy");
    expect(forward?.target.kind === "delta" ? forward.target.deltaRef.delta : undefined).toBe(
      nativeDef.id,
    );
    expect(
      negation!.claims.pointers.some((p) => p.role === "reason" && p.target.kind === "primitive"),
    ).toBe(true);
    expect(negation!.claims.author, "the operator authors the supersession").toBe(operator);

    // Grow-only: the old definition is still on the record; data + registration pass through intact.
    expect(deltas.some((d) => d.id === oldDef.id)).toBe(true);
    expect(deltas.some((d) => d.id === data.id)).toBe(true);
    expect(report.applied).toEqual([{ id: "hyperschema-roles", superseded: 1 }]);

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
    // only the one legitimately-signed definition was superseded
    expect(report.applied).toEqual([{ id: "hyperschema-roles", superseded: 1 }]);
  });
});
