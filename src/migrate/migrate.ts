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

import {
  authorForSeed,
  parseSchema,
  signClaims,
  verifyDelta,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { CTX_REGISTRATION } from "../gateway/registration.js";

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
      // foreign definition is inert under the new format anyway — its own operator migrates it.
      if (d.claims.author !== operator || !isOldSchemaDef(d)) continue;
      // ...and only if the SIGNATURE proves it. `author` is self-asserted content (fromWire
      // checks the content address, not the signature), so without this gate `loam migrate` on a
      // hostile offer would be a signing oracle: any delta merely CLAIMING the operator's public
      // author, shaped like an old definition, would get its attacker-chosen pointers re-signed
      // under the operator's real key. Re-sign only what the operator provably authored.
      if (verifyDelta(d) !== "verified") continue;
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

// ---- the §21 step: hyperschema-entity rename + immutable-by-default writable --------------------
//
// One wave, two coupled breaking changes (SPEC §21):
//   1. The hyperschema DEFINITION entity moves off the `schema:` prefix — `schema:<Name>` →
//      `hyperschema:<Name>` — so the gather program and the resolution Schema stop sharing one
//      namespace. The new prefix is shape-distinguishable from `schema:<anything>` by construction
//      (it starts with `hyper`), which is what lets THIS step shape-detect a pre-rename store.
//   2. Immutable-by-default (§14 wave B): silence in a registration used to mean "everything
//      writable"; now it means "nothing writable." So every migrated registration gains an EXPLICIT
//      `writable` list naming all its schema's fields — preserving exactly the pre-flip surface
//      (every field still writable) while the store's ON-WIRE posture becomes the new deny-by-default.
//
// Both moves ride one re-sign per affected delta: the definition and registration deltas carry the
// `schema:`-prefixed entity ids, and the registration additionally quotes its resolution Schema
// (the `schema` role) from which the field list is read. Everything else — data claims, grants,
// memberships — is untouched (they carry no `schema:` entity), so the self-labelling set stays small.

const OLD_ENTITY_PREFIX = "schema:";
const OLD_REGISTRATION_PREFIX = "registration:schema:";

// Rewrite one entity id off the old `schema:` namespace. Anchored on the two exact forms a
// registration wave planted — the hyperschema entity (`schema:<Name>`) and the registration entity
// it files under (`registration:schema:<Name>`) — so a domain entity (`plant:fern`) or any id that
// merely CONTAINS "schema:" is left untouched.
const renameEntityId = (id: string): string => {
  if (id.startsWith(OLD_REGISTRATION_PREFIX)) {
    return "registration:hyperschema:" + id.slice(OLD_REGISTRATION_PREFIX.length);
  }
  if (id.startsWith(OLD_ENTITY_PREFIX)) {
    return "hyperschema:" + id.slice(OLD_ENTITY_PREFIX.length);
  }
  return id;
};

// True when a delta carries at least one old-prefix entity id — the shape this step migrates.
const touchesOldPrefix = (d: Delta): boolean =>
  d.claims.pointers.some(
    (p) => p.target.kind === "entity" && renameEntityId(p.target.entity.id) !== p.target.entity.id,
  );

// A registration delta files under an entity in the constitutional registration context.
const isRegistration = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
  );

const hasWritable = (claims: Claims): boolean => claims.pointers.some((p) => p.role === "writable");

// The registration's own resolution Schema, quoted inline in the `schema` role — the source of
// truth for "all this schema's fields." Parsed exactly as the registration reader parses it, so the
// writable list the migration adds names precisely the fields the surface would offer.
const schemaFieldNames = (claims: Claims): string[] | undefined => {
  const p = claims.pointers.find((x) => x.role === "schema" && x.target.kind === "primitive");
  if (p?.target.kind !== "primitive" || typeof p.target.value !== "string") return undefined;
  try {
    return [...parseSchema(JSON.parse(p.target.value)).props.keys()];
  } catch {
    return undefined;
  }
};

// The new form: rename every old-prefix entity id, and — for a registration that names no
// `writable` fields — add one listing all of its schema's fields (immutable-by-default preservation).
const toRenamedForm = (claims: Claims): Claims => {
  const pointers = claims.pointers.map((p) =>
    p.target.kind === "entity"
      ? {
          ...p,
          target: {
            ...p.target,
            entity: { ...p.target.entity, id: renameEntityId(p.target.entity.id) },
          },
        }
      : p,
  );
  if (isRegistration(claims) && !hasWritable(claims)) {
    const fields = schemaFieldNames(claims);
    if (fields !== undefined) {
      pointers.push({
        role: "writable",
        target: { kind: "primitive" as const, value: JSON.stringify(fields) },
      });
    }
  }
  return { timestamp: claims.timestamp, author: claims.author, pointers };
};

const SCHEMA_ENTITY_RENAME: Migration = {
  id: "hyperschema-entity-rename",
  reason:
    "migrated to §21: hyperschema-definition entity schema:<Name> → hyperschema:<Name>, and every " +
    "registration gains an explicit writable list (immutable-by-default, §14 wave B)",
  applies: (deltas) => deltas.some(touchesOldPrefix),
  additions(deltas, seed) {
    const operator = authorForSeed(seed);
    const added: Delta[] = [];
    for (const d of deltas) {
      // Only the operator's own definitions/registrations, and only when the SIGNATURE proves it
      // (author is self-asserted content — re-signing an unverified delta would make the migrator a
      // signing oracle, exactly as guarded in the 0.3 step). A foreign registration is inert anyway.
      if (d.claims.author !== operator || !touchesOldPrefix(d)) continue;
      if (verifyDelta(d) !== "verified") continue;
      const reExpressed = signClaims(toRenamedForm(d.claims), seed);
      const negation = signClaims(
        supersession(operator, d.claims.timestamp, d.id, reExpressed.id, this.reason),
        seed,
      );
      added.push(reExpressed, negation);
    }
    return added;
  },
};

// The chain, in order. Add one entry per breaking on-wire format change, forever composable. A
// store two versions back runs both: hyperschema-roles first (vocabulary), then the entity rename.
export const MIGRATIONS: readonly Migration[] = [HYPERSCHEMA_ROLES, SCHEMA_ENTITY_RENAME];

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
    // Count only what is genuinely NEW: the step re-finds already-superseded defs on every run
    // (the old form is retained, grow-only), and their re-expressions dedup away by content
    // address — so a re-migration must report 0, not re-count the same supersessions.
    const fresh = added.filter((d) => !byId.has(d.id));
    for (const d of added) byId.set(d.id, d);
    const superseded = fresh.filter((d) =>
      d.claims.pointers.some((p) => p.role === "negates"),
    ).length;
    if (fresh.length > 0) applied.push({ id: step.id, superseded });
  }
  return {
    deltas: [...byId.values()],
    report: { applied, before: deltas.length, after: byId.size },
  };
}
