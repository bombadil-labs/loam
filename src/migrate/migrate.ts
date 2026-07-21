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
  DeltaSet,
  authorForSeed,
  cborToJson,
  decode,
  loadSchema,
  parseSchema,
  parseTerm,
  signClaims,
  termCanonicalHex,
  termToJson,
  verifyDelta,
  type Claims,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import {
  CTX_REGISTRATION,
  parseClaimTemplates,
  registrationDeltaClaims,
  type ClaimTemplates,
} from "../gateway/registration.js";

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

// Does this delta still SURVIVE, in the operator's own reckoning (ticket T41)?
//
// Every step below RE-SIGNS law into a new form: a new content address, plus a supersession
// negating the OLD id. The operator's own retraction of that law also points at the old id — and
// nothing points at the re-expression. So without this check a migration RESURRECTS anything the
// operator had withdrawn: it comes back live, in the operator's voice, wearing a new id, and a §17
// 410 door quietly becomes a 200 (served ANONYMOUSLY if the lens was ever declared public).
//
// Operator-scoped, because inert-by-default (§8/§12) means a federated stranger's strike retires
// nothing the operator planted — and if a foreign negation could suppress a migration, any peer
// could delete an operator's lens by shipping one before an upgrade. Signature-checked for the same
// reason the re-sign is: `author` is self-asserted content, so an unverified "negation" would be a
// suppression oracle.
//
// TRANSITIVE, because a struck strike REVIVES: stopping at one link would wrongly skip law that was
// withdrawn and then restored — the same class of error, mirrored. Acyclic by content addressing (a
// negation cannot precede its target), and memoized, exactly as `lawfulNegated` does it.
const survivorsOf = (deltas: readonly Delta[], operator: string): ((id: string) => boolean) => {
  const strikesOn = new Map<string, string[]>();
  for (const d of deltas) {
    if (d.claims.author !== operator || verifyDelta(d) !== "verified") continue;
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = p.target.deltaRef.delta;
      const held = strikesOn.get(target);
      if (held === undefined) strikesOn.set(target, [d.id]);
      else held.push(d.id);
    }
  }
  const memo = new Map<string, boolean>();
  const struck = (id: string): boolean => {
    const seen = memo.get(id);
    if (seen !== undefined) return seen;
    memo.set(id, false); // in-progress: treat as surviving (acyclic by construction)
    const verdict = (strikesOn.get(id) ?? []).some((s) => !struck(s));
    memo.set(id, verdict);
    return verdict;
  };
  return (id) => !struck(id);
};

// ---- the 0.2 → 0.3 step: the L5 vocabulary realignment -----------------------------------------

const OLD_PREFIX = "rhizomatic.schema.";
const NEW_PREFIX = "rhizomatic.hyperschema.";

const isOldSchemaDef = (d: Delta): boolean =>
  d.claims.pointers.some((p) => p.role.startsWith(OLD_PREFIX));

// A store that ALREADY speaks `rhizomatic.hyperschema.*` has been through the 0.3 realignment (or was
// born after it). This matters because rhizomatic 0.5.0 REUSED the retired `rhizomatic.schema.*`
// vocabulary for a NEW meaning — the resolution Schema (§21's SCHEMA_SCHEMA form) — so on such a store
// a `rhizomatic.schema.*` delta is a Schema publication, NOT a pre-0.3 hyperschema, and re-running the
// realignment on it would rename its roles to `hyperschema.*` and corrupt it into a broken hyperschema.
// The two are role-identical, so the only safe discriminator is store-level: 0.3 fires ONLY on a store
// that shows no `hyperschema.*` at all — a genuinely pre-realignment store, which by definition holds
// no resolution Schemas (they postdate it). This keeps the step idempotent over a §21-migrated store.
const speaksHyperschemaVocab = (d: Delta): boolean =>
  d.claims.pointers.some((p) => p.role.startsWith(NEW_PREFIX));

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
  applies: (deltas) => deltas.some(isOldSchemaDef) && !deltas.some(speaksHyperschemaVocab),
  additions(deltas, seed) {
    const operator = authorForSeed(seed);
    const survives = survivorsOf(deltas, operator);
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
      // ...and only what the operator has not WITHDRAWN (T41): re-expressing struck law
      // resurrects it under a new id that its retraction never named.
      if (!survives(d.id)) continue;
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

// Only a HYPERSCHEMA reference is renamed — never a resolution-Schema one. Since §21 slice 2, the
// `schema:<Name>` namespace ALSO holds the living resolution Schema and its snapshots, referenced by a
// binding's `schema`/`schemaVersion` roles and published under `rhizomatic.schema.*` roles. Those must
// survive this step untouched: renaming them would drag a Schema entity into the hyperschema namespace
// and unbind it. So the rename is ROLE-SCOPED to the pointers that genuinely name a hyperschema — the
// definition's own `rhizomatic.hyperschema.*` self-pointer and a registration's `hyperschema`/`registers`
// — which is exactly the set that carried a `schema:` prefix before slice 2 existed (so a pre-slice-1
// store migrates identically), and makes the step idempotent when re-run over a slice-2 store.
const isHyperschemaRef = (role: string): boolean =>
  role === "hyperschema" || role === "registers" || role.startsWith("rhizomatic.hyperschema.");

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

// True when a delta carries at least one renamable old-prefix HYPERSCHEMA reference — the shape this
// step migrates. A resolution-Schema publication or a slice-2 binding's schema pointers do not count.
const touchesOldPrefix = (d: Delta): boolean =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      isHyperschemaRef(p.role) &&
      renameEntityId(p.target.entity.id) !== p.target.entity.id,
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
    p.target.kind === "entity" && isHyperschemaRef(p.role)
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
    const survives = survivorsOf(deltas, operator);
    const added: Delta[] = [];
    for (const d of deltas) {
      // Only the operator's own definitions/registrations, and only when the SIGNATURE proves it
      // (author is self-asserted content — re-signing an unverified delta would make the migrator a
      // signing oracle, exactly as guarded in the 0.3 step). A foreign registration is inert anyway.
      if (d.claims.author !== operator || !touchesOldPrefix(d)) continue;
      if (verifyDelta(d) !== "verified") continue;
      // ...and only what the operator has not WITHDRAWN (T41): re-expressing struck law
      // resurrects it under a new id that its retraction never named.
      if (!survives(d.id)) continue;
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

// ---- the §21 slice 2 step: the inline Schema becomes a first-class entity ----------------------
//
// Slice 1 renamed the hyperschema entity and flipped writability; slice 2 finishes §21's lift. Until
// now the resolution Schema rode INLINE — canonical JSON stuffed into the registration's `schema`
// role — so it had no identity apart from the binding that quoted it. This step lifts it out:
//   1. Publishes the Schema as the LIVING `schema:<name>` entity (rhizomatic's SCHEMA_SCHEMA form),
//      and freezes a content-addressed VersionedSchema SNAPSHOT at `schema:<name>@<hash>`.
//   2. Re-signs the registration into a BINDING: the inline `schema` primitive becomes an entity
//      pointer to the living Schema, plus a `schemaVersion` pointer to the frozen snapshot — so §17's
//      per-version freezing now stands on named, pinnable entities instead of bytes buried in a delta.
//
// Shape-detected, like every step: the old shape is a registration whose `schema` role is a PRIMITIVE;
// the new shape's `schema` role is an ENTITY. Distinct by construction (primitive vs entity target),
// so no version stamp is needed. It composes AFTER the slice-1 rename: by the time this runs, a
// surviving legacy registration already points at `hyperschema:<Name>`, and the gate below skips any
// registration still on the old `schema:` prefix (slice 1 negated those — leaving them alone avoids
// minting a binding whose hyperschema no longer resolves). Single-lens: the Schema's name is the
// hyperschema's, read straight off the `hyperschema:<Name>` entity id.

const HYPERSCHEMA_PREFIX = "hyperschema:";

// A registration delta files under an entity in the constitutional registration context (reused by
// the inline detector below, so a public declaration's `schema` primitive is never mistaken for one).
const primitiveValue = (claims: Claims, role: string): string | undefined => {
  const p = claims.pointers.find((x) => x.role === role && x.target.kind === "primitive");
  return p?.target.kind === "primitive" && typeof p.target.value === "string"
    ? p.target.value
    : undefined;
};

// The legacy inline shape this step migrates: a registration whose `hyperschema` pointer is already
// on the `hyperschema:` prefix (slice-1-migrated or born there) and whose `schema` role is an inline
// primitive. Returns the single-lens name (off the hyperschema entity id) and the parsed Schema, or
// undefined for anything that is not this exact shape.
interface InlineRegistration {
  readonly name: string;
  readonly schemaEntity: string;
  readonly schema: Schema;
}
const inlineRegistration = (d: Delta): InlineRegistration | undefined => {
  const claims = d.claims;
  if (!isRegistration(claims)) return undefined;
  const hyper = claims.pointers.find((p) => p.role === "hyperschema" && p.target.kind === "entity");
  if (hyper?.target.kind !== "entity" || !hyper.target.entity.id.startsWith(HYPERSCHEMA_PREFIX)) {
    return undefined;
  }
  const inline = primitiveValue(claims, "schema");
  if (inline === undefined) return undefined; // an entity `schema` role is already the new form
  let schema: Schema;
  try {
    schema = parseSchema(JSON.parse(inline));
  } catch {
    return undefined; // a malformed inline schema is not a shape we can faithfully lift
  }
  return {
    name: hyper.target.entity.id.slice(HYPERSCHEMA_PREFIX.length),
    schemaEntity: hyper.target.entity.id,
    schema,
  };
};

// The binding's inline roots/mutations/writable, reconstructed exactly as the registration reader
// parses them — so the lifted binding names precisely what the legacy one did. A malformed template
// or writable payload is dropped QUIETLY (the schema still binds), the same tolerance replay applies.
const rootsOf = (claims: Claims): string[] => {
  const raw = primitiveValue(claims, "roots");
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((r) => typeof r === "string") ? parsed : [];
  } catch {
    return [];
  }
};
const mutationsOf = (claims: Claims): ClaimTemplates | undefined => {
  const raw = primitiveValue(claims, "mutations");
  if (raw === undefined) return undefined;
  try {
    return parseClaimTemplates(JSON.parse(raw));
  } catch {
    return undefined;
  }
};
const writableOf = (claims: Claims): string[] | undefined => {
  const raw = primitiveValue(claims, "writable");
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((f) => typeof f === "string") ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const INLINE_SCHEMA_TO_ENTITY: Migration = {
  id: "inline-schema-to-entity",
  reason:
    "migrated to §21 slice 2: the inline resolution Schema is lifted to a first-class schema:<Name> " +
    "entity with a frozen VersionedSchema snapshot, and the registration becomes a binding referencing them",
  applies: (deltas) => deltas.some((d) => inlineRegistration(d) !== undefined),
  additions(deltas, seed) {
    const operator = authorForSeed(seed);
    const survives = survivorsOf(deltas, operator);
    const added: Delta[] = [];
    for (const d of deltas) {
      // Operator-authored and signature-proven only (author is self-asserted content — re-signing an
      // unverified delta would make the migrator a signing oracle, the guard every step shares).
      if (d.claims.author !== operator || verifyDelta(d) !== "verified") continue;
      // ...and only what the operator has not WITHDRAWN (T41): re-expressing struck law
      // resurrects it under a new id that its retraction never named.
      if (!survives(d.id)) continue;
      const inline = inlineRegistration(d);
      if (inline === undefined) continue;
      // Reuse the LIVE planting path so the lifted entities are byte-identical to a fresh publish:
      // living Schema, frozen snapshot, and the binding that names both — all re-signed at the
      // registration's OWN timestamp (a faithful re-expression; deterministic, so re-migrating dedups).
      const { living, snapshot, binding } = registrationDeltaClaims(
        inline.schemaEntity,
        inline.name,
        inline.schema,
        rootsOf(d.claims),
        operator,
        () => d.claims.timestamp,
        mutationsOf(d.claims),
        writableOf(d.claims),
      );
      const bindingDelta = signClaims(binding, seed);
      const negation = signClaims(
        supersession(operator, d.claims.timestamp, d.id, bindingDelta.id, this.reason),
        seed,
      );
      added.push(signClaims(living, seed), signClaims(snapshot, seed), bindingDelta, negation);
    }
    return added;
  },
};

// ---- the 0.8 step: an `expand` names the child's reading (rhizomatic issue #23) ----------------
//
// rhizomatic 0.8 gave `expand` a second half: besides `schema` (how the child GATHERS) it now names
// `reading` (the resolution Schema the child RESOLVES through). A legacy body — an `expand` with no
// `reading` — no longer falls back to the parent's Schema; it REFUSES to resolve, loudly. So every
// hyperschema DEFINITION whose gather body expands must be re-signed with `reading` filled in.
//
// The choice is mechanical, and provably so: a pre-0.8 store is single-lens (multi-lens coexistence
// postdates 0.8), so each child hyperschema was bound to exactly ONE resolution Schema. We recover
// that pairing from the store's own bindings — a binding names its `hyperschema` entity and its living
// `schema:<name>` entity — and fill each `expand`'s `reading` with the reading its child hyperschema
// was serving. If a child has zero or (impossibly, pre-0.8) several candidate readings, that `expand`
// is left untouched: better an honest refusal at resolve than a guessed reading.
//
// Shape-detected like every step: the old shape is a definition body carrying a `reading`-less
// `expand`; once filled, the same body is not detected again (idempotent), and the negation drops the
// readingless definition from `loadHyperSchema`'s bucket so the reading-bearing one is what binds.

const HS_TERM = `${NEW_PREFIX}term`; // rhizomatic.hyperschema.term — the body blob role
const SCHEMA_LIVING_PREFIX = "schema:";
const HYPERSCHEMA_ENTITY_PREFIX = "hyperschema:";

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

// A definition delta's body, decoded to JSON (termToJson form), or undefined if this is not a
// definition delta (no `rhizomatic.hyperschema.term` blob) or the blob will not decode.
const definitionBody = (claims: Claims): unknown => {
  const hex = primitiveValue(claims, HS_TERM);
  if (hex === undefined) return undefined;
  try {
    return termToJson(parseTerm(cborToJson(decode(hexToBytes(hex)))));
  } catch {
    return undefined;
  }
};

// Does this body-JSON carry an `expand` with no `reading`? (The shape the 0.8 step migrates.)
const hasReadinglessExpand = (json: unknown): boolean => {
  if (Array.isArray(json)) return json.some(hasReadinglessExpand);
  if (json !== null && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (o.op === "expand" && o.reading === undefined) return true;
    return Object.values(o).some(hasReadinglessExpand);
  }
  return false;
};

// The child-hyperschema-name → reading-name map, read from the store's bindings.
//
// THE TRUST RULE, and why it is strict: this map decides the `reading` string the operator will
// RE-SIGN UNDER THEIR OWN KEY. The author/verify gate in `additions` protects only WHICH delta is
// re-expressed — it says nothing about the CONTENT injected into it — so a map built from raw deltas
// would let any unsigned, unlawful, or foreign delta choose that string (or, by adding a second
// candidate, silently veto the migration). Every downstream reader of bindings is stricter than that:
// `lawfulSnapshot` filters to the operator's own law and `survivingCandidates` drops negated ones. A
// migrator must be no more trusting than the readers it migrates FOR, so this admits a binding only
// when all four hold: the operator authored it, the SIGNATURE proves it, it is a genuine binding
// (filed in the constitutional registration context — not merely two pointers wearing those role
// names), and it has not been negated. The reading NAME is then read off the published Schema itself
// rather than off the entity id, because `lookupReading` resolves against `Schema.name`; the two agree
// for everything Loam mints, and reading the Schema closes the gap for anything hand-authored.
const readingMap = (
  deltas: readonly Delta[],
  operator: string,
  // The SAME survival rule the re-sign gate uses (ticket T41). This function used to derive its own
  // one-link negated set, which is a WEAKER rule than `survivorsOf` — and the split was a silent
  // skip, not a style wart: retract a binding, then retract the retraction (all operator-authored,
  // all verified), and the binding is live by the real rule while the one-link set still calls it
  // struck. The child then has zero candidate readings, `fillReadings` leaves the expand readingless,
  // `filledTermHex` returns undefined, and the parent definition is quietly NOT migrated — left
  // permanently unresolvable, with the step reporting nothing. One survival rule per file.
  survives: (id: string) => boolean,
): Map<string, Set<string>> => {
  const lawful = deltas.filter(
    (d) => d.claims.author === operator && verifyDelta(d) === "verified",
  );
  const dset = DeltaSet.from(lawful); // Schemas resolve against the operator's law alone
  const map = new Map<string, Set<string>>();
  for (const d of lawful) {
    if (!survives(d.id) || !isRegistration(d.claims)) continue;
    const hyper = d.claims.pointers.find(
      (p) => p.role === "hyperschema" && p.target.kind === "entity",
    );
    const schema = d.claims.pointers.find((p) => p.role === "schema" && p.target.kind === "entity");
    if (hyper?.target.kind !== "entity" || schema?.target.kind !== "entity") continue;
    const hyperId = hyper.target.entity.id;
    const schemaId = schema.target.entity.id;
    if (
      !hyperId.startsWith(HYPERSCHEMA_ENTITY_PREFIX) ||
      !schemaId.startsWith(SCHEMA_LIVING_PREFIX)
    ) {
      continue;
    }
    let readingName: string | undefined;
    try {
      readingName = loadSchema(dset, schemaId).name; // the name `lookupReading` will resolve against
    } catch {
      continue; // no loadable Schema at that entity: it names no reading we can vouch for
    }
    if (readingName === undefined) continue; // an anonymous Schema can never be a reading
    const hyperName = hyperId.slice(HYPERSCHEMA_ENTITY_PREFIX.length);
    (map.get(hyperName) ?? map.set(hyperName, new Set()).get(hyperName)!).add(readingName);
  }
  return map;
};

// Fill each `expand`'s `reading` from the reading map (keyed by the expand's `schema` = child
// hyperschema name). An `expand` whose child has no single candidate reading is left as-is.
const fillReadings = (json: unknown, readings: Map<string, Set<string>>): unknown => {
  if (Array.isArray(json)) return json.map((v) => fillReadings(v, readings));
  if (json !== null && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const filled: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) filled[k] = fillReadings(v, readings);
    if (o.op === "expand" && o.reading === undefined && typeof o.schema === "string") {
      const candidates = readings.get(o.schema);
      if (candidates !== undefined && candidates.size === 1) {
        filled.reading = [...candidates][0];
      }
    }
    return filled;
  }
  return json;
};

// A definition delta whose body carries a readingless `expand` that we can fill COMPLETELY — every
// such `expand` in it, not merely some. Returns the new ROLE_TERM hex, or undefined.
//
// Completeness is the whole safety property. Filling SOME expands still leaves the body refusing to
// resolve, but it changes the bytes — so a byte-inequality test would re-sign a still-broken body,
// emit a supersession that RETIRES the working original, and report the step as applied. The store
// would then hold a definition that throws on every read, with the only surviving diagnosis being a
// type that quietly failed to bind. A migration must heal a definition or leave it entirely alone;
// there is no useful middle. So: fill, then demand that nothing readingless remains.
const filledTermHex = (claims: Claims, readings: Map<string, Set<string>>): string | undefined => {
  const body = definitionBody(claims);
  if (body === undefined || !hasReadinglessExpand(body)) return undefined;
  const filled = fillReadings(body, readings);
  if (hasReadinglessExpand(filled)) return undefined; // a partial fill heals nothing — leave it
  try {
    const hex = termCanonicalHex(parseTerm(filled));
    return hex === primitiveValue(claims, HS_TERM) ? undefined : hex; // nothing actually filled
  } catch {
    return undefined;
  }
};

const EXPAND_READING: Migration = {
  id: "expand-reading",
  reason:
    "migrated to rhizomatic 0.8 (issue #23): each `expand` names the child's `reading` — the single " +
    "resolution Schema its child hyperschema was bound to — so a legacy readingless body resolves again",
  // A cheap, operator-independent trigger: is there any definition body still carrying a readingless
  // `expand`? The authoritative work — whose bindings may name a reading, and whether the fill is
  // complete — happens in `additions`, which knows the operator. A trigger that fires with nothing
  // fillable is harmless: `additions` returns nothing and the driver reports nothing.
  applies(deltas) {
    return deltas.some((d) => {
      const body = definitionBody(d.claims);
      return body !== undefined && hasReadinglessExpand(body);
    });
  },
  additions(deltas, seed) {
    const operator = authorForSeed(seed);
    const survives = survivorsOf(deltas, operator);
    const readings = readingMap(deltas, operator, survives);
    const added: Delta[] = [];
    for (const d of deltas) {
      // Operator-authored and signature-proven only — re-signing an unverified delta would make the
      // migrator a signing oracle (the guard every step shares).
      if (d.claims.author !== operator || verifyDelta(d) !== "verified") continue;
      // ...and only what the operator has not WITHDRAWN (T41): re-expressing struck law
      // resurrects it under a new id that its retraction never named.
      if (!survives(d.id)) continue;
      const hex = filledTermHex(d.claims, readings);
      if (hex === undefined) continue;
      const reExpressed = signClaims(
        {
          timestamp: d.claims.timestamp,
          author: d.claims.author,
          pointers: d.claims.pointers.map((p) =>
            p.role === HS_TERM ? { ...p, target: { kind: "primitive" as const, value: hex } } : p,
          ),
        },
        seed,
      );
      const negation = signClaims(
        supersession(operator, d.claims.timestamp, d.id, reExpressed.id, this.reason),
        seed,
      );
      added.push(reExpressed, negation);
    }
    return added;
  },
};

// The chain, in order. Add one entry per breaking on-wire format change, forever composable. A store
// several versions back runs each in turn: hyperschema-roles (vocabulary), then the entity rename +
// writability flip, then the inline-Schema lift, then the expand-reading fill.
export const MIGRATIONS: readonly Migration[] = [
  HYPERSCHEMA_ROLES,
  SCHEMA_ENTITY_RENAME,
  INLINE_SCHEMA_TO_ENTITY,
  EXPAND_READING,
];

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
