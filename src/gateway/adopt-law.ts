// Promote-LAW (SPEC §24.4 × §27.8, ticket T33) — the graduation of a stranger's law into the
// operator's OWN trust domain. Install is containment; blessing is adoption. A loaded module runs
// whole inside its container and needs no blessing at all; this module is the separate, deliberate
// act of taking ONE of its exports into the root, so root reads resolve through it.
//
// The blessing unit is one MANIFEST ROW — `(module version, alias)` — resolved through the manifest
// to its kind's most stable identifier, classified from the EXPORT'S OWN BYTES (a stranger's `kind`
// label is display copy: a manifest that calls its pen-holding renderer a schema changes nothing),
// then published by that kind's ORDINARY door under operator authorship. No new trust machinery:
// the blessing IS the publish the operator could already perform, plus provenance.
//
// TIMESTAMPS ARE INHERITED FROM THE SOURCE, and that is load-bearing (H4): a delta id hashes
// {author, pointers, timestamp}, so re-speaking the same content at the same instant re-mints the
// SAME id. That makes re-blessing idempotent by identity, and it makes an ERASED blessing stay
// dead — a re-adoption re-mints the very id the tombstone refuses. A fresh timestamp would mint an
// id no tombstone has heard of, silently bypassing §11.
//
// One consequence follows from the inheritance and must not be mistaken for a destructive variant:
// a blessing cannot outrank an incumbent by RECENCY, because its timestamp is the source's and the
// incumbent's is usually newer. So `supersede` outranks by carrying a negation of the incumbent on
// the blessing itself. The incumbent's bytes stay on the ground, and striking the blessing revives
// it as the winner — the negation stops counting the moment its carrier is struck (§21's living
// semantics through the negation algebra), which is exactly the reversibility §27's spec demands.
//
// THAT MAKES `negates` RIDE A SUBSTANTIVE DELTA — the first in this codebase — and it has two
// consequences a reader must not discover the hard way. Both were weighed against the alternative
// (a separate negation delta) and the alternative LOSES: with the strike on its own delta, undoing
// one blessing takes two §14 acts in the right order, and an operator who performs only the first
// leaves their OWN law retired while believing they restored it. One gesture, one strike, is worth
// more than these two, which are bounded, named, and railed:
//
//  1. NARROWING LEAK. `withNegationClosure` pulls "the negations of what I admit" into every
//     narrowed set — safe while a negation was content-free, which it no longer is. A membership
//     Term or an `offeredLens` that admits the INCUMBENT binding now also ships the BLESSED one, a
//     full registration the Term deliberately excluded. Law travels where its strike travels. The
//     escape, if this ever outranks the reversibility: filter law by role at the offer, or move the
//     negation to its own delta and pay the two-act undo.
//  2. THE §17 DOOR READS IT AS WITHDRAWAL. `survivingCandidates` files a struck registration into
//     the WITHDRAWN list, which is the sole source of §17's 410 — so `{supersede: true}` turns the
//     operator's own previously-live registration hash from 200 into "410 Gone — withdrawn by the
//     operator" with no §14 act by the operator at all. It IS retired (the door is not lying), but
//     the WORD is wrong, and the transition is railed in adopt-law.test.ts so it stays a known
//     consequence rather than a surprise. Bounded: the 410 distinction is full-door only, and
//     `declarePublic` pins by deltaId, so the anonymous door fails closed either way.

import {
  DeltaSet,
  contentAddress,
  loadHyperSchema,
  loadSchema,
  signClaims,
  termCanonicalHex,
  type Claims,
  type Delta,
  type HyperSchema,
  type Reactor,
  type Schema,
} from "@bombadil/rhizomatic";
import { ADOPTION_ENTITY, CTX_ADOPTION, isAdoption } from "./adopt.js";
import { bytesRefOf } from "./bytes.js";
import { CTX_CONTAINER } from "./container.js";
import type { ModuleVersion } from "./container-identity.js";
import type { Gateway } from "./gateway.js";
import { publishRegistrationImpl } from "./lifecycle.js";
import {
  CTX_REGISTRATION,
  lawfulNegated,
  lawfulSnapshot,
  lensOf,
  parseClaimTemplates,
  parseResolvers,
  versionedSchemaHash,
  type ClaimTemplates,
  type LensName,
  type ResolverSpecs,
  type ResolverSpec,
} from "./registration.js";
import { CTX_RENDERER, publishRendererImpl } from "./renderers.js";

export const CTX_MANIFEST = "loam.manifest";
export const MANIFEST_ENTITY = "loam:manifest";

const NUL = "\u0000";
const ROLE_HS_DEFINES = "rhizomatic.hyperschema.defines";
const ROLE_SCHEMA_DEFINES = "rhizomatic.schema.defines";

// --- the manifest mint (SPEC §27.8: the row shape; T33 owns it) ---------------------------------

/**
 * One export row of a module's manifest: the consumer-facing ALIAS, and the export named by its
 * kind's most stable identifier — an ENTITY for schema law and for exported plain entities, a
 * CONTENT ADDRESS for a renderer binding or a byte-blob. `kind` is DISPLAY COPY: every guard in
 * this module classifies from the bytes at the target, never from this label.
 */
export interface ManifestExport {
  readonly alias: string;
  readonly targetEntity?: string;
  readonly targetAddress?: string;
  readonly kind?: string;
}

export function manifestExportClaims(
  row: ManifestExport,
  author: string,
  timestamp: number,
): Claims {
  const byEntity = row.targetEntity !== undefined;
  const byAddress = row.targetAddress !== undefined;
  if (byEntity === byAddress) {
    throw new Error(
      "a manifest row names its export by targetEntity OR targetAddress, never both and never " +
        "neither — the kind's most stable identifier is the one the consumer can verify (§27.8)",
    );
  }
  // Each shape refuses ALONE (a conjunction here is satisfied by neither, and the mutation gate
  // found exactly that mutant surviving): an empty alias names nothing a consumer could ask for,
  // and NUL is the gateway's own separator.
  if (row.alias === "" || row.alias.includes(NUL)) {
    throw new Error("a manifest alias must be a non-empty name without NUL");
  }
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "exports",
        target: { kind: "entity", entity: { id: MANIFEST_ENTITY, context: CTX_MANIFEST } },
      },
      { role: "alias", target: { kind: "primitive", value: row.alias } },
      ...(row.targetEntity === undefined
        ? []
        : [
            {
              role: "target-entity" as const,
              target: {
                kind: "entity" as const,
                entity: { id: row.targetEntity, context: CTX_MANIFEST },
              },
            },
          ]),
      ...(row.targetAddress === undefined
        ? []
        : [
            {
              role: "target-address" as const,
              target: { kind: "primitive" as const, value: row.targetAddress },
            },
          ]),
      ...(row.kind === undefined
        ? []
        : [{ role: "kind" as const, target: { kind: "primitive" as const, value: row.kind } }]),
    ],
  };
}

/** A manifest row as read back out of a module's members. */
export interface ManifestRow {
  readonly alias: string;
  /** The entity id or the content address the row names — its identity for re-point arithmetic. */
  readonly target: string;
  readonly by: "entity" | "address";
  /** The stranger's own label. Reported, never trusted. */
  readonly declaredKind?: string;
  readonly deltaId: string;
  readonly timestamp: number;
  readonly author: string;
}

const primitiveOf = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

const entityOf = (claims: Claims, role: string): string | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

// A manifest row declares the manifest entity, exactly as an adoption record declares its own
// (isAdoption's shape). The alias and target roles hang beside that key, role-qualified.
const isManifestRow = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === MANIFEST_ENTITY &&
      p.target.entity.context === CTX_MANIFEST,
  );

const byAge = (a: { timestamp: number; deltaId: string }, b: typeof a): number =>
  a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0);

/**
 * The manifest a module version publishes, LATEST PER ALIAS (by (timestamp, id) — the tie-break
 * every latest-wins reader here uses). A bumped module re-states an alias to re-point it, so the
 * newest row is what the alias means now; the older one survives on the ground, which is what
 * makes the re-point a three-way DIFF rather than a guess.
 *
 * Malformed rows are LOUD, not skipped: a stranger's manifest gets no silent drops, because a
 * skip is how a crafted manifest hides a row.
 */
export function readManifest(members: readonly Delta[]): ManifestRow[] {
  const survives = survivalOver(members);
  const latest = new Map<string, ManifestRow>();
  for (const d of members) {
    if (!isManifestRow(d.claims) || !survives(d.id)) continue;
    const alias = primitiveOf(d.claims, "alias");
    const targetEntity = entityOf(d.claims, "target-entity");
    const address = primitiveOf(d.claims, "target-address");
    if (typeof alias !== "string" || alias === "") {
      throw new Error(`manifest row ${d.id} names no alias — a row nobody can ask for hides law`);
    }
    if ((targetEntity === undefined) === (address === undefined)) {
      throw new Error(
        `manifest row "${alias}" (${d.id}) names its export neither once nor unambiguously — ` +
          `exactly one of target-entity / target-address (§27.8)`,
      );
    }
    const declared = primitiveOf(d.claims, "kind");
    const row: ManifestRow = {
      alias,
      target: targetEntity ?? String(address),
      by: targetEntity === undefined ? "address" : "entity",
      ...(typeof declared === "string" ? { declaredKind: declared } : {}),
      deltaId: d.id,
      timestamp: d.claims.timestamp,
      author: d.claims.author,
    };
    const held = latest.get(alias);
    if (held === undefined || byAge(held, row) < 0) latest.set(alias, row);
  }
  return [...latest.values()].sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

// --- survival inside a version's members --------------------------------------------------------

// The negation algebra over a version's MEMBERS, scoped by AUTHORSHIP — the rule every sibling
// constitutional reader keeps (`lawfulNegated`, migrate's survivor walk), stated here for a
// member set rather than a store:
//
//   **A strike binds a member only when the member's OWN AUTHOR signed it.**
//
// A shipper takes back their own word; nobody takes it back for them. The membership is NOT one
// trust domain and must not be read as one: `Gateway.freeze` is `freezeMembers(withNegationClosure(
// …))`, and that closure walks `negationsOf` with no author filter precisely so foreign strikes
// travel with what they strike — so "in the members" means "somebody, anybody, struck this", and
// multi-author freeze terms are a supported shape. Unscoped, the algebra had two failures at once:
// a hostile co-tenant's strike on a shipper's law would REFUSE a lawful adoption, and a foreign
// negation-of-the-negation would REVIVE law the shipper genuinely withdrew (the second defeats the
// survival refusal outright — H1's shape at the blessing door).
//
// Recursion is unchanged: a strike retires its target only while it survives itself, so the
// shipper negating their own retraction revives their law. The scope applies at every rung — a
// foreign strike on a strike counts for nothing.
function survivalOver(members: readonly Delta[]): (id: string) => boolean {
  const byId = new Map(members.map((d) => [d.id, d]));
  const strikes = new Map<string, string[]>();
  for (const d of members) {
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = p.target.deltaRef.delta;
      const list = strikes.get(target) ?? [];
      list.push(d.id);
      strikes.set(target, list);
    }
  }
  const memo = new Map<string, boolean>();
  const negated = (id: string): boolean => {
    const seen = memo.get(id);
    if (seen !== undefined) return seen;
    const target = byId.get(id);
    if (target === undefined) return false; // not a member: nothing in this set speaks about it
    memo.set(id, false); // in-progress: surviving (content addressing keeps the chain acyclic)
    const verdict = (strikes.get(id) ?? []).some(
      (n) => byId.get(n)?.claims.author === target.claims.author && !negated(n),
    );
    memo.set(id, verdict);
    return verdict;
  };
  return (id) => !negated(id);
}

// --- the content addresses the guards and `lawFrom` do arithmetic on -----------------------------

// Structural identity of SCHEMA law: the gather program and the resolution program, nothing else.
// Deliberately EXCLUDES the lens name and the roots — a lens name is what an `as` blessing changes
// and roots are deployment discipline (§21), so a row blessed under another name is still the same
// law, and re-running `blessAll` after resolving a collision with `as` witnesses instead of
// colliding again. `versionedSchemaHash` is the same content address §21 names a snapshot by.
const schemaLawAddress = (hyperschema: HyperSchema, schema: Schema): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.law.schema",
        hyperschema.name,
        String(hyperschema.alg ?? 1),
        termCanonicalHex(hyperschema.body),
        versionedSchemaHash(schema),
      ].join(NUL),
    ),
  );

// Structural identity of RENDERER law: everything the binding serves with, the pen included — a
// pen swap is a different renderer, so it can never read as already-blessed.
const rendererLawAddress = (b: {
  route: string;
  schemaName: string;
  consumes: readonly string[];
  bundle: string;
  writable?: readonly string[];
  pen?: string;
}): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.law.renderer",
        b.route,
        b.schemaName,
        JSON.stringify([...b.consumes]),
        b.bundle,
        JSON.stringify([...(b.writable ?? [])]),
        b.pen ?? "",
      ].join(NUL),
    ),
  );

// --- classification: from the BYTES at the target, never the manifest's label -------------------

interface SchemaExport {
  readonly kind: "schema";
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  readonly lensName: LensName;
  readonly schemaEntity: string;
  readonly mutations?: ClaimTemplates;
  readonly writable?: readonly string[];
  readonly resolvers?: ResolverSpecs;
  /** definition, living Schema, frozen snapshot, binding — consumed by the publish in that order. */
  readonly timestamps: readonly number[];
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly address: string;
  /** Every source delta this export stands on — what a survival verdict ranges over. */
  readonly lineage: readonly string[];
}

interface RendererExport {
  readonly kind: "renderer";
  readonly route: string;
  /** The LENS the renderer reads (§21.7 keys renderers on the lens, never the program — H6). */
  readonly schemaName: LensName;
  readonly consumes: readonly string[];
  readonly bundle: string;
  readonly writable?: readonly string[];
  readonly pen?: string;
  readonly timestamp: number;
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly address: string;
  readonly lineage: readonly string[];
}

interface FactExport {
  readonly kind: "fact";
  readonly what: string;
}

type Export = SchemaExport | RendererExport | FactExport;

const jsonList = (claims: Claims, role: string): string[] | undefined => {
  const raw = primitiveOf(claims, role);
  if (typeof raw !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
};

// Do any of these members carry the raw bytes at this content address? `bytesRefOf` is the same hash
// rhizomatic's bytes-target identity uses, so a manifest citation and a claim's payload agree.
const carriesBytes = (members: readonly Delta[], ref: string): boolean =>
  members.some((d) =>
    d.claims.pointers.some((p) => p.target.kind === "bytes" && bytesRefOf(p.target.value) === ref),
  );

const isRendererBinding = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.context === CTX_RENDERER &&
      p.target.entity.id.startsWith("renderer:"),
  );

export const isRegistrationBinding = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
  );

// Everything a row's classification needs, computed once per version.
//
// TWO READINGS, one classifier. A BLESSING reads for SURVIVAL: law its author took back is refused,
// and `dset` holds only what survives. `lawFrom` reads for EXPOSURE, which is a different question
// and must not collapse into the first: the root may still be SERVING a row the upstream later
// withdrew, and that is the one moment the query must answer "yes — and the author withdrew it".
// So the exposure reading classifies over PRESENCE (the members with their counted strikes removed)
// and reports the withdrawal as a flag. Sharing one `classify` is deliberate: two classifiers would
// drift, and the drift would land exactly on the rows that matter.
interface Source {
  readonly version: ModuleVersion;
  readonly members: readonly Delta[];
  /** The verdict `classify` gates on — real survival for a blessing, always-true for exposure. */
  readonly survives: (id: string) => boolean;
  /** The real algebra, whichever reading this is: exposure still needs the withdrawal verdict. */
  readonly livesAtSource: (id: string) => boolean;
  /** What `loadHyperSchema` / `loadSchema` gather over — survivors, or presence for exposure. */
  readonly dset: DeltaSet;
  /** The declared container the members came from, joinable to the T32 table. */
  readonly container?: string;
  readonly from: string;
}

function classify(src: Source, row: ManifestRow): Export {
  const struck = (what: string, id: string): never => {
    throw new Error(
      `adoption refused: "${row.alias}" names ${what} its own author RETRACTED inside the ` +
        `module (${id} is struck in this version's members) — a blessing must not re-speak law ` +
        `its author took back. Survival, not presence, at the source (§24.4).`,
    );
  };

  if (row.by === "address") {
    const target = src.members.find((d) => d.id === row.target);
    if (target === undefined) {
      // §27.8 names a BYTE-BLOB by its content address, and that is not a delta id — so before an
      // address is called dangling, ask whether any member actually carries those bytes. A blob is a
      // FACT: it binds nothing, it needs no blessing, and it must not be mistaken for the crafted
      // dangling row the no-silent-skips rule exists to catch.
      if (carriesBytes(src.members, row.target)) {
        return { kind: "fact", what: `the byte-blob ${row.target.slice(0, 12)}…` };
      }
      throw new Error(
        `adoption refused: manifest row "${row.alias}" names ${row.target}, which resolves to ` +
          `nothing in this module version — a stranger's manifest gets no silent skips`,
      );
    }
    // Survival is asked BEFORE the kind: a struck export is refused as struck, never classified as
    // something that happens not to be there.
    if (!src.survives(target.id)) struck("an export", target.id);
    if (isRendererBinding(target.claims)) return rendererExport(row, target);
    if (isRegistrationBinding(target.claims)) {
      throw new Error(
        `adoption refused: manifest row "${row.alias}" names a registration BINDING by address ` +
          `(${row.target}) — schema law is named by its hyperschema ENTITY, the identifier that ` +
          `survives a republish (§27.8)`,
      );
    }
    return { kind: "fact", what: `the byte/fact delta ${row.target}` };
  }

  // An ENTITY row. Schema law first: does anything in the members DEFINE a hyperschema there?
  const definitions = src.members.filter((d) => entityOf(d.claims, ROLE_HS_DEFINES) === row.target);
  if (definitions.length > 0) {
    const live = definitions.filter((d) => src.survives(d.id));
    if (live.length === 0) struck("a hyperschema definition", definitions[0]!.id);
    return schemaExport(src, row, live);
  }
  // Not law. Is it an entity the module carries claims about at all?
  const mentioned = src.members.some((d) =>
    d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.id === row.target),
  );
  if (!mentioned) {
    throw new Error(
      `adoption refused: manifest row "${row.alias}" names the entity ${row.target}, which this ` +
        `module version says nothing about — a stranger's manifest gets no silent skips`,
    );
  }
  return { kind: "fact", what: `the entity ${row.target}` };
}

function rendererExport(row: ManifestRow, target: Delta): RendererExport {
  const claims = target.claims;
  const route = primitiveOf(claims, "route");
  const schemaName = primitiveOf(claims, "schema");
  const bundle = primitiveOf(claims, "bundle");
  if (typeof route !== "string" || typeof schemaName !== "string" || typeof bundle !== "string") {
    throw new Error(
      `adoption refused: manifest row "${row.alias}" names ${target.id}, a renderer binding ` +
        `missing its route, schema, or bundle — malformed law binds nothing anywhere, and it is ` +
        `named here rather than skipped`,
    );
  }
  if (primitiveOf(claims, "versionId") !== undefined) {
    throw new Error(
      `adoption refused: the renderer at "${row.alias}" pins a §17 registration VERSION of the ` +
        `module's own store (${String(primitiveOf(claims, "versionId"))}), a delta id this store ` +
        `does not hold — the pin would go dark here. Adopt the schema, then publish the renderer ` +
        `against this store's own version.`,
    );
  }
  const writable = jsonList(claims, "writable");
  const penRaw = primitiveOf(claims, "pen");
  const pen = typeof penRaw === "string" && penRaw !== "" ? penRaw : undefined;
  // A half-written binding is READ-ONLY at the reader (§23.3), and it is read the same way here:
  // the pen guard fires on a pen that would actually SIGN, so the two cannot drift.
  const writeReady = writable !== undefined && writable.length > 0 && pen !== undefined;
  const core = {
    route,
    // Parse boundary: a stranger's binding names the lens it reads as a bare string; blessed as a
    // LensName here, so nothing downstream can compare it against a PROGRAM name (H6).
    schemaName: schemaName as LensName,
    consumes: jsonList(claims, "consumes") ?? [],
    bundle,
    ...(writeReady ? { writable: writable as readonly string[], pen } : {}),
  };
  return {
    kind: "renderer",
    ...core,
    timestamp: claims.timestamp,
    sourceDelta: target.id,
    producedBy: claims.author,
    address: rendererLawAddress(core),
    lineage: [target.id],
  };
}

function schemaExport(src: Source, row: ManifestRow, definitions: readonly Delta[]): SchemaExport {
  const definition = [...definitions]
    .sort((a, b) =>
      byAge(
        { timestamp: a.claims.timestamp, deltaId: a.id },
        { timestamp: b.claims.timestamp, deltaId: b.id },
      ),
    )
    .at(-1)!;
  const bindings = src.members.filter(
    (d) => isRegistrationBinding(d.claims) && entityOf(d.claims, "hyperschema") === row.target,
  );
  if (bindings.length === 0) {
    throw new Error(
      `adoption refused: "${row.alias}" names the hyperschema ${row.target}, which this module ` +
        `defines but never REGISTERS — there is no resolution program to bless (a definition ` +
        `alone resolves nothing, §21)`,
    );
  }
  const live = bindings.filter((d) => src.survives(d.id));
  if (live.length === 0) {
    throw new Error(
      `adoption refused: "${row.alias}" names law whose registration its own author RETRACTED ` +
        `inside the module (${bindings[0]!.id} is struck in this version's members) — a blessing ` +
        `must not re-speak law its author took back`,
    );
  }
  // THE ROW'S ALIAS PICKS AMONG SIBLINGS (§47 criterion 9). Several live bindings can share one
  // entity — §21.7 coexistence, two readings over one definition — and `.at(-1)` alone collapsed
  // them: every row classified to the entity's LATEST binding, so a sibling lens federated as a
  // second copy of its twin. When any live binding's own `schema:<name>` bytes match the alias,
  // classification narrows to those; a module whose alias is not a lens name (the pre-§47 shape,
  // entity-derived aliases) keeps the latest-overall fallback whole.
  const aliased = live.filter((d) => {
    const p = d.claims.pointers.find((pt) => pt.role === "schema");
    return p?.target.kind === "entity" && p.target.entity.id === `schema:${row.alias}`;
  });
  const binding = [...(aliased.length > 0 ? aliased : live)]
    .sort((a, b) =>
      byAge(
        { timestamp: a.claims.timestamp, deltaId: a.id },
        { timestamp: b.claims.timestamp, deltaId: b.id },
      ),
    )
    .at(-1)!;
  const livingEntity = entityOf(binding.claims, "schema");
  const snapshotEntity = entityOf(binding.claims, "schemaVersion");
  const rootsJson = primitiveOf(binding.claims, "roots");
  if (livingEntity === undefined || snapshotEntity === undefined || typeof rootsJson !== "string") {
    throw new Error(
      `adoption refused: the registration binding at "${row.alias}" (${binding.id}) names no ` +
        `living Schema, snapshot, or roots — malformed law, named rather than skipped`,
    );
  }
  const hyperschema = loadHyperSchema(src.dset, row.target);
  const schema = loadSchema(src.dset, snapshotEntity);
  const roots = JSON.parse(rootsJson) as string[];
  const mutationsJson = primitiveOf(binding.claims, "mutations");
  const resolversJson = primitiveOf(binding.claims, "resolvers");
  // The publish door refuses a malformed template or resolver LOUDLY, so parse loudly here too:
  // a blessing that quietly dropped a module's mutations would serve a narrower surface than the
  // law it claims to have adopted.
  const mutations =
    typeof mutationsJson === "string"
      ? parseClaimTemplates(JSON.parse(mutationsJson) as unknown)
      : undefined;
  const resolvers =
    typeof resolversJson === "string"
      ? parseResolvers(JSON.parse(resolversJson) as unknown)
      : undefined;
  const writable = jsonList(binding.claims, "writable");
  // The four source deltas, in the order the publish door mints them: definition, living Schema,
  // frozen snapshot, binding. Each blessed twin inherits ITS OWN source delta's timestamp. A module
  // whose Schema publishes were struck while the binding survived has no timestamp to inherit for
  // those two, so they fall back to the binding's: the blessing still binds (this store publishes
  // the entities itself), it simply no longer re-mints the source's ids for that pair.
  const livingDelta = latestAt(src, ROLE_SCHEMA_DEFINES, livingEntity);
  const snapshotDelta = latestAt(src, ROLE_SCHEMA_DEFINES, snapshotEntity);
  return {
    kind: "schema",
    hyperschema,
    schema,
    roots,
    // The lens name lives in the BINDING's own bytes — the living `schema:<name>` pointer, minus
    // its prefix — exactly as `lensNameOf` reads it on the reading side (H6: never the program).
    lensName: (livingEntity.startsWith("schema:")
      ? livingEntity.slice("schema:".length)
      : livingEntity) as LensName,
    schemaEntity: row.target,
    ...(mutations === undefined ? {} : { mutations }),
    ...(writable === undefined ? {} : { writable }),
    ...(resolvers === undefined ? {} : { resolvers }),
    timestamps: [
      definition.claims.timestamp,
      livingDelta?.claims.timestamp ?? binding.claims.timestamp,
      snapshotDelta?.claims.timestamp ?? binding.claims.timestamp,
      binding.claims.timestamp,
    ],
    sourceDelta: binding.id,
    producedBy: binding.claims.author,
    address: schemaLawAddress(hyperschema, schema),
    lineage: [definition.id, livingDelta?.id, snapshotDelta?.id, binding.id].filter(
      (id): id is string => id !== undefined,
    ),
  };
}

const latestAt = (src: Source, role: string, entity: string): Delta | undefined =>
  [...src.members]
    .filter((d) => entityOf(d.claims, role) === entity && src.survives(d.id))
    .sort((a, b) =>
      byAge(
        { timestamp: a.claims.timestamp, deltaId: a.id },
        { timestamp: b.claims.timestamp, deltaId: b.id },
      ),
    )
    .at(-1);

// --- the source: a version plus the container it came from ---------------------------------------

// Which DECLARED container do these members live in? Asked of the attached container stores by
// CONTAINMENT of the frozen set — a store holding every member is the ground it was frozen over. The
// answer is the container ENTITY, so the record joins the T32 table rather than carrying free
// text; a version frozen over ground no attached container holds records the nameless label.
function containerOf(gw: Gateway, version: ModuleVersion): string | undefined {
  const hits: string[] = [];
  for (const [entity, pool] of gw.attachedContainers) {
    if (!gw.quarantinePools.has(pool)) continue;
    if (version.members.every((d) => pool.reactor.get(d.id) !== undefined)) hits.push(entity);
  }
  hits.sort();
  return hits[0];
}

// Which strikes among these members COUNT (author-scoped, as above), and which are negations of a
// member at all. Both are needed to build the operand set the loaders read.
function strikeIndex(members: readonly Delta[]): {
  counted: Set<string>;
  aboutAMember: Set<string>;
} {
  const byId = new Map(members.map((d) => [d.id, d]));
  const counted = new Set<string>();
  const aboutAMember = new Set<string>();
  for (const d of members) {
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = byId.get(p.target.deltaRef.delta);
      if (target === undefined) continue;
      aboutAMember.add(d.id);
      if (target.claims.author === d.claims.author) counted.add(d.id);
    }
  }
  return { counted, aboutAMember };
}

// THE OPERAND SET IS WHERE THE SCOPE LIVES OR DIES. `loadHyperSchema` / `loadSchema` gather through
// rhizomatic's own bootstrap, whose body begins `mask policy: "drop"` — an AUTHOR-BLIND suppression
// over whatever set it is handed. So filtering only the negated MEMBERS is not enough: hand the
// loaders a foreign strike and rhizomatic drops the definition this module's algebra says survives,
// and the scope is undone one layer down (H1's shape — a reader seeing something the deltas, read
// under the right rule, do not say). The set therefore carries only the strikes that COUNT.
function operandSet(
  members: readonly Delta[],
  lives: (id: string) => boolean,
  reading: "blessing" | "exposure",
): DeltaSet {
  const { counted, aboutAMember } = strikeIndex(members);
  return DeltaSet.from(
    members.filter((d) => {
      // EXPOSURE reads PRESENCE: what the module shipped, before anybody's second thoughts. Every
      // strike about a member steps aside, so a row its author withdrew still classifies — `lawFrom`
      // reports it flagged, and dropping it would answer "not exposed" about law still serving here.
      if (reading === "exposure") return !aboutAMember.has(d.id);
      if (!lives(d.id)) return false; // struck under the scoped algebra: gone, at both levels
      return !aboutAMember.has(d.id) || counted.has(d.id);
    }),
  );
}

function sourceOf(
  gw: Gateway,
  version: ModuleVersion,
  reading: "blessing" | "exposure" = "blessing",
): Source {
  const livesAtSource = survivalOver(version.members);
  const container = containerOf(gw, version);
  return {
    version,
    members: version.members,
    survives: reading === "blessing" ? livesAtSource : () => true,
    livesAtSource,
    dset: operandSet(version.members, livesAtSource, reading),
    ...(container === undefined ? {} : { container }),
    from: container ?? "quarantine",
  };
}

// --- the provenance record (SPEC §27's ledger: origination vs exposure) --------------------------

/**
 * A law adoption's trail entry. Shares `loam.adoption` with promote-outputs — it IS an adoption,
 * and the six roles `readAdoptions` requires are all present — and adds the law-side roles that
 * tell ORIGINATION (`adopted-from`) from mere EXPOSURE (`witnessed`).
 */
export interface LawAdoption {
  readonly kind: "adopted-from" | "witnessed";
  /** The source container ENTITY when the members betray one, else the nameless label. */
  readonly from: string;
  readonly alias: string;
  readonly moduleVersion: string;
  /** The manifest row's own target — the address arithmetic a re-point diff runs on. */
  readonly target: string;
  readonly lawAddress: string;
  readonly adoptedDelta: string;
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly at: number;
}

const ROLE_RECORD_KIND = "record-kind";

interface RecordSpec {
  readonly kind: "adopted-from" | "witnessed";
  readonly from: string;
  readonly container?: string;
  readonly alias: string;
  readonly moduleVersion: string;
  readonly target: string;
  readonly lawAddress: string;
  readonly adoptedDelta: string;
  readonly sourceDelta: string;
  readonly producedBy: string;
}

function lawAdoptionRecordClaims(spec: RecordSpec, operator: string, timestamp: number): Claims {
  return {
    timestamp,
    author: operator,
    pointers: [
      {
        role: "adopts",
        target: { kind: "entity", entity: { id: ADOPTION_ENTITY, context: CTX_ADOPTION } },
      },
      { role: "adopted", target: { kind: "delta", deltaRef: { delta: spec.adoptedDelta } } },
      { role: "adopted-from", target: { kind: "primitive", value: spec.from } },
      { role: "source-delta", target: { kind: "primitive", value: spec.sourceDelta } },
      { role: "produced-by", target: { kind: "primitive", value: spec.producedBy } },
      { role: "adopted-by", target: { kind: "primitive", value: operator } },
      { role: "at", target: { kind: "primitive", value: timestamp } },
      { role: ROLE_RECORD_KIND, target: { kind: "primitive", value: spec.kind } },
      { role: "alias", target: { kind: "primitive", value: spec.alias } },
      { role: "module-version", target: { kind: "primitive", value: spec.moduleVersion } },
      { role: "export-target", target: { kind: "primitive", value: spec.target } },
      { role: "law-address", target: { kind: "primitive", value: spec.lawAddress } },
      // The container ENTITY, so the trail JOINS the §27 table. The role is `from-container`, not
      // `container`: the container validator keys on the role `container` at this context, and a
      // record wearing that role would be read as a malformed container DECLARATION at the door.
      ...(spec.container === undefined
        ? []
        : [
            {
              role: "from-container" as const,
              target: {
                kind: "entity" as const,
                entity: { id: spec.container, context: CTX_CONTAINER },
              },
            },
          ]),
    ],
  };
}

/**
 * The law-adoption trail, read live. A struck record is not a record — the same per-record-author
 * negation scoping `readAdoptions` runs, so only the operator's own strike forgives their own
 * provenance. Fact adoptions (promote-outputs) carry no `record-kind` and are not returned here,
 * so `adoptions()` and `lawAdoptions()` each answer their own question over one shared context.
 */
export function readLawAdoptions(
  reactor: Reactor,
  operator: string,
  opts?: { includeStruck?: boolean },
): LawAdoption[] {
  const negated = lawfulNegated(reactor, operator);
  const out: LawAdoption[] = [];
  for (const d of reactor.snapshot()) {
    if (d.claims.author !== operator || !isAdoption(d.claims)) continue;
    if (opts?.includeStruck !== true && negated(d.id)) continue;
    const kind = primitiveOf(d.claims, ROLE_RECORD_KIND);
    if (kind !== "adopted-from" && kind !== "witnessed") continue; // a FACT adoption, not law
    const adoptedPtr = d.claims.pointers.find((p) => p.role === "adopted");
    const adoptedDelta =
      adoptedPtr?.target.kind === "delta" ? adoptedPtr.target.deltaRef.delta : undefined;
    const from = primitiveOf(d.claims, "adopted-from");
    const alias = primitiveOf(d.claims, "alias");
    const moduleVersion = primitiveOf(d.claims, "module-version");
    const target = primitiveOf(d.claims, "export-target");
    const lawAddress = primitiveOf(d.claims, "law-address");
    const sourceDelta = primitiveOf(d.claims, "source-delta");
    const producedBy = primitiveOf(d.claims, "produced-by");
    const at = primitiveOf(d.claims, "at");
    if (
      adoptedDelta === undefined ||
      typeof from !== "string" ||
      typeof alias !== "string" ||
      typeof moduleVersion !== "string" ||
      typeof target !== "string" ||
      typeof lawAddress !== "string" ||
      typeof sourceDelta !== "string" ||
      typeof producedBy !== "string" ||
      at === undefined
    ) {
      continue; // a malformed record records no trail
    }
    out.push({
      kind,
      from,
      alias,
      moduleVersion,
      target,
      lawAddress,
      adoptedDelta,
      sourceDelta,
      producedBy,
      at: Number(at),
    });
  }
  return out;
}

// --- the living-name critical section (§27.8's atomicity, criterion 14) --------------------------

/**
 * Run `body` inside the ONE per-gateway living-name critical section. Every door that takes a
 * latest-wins NAME passes through here — `adoptLaw`, `publishRegistration`, `publishRenderer` —
 * because the guard defends a name, not a door: a queue private to the adoption door would let a
 * direct publish move the winner underneath a checked adoption. The mechanism is the
 * single-writer gateway the store doctrine already holds; nothing in the substrate changes.
 */
export function withLivingNames<T>(gw: Gateway, body: () => Promise<T>): Promise<T> {
  const run = gw.livingNames.then(body);
  gw.livingNames = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// --- the door ------------------------------------------------------------------------------------

export interface AdoptLawOptions {
  /** Take a living name whose current winner differs in content — eyes open, and reversible. */
  readonly supersede?: boolean;
  /** Bless under a DIFFERENT root name, so both readings serve side by side. */
  readonly as?: string;
  /** A pen-holding renderer never rides a blessing implicitly (§23.3 × §6's two keys). */
  readonly pen?: boolean;
  /** alias → the new target address the operator confirms for a RE-POINTED alias. */
  readonly repoints?: Readonly<Record<string, string>>;
  /**
   * Refuse a row that classifies as anything other than this kind. Blessing a NAME and mounting
   * CODE THAT RUNS are different grants (§24.6), and a caller that means one must never perform the
   * other because a manifest alias resolved to a row it did not expect — an alias is a lookup key a
   * peer's own law can collide with.
   */
  readonly expect?: "schema" | "renderer";
  /**
   * Refuse rather than blessing a renderer's schema dependency alongside it. The default pulls the
   * dependency in, which is right for an operator blessing a module they chose; a caller blessing
   * ONE export of a stranger's pool must bind nothing the operator did not ask for.
   */
  readonly dependencies?: "refuse";
  /**
   * Resolve the alias only among manifest rows THIS store's operator authored.
   *
   * A module's manifest is ordinarily the SHIPPER's word — that is the whole point of §27.8, and the
   * default must stay unscoped. A federation pool is the other case: the peer never sends rows, the
   * receiver mints every one of them, and the peer CAN author deltas in the pool. `readManifest` is
   * latest-per-alias across all authors, so an unscoped read there lets a peer plant a row that wins
   * an alias and redirects the blessing to a target the operator never saw. Scoped, an alias means
   * what the operator said it means.
   */
  readonly manifest?: "operator";
  /**
   * Bind the law and WITHHOLD its §22 resolvers — the fields they back refuse, by name, instead of
   * running a stranger's code.
   *
   * A registration may carry resolver ESM, and publishing one loads that ESM on THIS gateway
   * (`preloadResolvers` → `importEsm`) — no pool, no worker, no frame. So a pass that binds NAMES
   * without a person deciding cannot pass resolvers through: "a name bound" and "code ran" are the
   * two grants §24.6 keeps apart, and this is the second one arriving through the first.
   *
   * `"grant"` is the act that reverses it, and it also SKIPS THE WITNESS. Law identity deliberately
   * excludes the resolvers (`schemaLawAddress` covers the gather body and the resolution program,
   * nothing else), so withheld law and granted law share one address — and a re-blessing would
   * witness, append nothing, and report success while every field went on refusing. A grant changes
   * something the address cannot see, so the address may not be what decides whether it happens.
   */
  readonly resolvers?: "withhold" | "grant";
}

export interface AdoptionOutcome {
  readonly alias: string;
  readonly kind: "adopted-from" | "witnessed";
  /** The delta ids this gesture landed. Empty for a silent witness. */
  readonly landed: readonly string[];
  /** Courtesy notes — version skew, a dependency pulled, a fact row passed over. Never refusals. */
  readonly notes: string[];
}

export interface BlessAllOptions {
  readonly pen?: boolean;
  readonly repoints?: Readonly<Record<string, string>>;
}

export interface BlessAllReport {
  readonly blessed: string[];
  readonly witnessed: string[];
  /** Per-row refusals that did NOT stop the call — today, unconfirmed re-points. */
  readonly refused: string[];
  readonly notes: string[];
}

// What currently WINS a living name, and what its content is — the pair the guard carries across
// its hold and re-checks before it appends.
interface Winner {
  readonly address: string;
  readonly deltaId: string;
}

const schemaWinner = (gw: Gateway, lens: string): Winner | undefined => {
  const versions = gw.registrationVersions().filter((v) => lensOf(v) === lens);
  const winner = versions.at(-1); // registrationVersions is (timestamp, deltaId) ascending
  if (winner === undefined) return undefined;
  return {
    address: schemaLawAddress(winner.hyperschema, winner.schema),
    deltaId: winner.deltaId,
  };
};

const routeWinner = (gw: Gateway, route: string): Winner | undefined => {
  const held = gw.renderers().find((r) => r.route === route);
  if (held === undefined) return undefined;
  return { address: rendererLawAddress(held), deltaId: held.deltaId };
};

// Is this exact law already bound at this root, under ANY name? That is what makes a re-blessing a
// silent WITNESS rather than a second publish. Law identity is the content address — but the
// WITNESS keys on (address, requested living name), not the address alone (§47 criterion 2,
// T198): the same law under the SAME name is a repeat and witnesses (the hourly blessAll case),
// while the same law under a NEW name is a second binding and publishes — two peers who both ran
// `loam register --stock note` are the default case, and address-only witnessing left the second
// channel's name uncreated while the report said bound. A caller with NO requested name (lawFrom's
// exposure reading asks "bound under any name?") keeps the old address-only semantics.
//
// The root-name guard is untouched: it runs AFTER this, per name, so keying the witness narrower
// hands it nothing — a contested name still meets the same refusal it always did.
function boundElsewhere(
  gw: Gateway,
  ex: SchemaExport | RendererExport,
  requestedName?: string,
): Winner | undefined {
  if (ex.kind === "schema") {
    for (const v of gw.registrationVersions()) {
      if (schemaLawAddress(v.hyperschema, v.schema) !== ex.address) continue;
      if (requestedName !== undefined && lensOf(v) !== requestedName) continue;
      return { address: ex.address, deltaId: v.deltaId };
    }
    return undefined;
  }
  for (const r of gw.renderers()) {
    if (rendererLawAddress(r) === ex.address) {
      return { address: ex.address, deltaId: r.deltaId };
    }
  }
  return undefined;
}

// The hyperschema ENTITY guard (§21: identity is the ENTITY, not the name).
//
// A schema row names its export by an entity the SHIPPER chose, and `schemaEntityFor` lets an
// explicit entity override the default — so a manifest may point at `hyperschema:Plant`, the
// operator's own. Nothing else stops it: the publish door's trial refuses a rival body per PROGRAM
// name (a fresh program name walks past it) and the living-name guard defends the LENS (a free lens
// name walks past that). What lands is an OPERATOR-SIGNED definition at the operator's own entity,
// and `loadHyperSchema` takes the latest by CLAIMED timestamp — so a shipper's chosen timestamp
// decides whose gather body the operator's own lens resolves through. That is a confused deputy on
// the most load-bearing law in the store, and it needs its own guard.
//
// The rule: a blessing may not land a definition at an entity the root's own lawful ground ALREADY
// DEFINES WITH DIFFERENT CONTENT. Same-content is the idempotent case (re-blessing, or law the
// operator already published themselves) and passes untouched.
//
// No `as`-style escape, deliberately. `as` exists because two readings of the SAME program
// legitimately coexist under different lens names; there is no corresponding legitimate act here —
// "replace the gather program my own lens resolves through, using a stranger's bytes, at my own
// entity" is the attack, not a use case. An operator who genuinely wants to change their program
// republishes it themselves, at their own entity, with their own body: a deliberate act through the
// ordinary door, not a side effect of blessing something else. Rewriting the blessing's entity
// instead (namespacing it) was the other candidate and is worse: the entity is what a republish
// EVOLVES (§21), so a rewritten entity would silently sever the module's own next bump from the law
// this store blessed, and break `lawFrom`'s address arithmetic with it.
function entityCaptureRefusal(gw: Gateway, ex: SchemaExport): string | undefined {
  const held = boundHyperschemaAt(gw, ex.schemaEntity);
  if (held === undefined || hyperschemaAddress(held) === hyperschemaAddress(ex.hyperschema)) {
    return undefined;
  }
  return (
    `the export names the hyperschema entity ${ex.schemaEntity}, which this store's own lawful ` +
    `ground already defines as "${held.name}" with a DIFFERENT gather body — blessing it would ` +
    `land operator-signed bytes at the operator's own definition entity, and §21's latest-wins ` +
    `would let the module's timestamp decide which body every lens filed there resolves through. ` +
    `A module may not name one of your entities. Have the shipper publish at their own ` +
    `(\`hyperschema:<Name>\` of a name you do not use), or republish your own program yourself.`
  );
}

// The latest lawful surviving definition at an entity, or undefined when this store defines none.
// Reads the OPERATOR's slice — a federated stranger's definition binds nothing and must not be
// mistaken for an incumbent (that would refuse honest blessings on a store that merely holds the
// module's bytes).
function boundHyperschemaAt(gw: Gateway, entity: string): HyperSchema | undefined {
  try {
    return loadHyperSchema(lawfulSnapshot(gw.reactor, gw.operatorAuthor), entity);
  } catch {
    return undefined;
  }
}

// Structural identity of a GATHER PROGRAM alone — the definition's own content, without any
// resolution schema. This is what the entity guard compares, because the definition is what a
// shared entity would capture.
const hyperschemaAddress = (hs: HyperSchema): string =>
  contentAddress(
    new TextEncoder().encode(
      ["loam.law.hyperschema", hs.name, String(hs.alg ?? 1), termCanonicalHex(hs.body)].join(NUL),
    ),
  );

const livingNameOf = (ex: SchemaExport | RendererExport, opts: AdoptLawOptions): string =>
  ex.kind === "schema" ? (opts.as ?? ex.lensName) : ex.route;

const winnerOf = (
  gw: Gateway,
  ex: SchemaExport | RendererExport,
  name: string,
): Winner | undefined => (ex.kind === "schema" ? schemaWinner(gw, name) : routeWinner(gw, name));

/**
 * Bless ONE manifest row (the body of `Gateway.adoptLaw`).
 */
export async function adoptLawImpl(
  gw: Gateway,
  version: ModuleVersion,
  alias: string,
  opts: AdoptLawOptions = {},
): Promise<AdoptionOutcome> {
  const src = sourceOf(gw, version);
  const rows = manifestRowsFor(gw, src, opts);
  const row = rows.find((r) => r.alias === alias);
  if (row === undefined) {
    throw new Error(
      `adoption refused: this module version lists no export named "${alias}" — its manifest ` +
        `offers ${rows.length === 0 ? "nothing" : rows.map((r) => `"${r.alias}"`).join(", ")}`,
    );
  }
  const ex = classify(src, row);
  if (ex.kind === "fact") {
    throw new Error(
      `adoption refused: "${alias}" is ${ex.what} — a FACT, and this module exports no law at ` +
        `that alias. Facts bind nothing and need no blessing: they read where they are and cross ` +
        `by promote-outputs (§24.3).`,
    );
  }
  if (opts.expect !== undefined && ex.kind !== opts.expect) {
    throw new Error(
      `adoption refused: "${alias}" names ${ex.kind} law, and this caller asked for ` +
        `${opts.expect} law. Blessing a NAME and mounting CODE THAT RUNS are different grants ` +
        `(§24.6) — an alias a peer chose may not turn one act into the other.`,
    );
  }
  return adoptOne(gw, src, row, ex, opts);
}

async function adoptOne(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  given: SchemaExport | RendererExport,
  opts: AdoptLawOptions,
): Promise<AdoptionOutcome> {
  if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
    throw new Error(
      "only an operated store may adopt law (a blessing is the operator's own claim)",
    );
  }
  const notes: string[] = [...skewNotes(gw, src, row)];
  // THE LENS THE BINDING WILL NAME HERE, resolved before anything else reads its address.
  const verdict: LensVerdict =
    given.kind === "renderer"
      ? resolveRendererLens(gw, src, row, given, opts, notes)
      : { kind: "unknown" };
  const ex = verdict.kind === "resolved" ? verdict.ex : given;
  // The module DEFINES the lens and this store binds that law nowhere: the dependency is a real
  // debt, whatever some other law happens to be called. Carried past the witness to the guard below.
  const unblessed = verdict.kind === "unblessed" ? verdict.dependency : undefined;

  // A pen never rides the sugar OR the primitive: §23.3's write standing is a second key, and
  // classification read it from the BYTES, so a manifest calling this row a schema changes nothing.
  if (ex.kind === "renderer" && ex.pen !== undefined && opts.pen !== true) {
    throw new Error(
      `adoption refused: the renderer "${row.alias}" holds a PEN (${ex.pen}) — blessing code that ` +
        `can write needs its own deliberate flag ({ pen: true }), never an implicit ride. ` +
        `Blessing still confers no write standing: the pen must be granted and provisioned ` +
        `separately (§6's two keys).`,
    );
  }

  // The shipper does not get to name one of OUR definition entities. Checked before the witness
  // short-circuit is irrelevant either way (a captured entity can never be already-bound law), but
  // checked before the publish it is the whole guard.
  if (ex.kind === "schema") {
    const capture = entityCaptureRefusal(gw, ex);
    if (capture !== undefined) throw new Error(`adoption refused: ${capture}`);
  }

  // Already bound as THE NAME THE CALLER ASKED FOR: a silent witness, never a second publish.
  // The key is `opts.as`, deliberately — an explicit `as` is the receiver's naming act (§46), so
  // the name is part of the request, and the same law under a NEW requested name is a second
  // binding that publishes (§47 criterion 2: many names may point at one law). A call with NO `as`
  // asked for the LAW, not a name, and keeps the address-only witness whole — T140's idempotent
  // module contract, where re-blessing what the operator already serves appends nothing.
  // A GRANT IS NOT A REPEAT, whatever the address says — see `AdoptLawOptions.resolvers`.
  const already = opts.resolvers === "grant" ? undefined : boundElsewhere(gw, ex, opts.as);
  if (already !== undefined) {
    const landed = await record(gw, src, row, ex, "witnessed", already.deltaId);
    return { alias: row.alias, kind: "witnessed", landed, notes };
  }

  // A CALLER THAT REFUSES DEPENDENCIES REFUSES THE BARE-NAME FALLBACK WITH THEM.
  //
  // `unknown` means the module carries no definition of the lens this renderer reads, so the only
  // thing left to match on is the peer's own spelling — and the fallback below matches it against
  // `gw.registered`, which in a channel pool is the one-way seeded copy of the RECEIVER's own
  // registrations. That is the lens capture the address matching exists to prevent, arriving by the
  // one door that skips it: a peer's app reading `Plant` would mount bound to the operator's Plant,
  // rendering the operator's own reading under the peer's name. A caller that blesses one export of
  // a stranger's pool cannot accept "some law of that name is served here" as an answer.
  if (ex.kind === "renderer" && verdict.kind === "unknown" && opts.dependencies === "refuse") {
    throw new Error(
      `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", and this ` +
        `module carries no definition of it — so nothing here can say WHOSE reading that name ` +
        `means. A law of that name may well be served; matching on the name would mount this app ` +
        `over it. Bless the schema it reads first, from the same source.`,
    );
  }

  // A renderer reads a LENS this store must serve (§23.4 refuses one that does not). When the
  // module exports that lens too, the blessing takes it first — the renderer is not law that
  // stands alone, and the dependency is REPORTED rather than assumed.
  if (
    ex.kind === "renderer" &&
    (unblessed !== undefined || !gw.registered.some((r) => lensOf(r) === ex.schemaName))
  ) {
    const dependency = unblessed;
    if (dependency === undefined) {
      throw new Error(
        `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", which ` +
          `this store does not serve and this module does not export — bless the schema it reads ` +
          `first, or register your own`,
      );
    }
    if (opts.dependencies === "refuse") {
      throw new Error(
        `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", which ` +
          `this store does not serve — bless the schema it reads first. This caller blesses one ` +
          `export at a time, so nothing binds a name the operator did not ask for.`,
      );
    }
    // The dependency is blessed under its OWN name: `as` renames the row the operator asked for,
    // never the lens its renderer reads. `supersede` does NOT ride down either — it is consent to
    // take ONE name the caller looked at, and the dependency's name is one they never mentioned.
    const inherited: AdoptLawOptions = {
      ...(opts.pen === undefined ? {} : { pen: opts.pen }),
      ...(opts.repoints === undefined ? {} : { repoints: opts.repoints }),
    };
    await adoptOne(gw, src, dependency.row, dependency.ex, inherited);
    notes.push(
      `blessed the schema export "${dependency.row.alias}" first — the renderer "${row.alias}" ` +
        `reads the lens "${ex.schemaName}", and a renderer over an unserved lens mounts nothing`,
    );
  }

  const name = livingNameOf(ex, opts);
  const confirmed = opts.repoints?.[row.alias] === row.target;
  // `as` NAMES; only `supersede` (or a confirmed re-point) TAKES. The door's own refusal presents
  // them as exactly that pair — supersede to take the name, `as` to serve side by side — yet `as`
  // used to confer take-the-name too, so an operator following the door's own guidance onto an
  // OCCUPIED name struck the incumbent's binding silently, with the outcome reading "adopted-from"
  // and no note that a naming request had become a retirement (the suppression lens's finding;
  // §47's witness change made the state reachable, since the same law bound under another name no
  // longer witnesses before this guard runs).
  const mayTake = opts.supersede === true || confirmed;

  // PHASE 1 — the name-check, inside the critical section. It carries the winner it OBSERVED.
  const observed = await withLivingNames(gw, () => {
    const held = winnerOf(gw, ex, name);
    if (held !== undefined && held.address !== ex.address && !mayTake) {
      throw new Error(
        `adoption refused: ${ex.kind === "schema" ? `the name "${name}"` : `the route "${name}"`} ` +
          `is already answered here by DIFFERENT-content law (${held.deltaId}) — a blessing must ` +
          `not silently re-point an existing reading. Bless it with { supersede: true } to take ` +
          `the name (reversibly), or { as: "<OtherName>" } to serve both side by side.`,
      );
    }
    return Promise.resolve(held);
  });

  // The seam the race rail drives: a hold between the check and the append, outside the lock, so
  // another door genuinely CAN move the winner in the gap the guard has to survive.
  await gw.adoptionHold?.();

  // PHASE 2 — re-check, then append, inside the critical section.
  const landed = await withLivingNames(gw, async () => {
    const held = winnerOf(gw, ex, name);
    if (held?.address !== observed?.address) {
      throw new Error(
        `adoption refused: the WINNER of ${ex.kind === "schema" ? `"${name}"` : `route "${name}"`} ` +
          `MOVED between this blessing's name-check and its append (${
            observed?.deltaId ?? "nothing was bound"
          } → ${held?.deltaId ?? "nothing is bound"}) — another door took the name. Nothing was ` +
          `published; re-read the winner and bless again.`,
      );
    }
    // `supersede` outranks by RETIRING the incumbent from the blessing itself, because the
    // blessing's timestamp is the source's and cannot win on recency. Strike the blessing and the
    // incumbent resurfaces — the negation stops counting with its carrier.
    // A GRANT MUST RETIRE ITS INCUMBENT, and recency cannot do it. The withheld binding and the
    // granted one are the SAME LAW by address — that is why the witness had to be skipped — and a
    // blessing inherits its source timestamps, so the two tie and the id tie-break decides which
    // one a reader sees. A coin flip is not a decision an operator took.
    const takesName =
      held !== undefined && (held.address !== ex.address || opts.resolvers === "grant");
    const negates = takesName ? [held.deltaId] : [];
    return publish(gw, ex, opts, negates);
  });

  const provenance = await record(gw, src, row, ex, "adopted-from", landed[0] ?? ex.sourceDelta);
  return { alias: row.alias, kind: "adopted-from", landed: [...landed, ...provenance], notes };
}

/**
 * THE RECEIVER'S REFUSING STUB, byte for byte — the whole source of a withheld resolver.
 *
 * It is DERIVED from the lens and the field rather than recognised by a marker, and that is the
 * guard, not a detail. A substring test over source a PEER authors is a test the peer can pass:
 * prefix your module with the marker, and every reader here calls your code withheld while
 * `publishRegistration` imports and evaluates it — the guarantee inverted, with every
 * operator-facing signal agreeing that nothing ran. Equality cannot be gamed that way: source
 * identical to this IS this, and what runs is the refusal. Nothing about a stub is read from what
 * arrived.
 */
export function withheldResolverCode(lens: string, field: string): string {
  const why =
    `"${field}" on "${lens}" is computed by RESOLVER CODE the peer wrote, and this store has ` +
    "not been told to run it. Law that arrives on a channel binds a NAME; running code is a " +
    "second decision. Bless it with `loam federate bless-app --channel <name> --resolvers " +
    `"${lens}"\`, or read the fields this lens resolves without a resolver.`;
  return `export default () => { throw new Error(${JSON.stringify(why)}); };`;
}

/** Is this EXACTLY the stub this store would write for that field — not merely something like it? */
export const isWithheldResolver = (code: string, lens: string, field: string): boolean =>
  code === withheldResolverCode(lens, field);

/**
 * The peer's resolvers, replaced one for one by a stub of OUR OWN that refuses.
 *
 * Dropping them instead would be quieter and worse: the field would fall back to its Policy value
 * and answer a NUMBER an operator had no reason to trust, with nothing anywhere saying that a
 * reading they were shown is not the reading the peer wrote. A refusal is the honest shape — the
 * field says what is missing and what act supplies it.
 *
 * The stub is this store's code, not the peer's, which is the whole point: it is what runs where
 * the peer's ESM would have. `type` and `rung` are preserved so the surface keeps its shape and the
 * refusal arrives at the field rather than at the publish.
 */
function withheldResolvers(
  specs: ResolverSpecs | undefined,
  lens: string,
): ResolverSpecs | undefined {
  if (specs === undefined) return undefined;
  const out: Record<string, ResolverSpec> = {};
  for (const [field, spec] of Object.entries(specs)) {
    // EVERY field, unconditionally. An earlier shape skipped a spec that already LOOKED withheld,
    // so a re-bless would not stack stubs — and "looked withheld" was a substring of source the
    // peer writes, so the skip was the bypass. The stub is idempotent by construction: written
    // from the lens and the field, it is the same bytes every time, and re-blessing simply writes
    // it again. Nothing here trusts what arrived.
    out[field] = { rung: spec.rung, type: spec.type, code: withheldResolverCode(lens, field) };
  }
  return out;
}

/**
 * The manifest, as the caller is entitled to read it (see `AdoptLawOptions.manifest`).
 *
 * THE SCOPE IS APPLIED TO THE MEMBERS, NEVER TO THE ROWS. `readManifest` is latest-per-alias, so
 * filtering afterwards lets a foreign row WIN an alias and then be discarded — leaving the alias
 * empty and the operator's own row invisible. Filtering first asks the right question: what does
 * this manifest say, among the rows this caller trusts?
 */
function manifestRowsFor(gw: Gateway, src: Source, opts: AdoptLawOptions): ManifestRow[] {
  if (opts.manifest !== "operator") return readManifest(src.members);
  return readManifest(src.members.filter((d) => d.claims.author === gw.operatorAuthor));
}

/** What lens a renderer will read HERE, and whether that is a settled question yet. */
type LensVerdict =
  | { readonly kind: "resolved"; readonly ex: RendererExport }
  /** The module exports the lens, and this store serves that LAW under no name at all. */
  | { readonly kind: "unblessed"; readonly dependency: { row: ManifestRow; ex: SchemaExport } }
  /** The module does not carry the lens; only the peer's spelling is left to match on. */
  | { readonly kind: "unknown" };

/**
 * The renderer as it will actually be PUBLISHED here, with the lens it reads named the way THIS
 * store names it.
 *
 * Law identity deliberately excludes the living name (§46.2), so the lens a stranger's renderer
 * names bare — `Plant` — can be the very law this store already serves under a name of its own
 * choosing: a channel's `alice:Plant`, assigned by the receiver because the receiver names what it
 * receives. Publishing the peer's spelling would file a binding over a lens nothing here answers,
 * and the renderer door would refuse it — so the mapping is not a convenience, it is what makes an
 * arriving app mountable at all.
 *
 * IT MATCHES ON THE LAW'S ADDRESS, NEVER ON THE BARE NAME (H6) — and that closes the common case,
 * not every case. The address it compares comes from the module's own schema export, and a manifest
 * row names that export by hyperschema ENTITY; two stores that both publish a hyperschema named
 * `Plant` file at the same default entity, so `classify` resolves it to whichever definition is
 * latest across authors in the pool. When the receiver's own seeded law wins that, the address IS
 * the receiver's and the match agrees with itself. Timestamps on the peer's side are the peer's, so
 * which side wins is not the receiver's choice. Closing it wants entity-namespacing at the
 * federation edge, which is its own ticket; the rail names the gap where it can be seen. A
 * channel pool holds a one-way seeded copy of the RECEIVER's own registrations, so the set of lenses
 * "already served" there includes the receiver's own — and a peer whose app reads a common name
 * (`Note`, `Plant`, any stock shape) would otherwise mount bound to the RECEIVER's lens, resolving a
 * stranger's app through a Schema the operator never associated with that channel, and inheriting
 * whatever the operator had declared public about their own law. A name is not an identity; the
 * gather program plus its resolution program is.
 *
 * Re-addressed here, BEFORE the witness and the name guard read `address`, because the address must
 * be the address of what actually lands: computed from the peer's spelling, a second blessing of the
 * same app would fail to witness and would then meet the route's own "already answered by
 * DIFFERENT-content law" refusal, against law it published itself.
 */
function resolveRendererLens(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  ex: RendererExport,
  opts: AdoptLawOptions,
  notes: string[],
): LensVerdict {
  const dependency = dependencyRow(gw, src, ex.schemaName, opts);
  // Nothing in the module defines the lens. The operator was told "or register your own", so the
  // peer's spelling is all there is to match on — the caller's own name check rules below.
  if (dependency === undefined) return { kind: "unknown" };
  // THE SERVED SET, not every version ever published. A retired reading still has versions on the
  // ground — a cursed channel lens is exactly that — and re-pointing a binding at a name this store
  // no longer answers would swap a legible refusal for a renderer over a dark lens.
  const served = gw.registered.find(
    (r) => schemaLawAddress(r.hyperschema, r.schema) === dependency.ex.address,
  );
  if (served === undefined) return { kind: "unblessed", dependency };
  const under = lensOf(served);
  if (under === ex.schemaName) return { kind: "resolved", ex };
  notes.push(
    `the renderer "${row.alias}" reads the peer's lens "${ex.schemaName}", which this store serves ` +
      `as "${under}" — the binding names the reading THIS store answers`,
  );
  const core = { ...ex, schemaName: under };
  return { kind: "resolved", ex: { ...core, address: rendererLawAddress(core) } };
}

// The manifest row whose SCHEMA law provides a lens name — the dependency lookup a renderer needs.
function dependencyRow(
  gw: Gateway,
  src: Source,
  lens: string,
  opts: AdoptLawOptions,
): { row: ManifestRow; ex: SchemaExport } | undefined {
  for (const candidate of manifestRowsFor(gw, src, opts)) {
    let ex: Export;
    try {
      ex = classify(src, candidate);
    } catch {
      continue; // a row that cannot be classified is not a dependency; its own turn will name it
    }
    if (ex.kind === "schema" && ex.lensName === lens) return { row: candidate, ex };
  }
  return undefined;
}

// Route the row to its kind's ORDINARY publish door, under operator authorship, with the source's
// timestamps threaded through. `negates` is supersede's retirement of the incumbent.
async function publish(
  gw: Gateway,
  ex: SchemaExport | RendererExport,
  opts: AdoptLawOptions,
  negates: readonly string[],
): Promise<string[]> {
  if (ex.kind === "schema") {
    const lens = opts.as ?? ex.lensName;
    const resolvers =
      opts.resolvers === "withhold" ? withheldResolvers(ex.resolvers, lens) : ex.resolvers;
    let tick = 0;
    const clock = (): number => ex.timestamps[Math.min(tick++, ex.timestamps.length - 1)]!;
    const outcome = await publishRegistrationImpl(
      gw,
      ex.hyperschema,
      { ...ex.schema, name: lens, alg: ex.schema.alg ?? 1 },
      ex.roots,
      undefined,
      ex.schemaEntity,
      ex.mutations,
      ex.writable,
      resolvers,
      // Reference declarations do not ride a blessing: the manifest's schema exports carry no
      // `refs`, so an adopted lens serves without derived edge mutations (§51) until the operator
      // republishes it with a declaration of their own.
      undefined,
      { clock, negates },
    );
    if (!outcome.bound) {
      throw new Error(
        `adoption refused: the blessed law for "${lens}" persisted but does not serve — ${
          outcome.reason ?? "the store did not re-derive it"
        }`,
      );
    }
    // The POST-CONDITION, not a formality (H7: an operation must never report a success it did not
    // achieve). `outcome.bound` proves only that SOMETHING binds at (entity, lens); it never looks
    // at the body. A definition entity shared with other law resolves latest-wins by CLAIMED
    // timestamp, so a blessing can persist, report bound, and leave the lens resolving through
    // somebody else's gather program. So the address the store actually binds is compared against
    // the address that was classified, and a mismatch REFUSES — loudly, after the deltas are down
    // (append-only ground cannot take them back), rather than minting `adopted-from` over law this
    // store did not bind.
    const winner = schemaWinner(gw, lens);
    if (winner?.address !== ex.address) {
      throw new Error(
        `adoption refused after the append: "${lens}" persisted, but this store now binds ` +
          `DIFFERENT law there (${winner === undefined ? "nothing binds" : winner.deltaId}) — the ` +
          `blessed definition did not win its entity ${ex.schemaEntity}, so the blessing would be ` +
          `a provenance record over law that is not serving. The deltas persist (the ground is ` +
          `append-only); no adoption was recorded. Resolve the entity conflict and bless again.`,
      );
    }
    return [winner.deltaId];
  }
  await publishRendererImpl(
    gw,
    {
      route: ex.route,
      schemaName: ex.schemaName,
      consumes: [...ex.consumes],
      bundle: ex.bundle,
      ...(ex.writable === undefined ? {} : { writable: [...ex.writable] }),
      ...(ex.pen === undefined ? {} : { pen: ex.pen }),
    },
    undefined,
    { timestamp: ex.timestamp, negates },
  );
  // The same post-condition on the route: latest-per-route is a race too, so what the door will
  // actually serve is compared against what was classified before any provenance is minted.
  const winner = routeWinner(gw, ex.route);
  if (winner?.address !== ex.address) {
    throw new Error(
      `adoption refused after the append: the renderer at route "${ex.route}" persisted, but this ` +
        `store now serves DIFFERENT law there (${
          winner === undefined ? "nothing binds" : winner.deltaId
        }) — no adoption was recorded over law that is not serving.`,
    );
  }
  return [winner.deltaId];
}

// One record per (module version, alias, law address) — minted ONCE, so an hourly `blessAll` never
// appends narrative forever and re-running is the natural recovery for a partial one.
//
// The record INHERITS THE MANIFEST ROW'S TIMESTAMP, for the same reason the law it records inherits
// the source's (H4): a delta id hashes {author, pointers, timestamp}, so a wall-clock stamp mints a
// FRESH id on every run. That is not merely noisy — it strands the operator's own §14 retraction.
// Strike the record, re-run the adoption, and a fresh-id record reappears in the trail while the
// strike sits pointing at an id nobody mints again. With the row's timestamp the gesture re-mints
// the SAME id, so the re-append is a no-op the standing strike still covers: the withdrawal holds,
// and "minted ONCE" is true in the presence of a strike as well as in its absence.
//
// `at` therefore reads as WHEN THE MODULE SAID IT, not when the operator ran the command — stated
// plainly because the fact-side `Adoption.at` is a wall clock, and the two must not be confused.
async function record(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  ex: SchemaExport | RendererExport,
  kind: "adopted-from" | "witnessed",
  adoptedDelta: string,
): Promise<string[]> {
  // The dedup reads the trail INCLUDING STRUCK records, and that is the point: striking a provenance
  // record is the operator's §14 word that they do not want it, so a re-run must not re-assert it —
  // not even under the other record KIND, which is where a live-trail dedup let it back in (the
  // second run of a blessed row takes the `witnessed` path, whose content differs from the
  // `adopted-from` record that was struck, so it is a different delta and no id-level identity can
  // catch it). Promote-outputs deliberately reads the LIVE trail, because striking a FACT's record
  // re-opens re-promotion of the value; law is the other way round — the law is already bound, and
  // the only thing a re-run could add is narrative the operator has already refused.
  const held = readLawAdoptions(gw.reactor, gw.operatorAuthor!, { includeStruck: true }).some(
    (r) =>
      r.moduleVersion === src.version.id && r.alias === row.alias && r.lawAddress === ex.address,
  );
  if (held) return [];
  const delta = signClaims(
    lawAdoptionRecordClaims(
      {
        kind,
        from: src.from,
        ...(src.container === undefined ? {} : { container: src.container }),
        alias: row.alias,
        moduleVersion: src.version.id,
        target: row.target,
        lawAddress: ex.address,
        adoptedDelta,
        sourceDelta: ex.sourceDelta,
        producedBy: ex.producedBy,
      },
      gw.operatorAuthor!,
      row.timestamp,
    ),
    gw.options.seed!,
  );
  await gw.append([delta]);
  return [delta.id];
}

// Version skew (SPEC §27's premortem finding 6): a courtesy note, never a refusal. Scope is stated
// honestly — a sibling's bound version comes from the ADOPTION RECORDS, so a row the operator
// directly published carries no version attribution and is invisible here. `lawFrom` still reports
// its exposure; only the which-version courtesy is unavailable for it.
function skewNotes(gw: Gateway, src: Source, row: ManifestRow): string[] {
  const others = new Set<string>();
  for (const rec of readLawAdoptions(gw.reactor, gw.operatorAuthor!)) {
    if (rec.from !== src.from || rec.alias === row.alias) continue;
    if (rec.moduleVersion !== src.version.id) others.add(rec.moduleVersion);
  }
  if (others.size === 0) return [];
  return [
    `version skew: sibling law of "${src.from}" is bound from module version ` +
      `${[...others].sort().join(", ")}, while this blessing names ${src.version.id} — mixed ` +
      `versions are lawful; silently mixed ones are how a wrong-winner resolution gets blamed on ` +
      `an author who never shipped that combination`,
  ];
}

// --- bless-all: enumeration, never a distinct mechanism ------------------------------------------

interface Planned {
  readonly row: ManifestRow;
  readonly ex: SchemaExport | RendererExport;
}

/**
 * Bless every LAW row of a module version (the body of `Gateway.blessAll`). Enumeration, not a
 * second mechanism: N rows, N ordinary adoptions, N provenance records, one gesture.
 *
 * The split between "refuses the WHOLE call" and "refuses the REMAINDER" is deliberate. Everything
 * checkable is checked in a PRE-FLIGHT, before anything lands: classification (a dangling or
 * unclassifiable row), a pen-holding renderer without its flag, and a root-name COLLISION — a
 * collision is a per-row DECISION (`supersede` vs `as`), and decisions do not ride bulk gestures.
 * An unconfirmed RE-POINT refuses only its own row, because genuinely new rows in the same call
 * are unrelated to it. What can still fail MID-flight is the publish door itself (a malformed
 * definition the trial build rejects, a store fault): that refuses the remainder loudly and
 * reports which rows landed — re-running is the recovery, and idempotence makes it cheap.
 */
export async function blessAllImpl(
  gw: Gateway,
  version: ModuleVersion,
  opts: BlessAllOptions = {},
): Promise<BlessAllReport> {
  const src = sourceOf(gw, version);
  const rows = readManifest(src.members);
  const notes: string[] = [];
  const refused: string[] = [];
  const witnessed: string[] = [];
  const plan: Planned[] = [];
  const pens: string[] = [];
  const captures: string[] = [];
  const collisions: string[] = [];
  let lawRows = 0;
  // The trail is read ONCE for the whole pre-flight: it walks the ground, and re-reading it per row
  // would make a bulk gesture quadratic in the store (H8). Nothing lands during the pre-flight, so
  // one snapshot of the records is exactly as current as a per-row read would be.
  const trail = readLawAdoptions(gw.reactor, gw.operatorAuthor!);

  // PRE-FLIGHT. Classification throws for the whole call on a dangling or malformed row.
  for (const row of rows) {
    const ex = classify(src, row); // a stranger's manifest gets no silent skips
    if (ex.kind === "fact") {
      notes.push(
        `"${row.alias}" is ${ex.what} — a fact, passed over: facts bind nothing and need no ` +
          `blessing (§27.8)`,
      );
      continue;
    }
    lawRows += 1;
    if (ex.kind === "renderer" && ex.pen !== undefined && opts.pen !== true) {
      pens.push(`"${row.alias}" (route ${ex.route}, pen ${ex.pen})`);
      continue;
    }
    if (ex.kind === "schema") {
      const capture = entityCaptureRefusal(gw, ex);
      if (capture !== undefined) {
        captures.push(`"${row.alias}": ${capture}`);
        continue;
      }
    }
    // The three-way diff (unchanged / added / RE-POINTED) against the records that already exist.
    // A re-point is the supply-chain move — the alias carries the reputation and the swap inherits
    // it — so it never rides the sugar without its own confirmation.
    const repointed = trail.find(
      (r) => r.from === src.from && r.alias === row.alias && r.target !== row.target,
    );
    if (repointed !== undefined && opts.repoints?.[row.alias] !== row.target) {
      refused.push(
        `"${row.alias}" was RE-POINTED: it was blessed at ${repointed.target} and this manifest ` +
          `names ${row.target} — confirm it explicitly ({ repoints: { "${row.alias}": ` +
          `"${row.target}" } }) or bless it singly. An alias carries the reputation; the swap ` +
          `inherits it.`,
      );
      continue;
    }
    if (boundElsewhere(gw, ex) !== undefined) {
      witnessed.push(row.alias);
      continue;
    }
    const name = livingNameOf(ex, {});
    const confirmed = opts.repoints?.[row.alias] === row.target;
    const held = winnerOf(gw, ex, name);
    if (held !== undefined && held.address !== ex.address && !confirmed) {
      collisions.push(
        `"${row.alias}" would take ${ex.kind === "schema" ? `the name "${name}"` : `the route "${name}"`} ` +
          `from different-content law already bound here (${held.deltaId})`,
      );
      continue;
    }
    plan.push({ row, ex });
  }

  if (pens.length > 0) {
    throw new Error(
      `blessAll refused: ${pens.join(", ")} hold a PEN — a write-capable renderer never rides the ` +
        `bulk gesture. Re-run with { pen: true } once you mean it, or bless the rest singly. ` +
        `Nothing was blessed.`,
    );
  }
  if (captures.length > 0) {
    throw new Error(
      `blessAll refused: ${captures.join("; ")} NOTHING was blessed — an entity capture is not a ` +
        `per-row decision the operator can confirm away.`,
    );
  }
  if (collisions.length > 0) {
    throw new Error(
      `blessAll refused: ${collisions.join("; ")} — a collision is a per-row DECISION ` +
        `(supersede vs as), and decisions do not ride bulk gestures. Resolve the named row(s) ` +
        `singly and re-run; idempotence makes the re-run cheap. NOTHING was blessed.`,
    );
  }
  if (lawRows === 0) {
    throw new Error(
      `blessAll refused: this module version exports no law — every manifest row is a fact, and ` +
        `facts bind nothing (they read where they are, and cross by promote-outputs)`,
    );
  }

  // Schemas before renderers: a renderer reads a lens the store must already serve.
  plan.sort((a, b) => rank(a.ex) - rank(b.ex) || (a.row.alias < b.row.alias ? -1 : 1));
  const blessed: string[] = [];
  for (const { row, ex } of plan) {
    // A dependency pulled it in earlier in THIS call: the pre-flight could not see that, so the
    // re-check is here. Witness it (below, with the rest); never publish it twice.
    if (boundElsewhere(gw, ex) !== undefined) {
      witnessed.push(row.alias);
      continue;
    }
    try {
      // The confirmed re-points ride through: a confirmation IS the operator's consent to take the
      // living name that alias already held, so the row's own guard must see it too.
      const outcome = await adoptOne(gw, src, row, ex, {
        pen: opts.pen ?? false,
        ...(opts.repoints === undefined ? {} : { repoints: opts.repoints }),
      });
      notes.push(...outcome.notes);
      if (outcome.kind === "witnessed") witnessed.push(row.alias);
      else blessed.push(row.alias);
    } catch (err) {
      throw new Error(
        `blessAll refused the remainder at "${row.alias}": ${
          err instanceof Error ? err.message : String(err)
        } — LANDED: ${blessed.length === 0 ? "nothing" : blessed.join(", ")}. Re-run to bless the ` +
          `rest; what landed witnesses silently.`,
        { cause: err },
      );
    }
  }
  // A witness earns its provenance too — origination and exposure are DIFFERENT records, so a
  // module listing law you already trust can never claim credit for it. Minted once per
  // (version, alias, address), so an hourly `blessAll` stays silent after the first run.
  for (const row of rows) {
    if (!witnessed.includes(row.alias)) continue;
    const ex = classify(src, row); // pre-flight already proved every row classifiable
    if (ex.kind === "fact") continue;
    const held = boundElsewhere(gw, ex);
    if (held !== undefined) await record(gw, src, row, ex, "witnessed", held.deltaId);
  }
  return { blessed, witnessed: [...new Set(witnessed)], refused, notes };
}

const rank = (ex: SchemaExport | RendererExport): number => (ex.kind === "schema" ? 0 : 1);

// --- lawFrom: exposure arithmetic, never a revocation index --------------------------------------

export interface LawFromRow {
  readonly alias?: string;
  readonly address: string;
  readonly kind: "schema" | "renderer";
  /** The manifest versions that list it — set membership, deliberately not provenance. */
  readonly versions: readonly string[];
  /**
   * The upstream author RETRACTED this row inside their own container after you blessed it. The law
   * is still BOUND here — that is why the row is reported at all — and this flag is the reason to
   * look: an incident query must never answer "not exposed" about law whose author withdrew it.
   */
  readonly withdrawnAtSource?: boolean;
}

/**
 * "What law of this module does my root currently bind?" — the CONTENT-ADDRESS INTERSECTION of
 * currently-bound law with the UNION of the given versions' manifest rows (SPEC §27's premortem
 * finding 4). Arithmetic, always current, and deliberately NOT the adoption records: records
 * overcount (they outlive negated bindings; witnesses accumulate) and undercount (directly
 * published law has none, and this query reports it anyway).
 *
 * The UNION is the point: intersecting only the newest manifest would report "no exposure" for a
 * row adopted from `@1` that `@7` later dropped — the exact miss the query exists to prevent. A
 * narrower version list NARROWS from the union; it never replaces it. And exposure is not
 * origination: a common schema listed by two modules reports under both, which is the correct
 * answer to "am I exposed through M?" — ask the ledger's witnessed/adopted-from records for who
 * originated it.
 *
 * It reads for EXPOSURE, not survival, and the difference is the whole point at the one moment that
 * matters. When the upstream author RETRACTS a row inside their container, the blessing this store
 * performed is untouched — the law is still bound here, still serving. Classifying for survival made
 * the row unclassifiable and the query answered "not exposed": the safe-sounding word, at exactly
 * the moment the honest one is "yes, and the author withdrew it" — an H9 whose FALSE licenses
 * inaction. So a withdrawn row is REPORTED, flagged (`withdrawnAtSource`), never dropped. Only a
 * row that is genuinely unprovable (dangling, or bytes that classify as no law kind) exposes
 * nothing, because there is nothing it could be bound as.
 */
export function lawFromImpl(gw: Gateway, versions: readonly ModuleVersion[]): LawFromRow[] {
  const out = new Map<string, { row: LawFromRow; versions: Set<string> }>();
  for (const version of versions) {
    const src = sourceOf(gw, version, "exposure");
    for (const row of readManifest(src.members)) {
      let ex: Export;
      try {
        ex = classify(src, row);
      } catch {
        continue; // an unprovable row exposes nothing; blessing is where a row gets named
      }
      if (ex.kind === "fact") continue;
      if (boundElsewhere(gw, ex) === undefined) continue; // listed, not bound: no exposure
      const withdrawn = ex.lineage.some((id) => !src.livesAtSource(id));
      const key = [ex.kind, ex.address, row.alias].join(NUL);
      const held = out.get(key);
      if (held === undefined) {
        out.set(key, {
          row: {
            alias: row.alias,
            address: ex.address,
            kind: ex.kind,
            versions: [],
            ...(withdrawn ? { withdrawnAtSource: true } : {}),
          },
          versions: new Set([version.id]),
        });
      } else {
        held.versions.add(version.id);
        if (withdrawn) held.row = { ...held.row, withdrawnAtSource: true };
      }
    }
  }
  return [...out.values()].map((e) => ({ ...e.row, versions: [...e.versions].sort() }));
}
