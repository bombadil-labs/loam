// Migration: old deltas in, new correctly-formed deltas out (the standing policy — every breaking
// change to the on-wire format ships a migration here). A migration never rewrites a signed delta
// in place (impossible — the id is the content, the signature is the author's). Instead, for each
// delta a step changes, it does two grow-only things:
//
//   1. RE-SIGNS the delta into the new form, authored by the operator running the migration, at the
//      original timestamp (a faithful re-expression, not a new fact).
//   2. NEGATES the old delta with a negation that also points `supersededBy` at the new delta and
//      carries a `reason` — so the store's history reads "this record was superseded by that one,
//      because ...". Nothing is destroyed; every retirement is explained and linked.
//
// Version detection is by SHAPE (naive, on purpose): a step `applies` when the shape it migrates is
// present. Steps run in declared order, so a store many versions back is carried forward one step
// at a time. Output is deduplicated by content address, so re-migrating is a no-op.

import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";

export interface Migration {
  /** Stable id for the step (also the negation's provenance handle). */
  readonly id: string;
  /** Human-readable reason, recorded on every negation this step emits. */
  readonly reason: string;
  /** True when this store carries the old shape this step migrates. */
  applies(deltas: readonly Delta[]): boolean;
  /** The deltas to ADD (new-form re-signs + supersession negations). Never removes. */
  additions(deltas: readonly Delta[], seed: string): Delta[];
}

export interface MigrationReport {
  readonly applied: ReadonlyArray<{ readonly id: string; readonly superseded: number }>;
  readonly before: number;
  readonly after: number;
}

// ---- the 0.2 → 0.3 step: the L5 vocabulary realignment -----------------------------------------

const OLD_PREFIX = "rhizomatic.schema.";
const NEW_PREFIX = "rhizomatic.hyperschema.";

const isOldSchemaDef = (d: Delta): boolean =>
  d.claims.pointers.some((p) => p.role.startsWith(OLD_PREFIX));

// The new form: the same claim, its schema-definition roles moved to the hyperschema vocabulary.
// Everything else (targets, timestamp, author) is preserved — a re-expression, not a new fact.
const toNewForm = (claims: Claims): Claims => ({
  timestamp: claims.timestamp,
  author: claims.author,
  pointers: claims.pointers.map((p) =>
    p.role.startsWith(OLD_PREFIX)
      ? { ...p, role: NEW_PREFIX + p.role.slice(OLD_PREFIX.length) }
      : p,
  ),
});

// The supersession negation: negates the old delta, points at its replacement, states why. The
// timestamp is the old delta's own (deterministic, so re-migrating yields the identical negation).
const supersession = (
  author: string,
  timestamp: number,
  oldId: string,
  newId: string,
  reason: string,
): Claims => ({
  timestamp,
  author,
  pointers: [
    { role: "negates", target: { kind: "delta", deltaRef: { delta: oldId } } },
    { role: "supersededBy", target: { kind: "delta", deltaRef: { delta: newId } } },
    { role: "reason", target: { kind: "primitive", value: reason } },
  ],
});

const HYPERSCHEMA_ROLES: Migration = {
  id: "hyperschema-roles",
  reason:
    "migrated to rhizomatic 0.3: schema-definition roles rhizomatic.schema.* → rhizomatic.hyperschema.*",
  applies: (deltas) => deltas.some(isOldSchemaDef),
  additions(deltas, seed) {
    const operator = authorForSeed(seed);
    const added: Delta[] = [];
    for (const d of deltas) {
      // Only the operator's own definitions: we can re-sign only what our seed authored, and a
      // foreign definition is inert under 0.3 anyway — its own operator migrates its own store.
      if (d.claims.author !== operator || !isOldSchemaDef(d)) continue;
      const reExpressed = signClaims(toNewForm(d.claims), seed);
      const negation = signClaims(
        supersession(operator, d.claims.timestamp, d.id, reExpressed.id, this.reason),
        seed,
      );
      added.push(reExpressed, negation);
    }
    return added;
  },
};

// The chain, in order. Add one entry per breaking on-wire format change, forever composable.
export const MIGRATIONS: readonly Migration[] = [HYPERSCHEMA_ROLES];

// ---- the driver --------------------------------------------------------------------------------

// Stream old deltas in, correctly-formed deltas out. Runs every applicable step in order (a store
// several versions back is carried forward step by step), appending each step's re-signs and
// supersession negations, then deduplicates by content address so the result is a clean set and
// re-migrating is a no-op.
export function migrate(
  deltas: readonly Delta[],
  opts: { readonly seed: string },
): { deltas: Delta[]; report: MigrationReport } {
  const byId = new Map<string, Delta>(deltas.map((d) => [d.id, d]));
  const applied: Array<{ id: string; superseded: number }> = [];
  for (const step of MIGRATIONS) {
    if (!step.applies([...byId.values()])) continue;
    const added = step.additions([...byId.values()], opts.seed);
    for (const d of added) byId.set(d.id, d);
    // one supersession negation per delta the step retired
    const superseded = added.filter((d) =>
      d.claims.pointers.some((p) => p.role === "negates"),
    ).length;
    applied.push({ id: step.id, superseded });
  }
  return {
    deltas: [...byId.values()],
    report: { applied, before: deltas.length, after: byId.size },
  };
}
