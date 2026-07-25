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
import { CTX_CONTAINER } from "./container.js";
import type { ModuleVersion } from "./container-identity.js";
import type { Gateway } from "./gateway.js";
import { publishRegistrationImpl } from "./lifecycle.js";
import {
  CTX_REGISTRATION,
  lawfulNegated,
  lensOf,
  parseClaimTemplates,
  parseResolvers,
  versionedSchemaHash,
  type ClaimTemplates,
  type LensName,
  type ResolverSpecs,
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

// The negation algebra over a version's MEMBERS ALONE — no author filter, because a module version
// IS one trust domain: the frozen set is the shipper's own, and `Gateway.freeze` carries the
// forward negation closure of what it admits (H1), so a strike that reached the members is the
// shipper's word about their own law. Same recursive rule as `lawfulNegated`: a negation retires
// its target only while it survives itself, so negating a negation revives.
function survivalOver(members: readonly Delta[]): (id: string) => boolean {
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
    memo.set(id, false); // in-progress: surviving (content addressing keeps the chain acyclic)
    const verdict = (strikes.get(id) ?? []).some((n) => !negated(n));
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

const isRendererBinding = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.context === CTX_RENDERER &&
      p.target.entity.id.startsWith("renderer:"),
  );

const isRegistrationBinding = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
  );

// Everything a row's classification needs, computed once per version.
interface Source {
  readonly version: ModuleVersion;
  readonly members: readonly Delta[];
  readonly survives: (id: string) => boolean;
  /** The surviving members as a DeltaSet — what `loadHyperSchema` / `loadSchema` gather over. */
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
  const binding = [...live]
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

// Which DECLARED container do these members live in? Asked of the attached walls by CONTAINMENT of
// the frozen set — a wall that holds every member is the ground the version was frozen over. The
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

function sourceOf(gw: Gateway, version: ModuleVersion): Source {
  const survives = survivalOver(version.members);
  const container = containerOf(gw, version);
  return {
    version,
    members: version.members,
    survives,
    dset: DeltaSet.from(version.members.filter((d) => survives(d.id))),
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
export function readLawAdoptions(reactor: Reactor, operator: string): LawAdoption[] {
  const negated = lawfulNegated(reactor, operator);
  const out: LawAdoption[] = [];
  for (const d of reactor.snapshot()) {
    if (d.claims.author !== operator || !isAdoption(d.claims)) continue;
    if (negated(d.id)) continue;
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
// silent WITNESS rather than a second publish — identity is the content address, never the living
// name (implementing it as the name would hand the root-name guard a bypass).
function boundElsewhere(gw: Gateway, ex: SchemaExport | RendererExport): Winner | undefined {
  if (ex.kind === "schema") {
    for (const v of gw.registrationVersions()) {
      if (schemaLawAddress(v.hyperschema, v.schema) === ex.address) {
        return { address: ex.address, deltaId: v.deltaId };
      }
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
  const rows = readManifest(src.members);
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
  return adoptOne(gw, src, row, ex, opts);
}

async function adoptOne(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  ex: SchemaExport | RendererExport,
  opts: AdoptLawOptions,
): Promise<AdoptionOutcome> {
  if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
    throw new Error(
      "only an operated store may adopt law (a blessing is the operator's own claim)",
    );
  }
  const notes: string[] = [...skewNotes(gw, src, row)];

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

  // Already bound, by CONTENT ADDRESS under any name: a silent witness, never a second publish.
  const already = boundElsewhere(gw, ex);
  if (already !== undefined) {
    const landed = await record(gw, src, row, ex, "witnessed", already.deltaId);
    return { alias: row.alias, kind: "witnessed", landed, notes };
  }

  // A renderer reads a LENS this store must serve (§23.4 refuses one that does not). When the
  // module exports that lens too, the blessing takes it first — the renderer is not law that
  // stands alone, and the dependency is REPORTED rather than assumed.
  if (ex.kind === "renderer" && !gw.registered.some((r) => lensOf(r) === ex.schemaName)) {
    const dependency = dependencyRow(gw, src, ex.schemaName);
    if (dependency === undefined) {
      throw new Error(
        `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", which ` +
          `this store does not serve and this module does not export — bless the schema it reads ` +
          `first, or register your own`,
      );
    }
    // The dependency is blessed under its OWN name: `as` renames the row the operator asked for,
    // never the lens its renderer reads.
    const inherited: AdoptLawOptions = {
      ...(opts.supersede === undefined ? {} : { supersede: opts.supersede }),
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
  const mayTake = opts.supersede === true || opts.as !== undefined || confirmed;

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
    const negates = held !== undefined && held.address !== ex.address ? [held.deltaId] : [];
    return publish(gw, ex, opts, negates);
  });

  const provenance = await record(gw, src, row, ex, "adopted-from", landed[0] ?? ex.sourceDelta);
  return { alias: row.alias, kind: "adopted-from", landed: [...landed, ...provenance], notes };
}

// The manifest row whose SCHEMA law provides a lens name — the dependency lookup a renderer needs.
function dependencyRow(
  gw: Gateway,
  src: Source,
  lens: string,
): { row: ManifestRow; ex: SchemaExport } | undefined {
  for (const candidate of readManifest(src.members)) {
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
      ex.resolvers,
      { clock, negates },
    );
    if (!outcome.bound) {
      throw new Error(
        `adoption refused: the blessed law for "${lens}" persisted but does not serve — ${
          outcome.reason ?? "the store did not re-derive it"
        }`,
      );
    }
    const winner = schemaWinner(gw, lens);
    return winner === undefined ? [] : [winner.deltaId];
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
  const winner = routeWinner(gw, ex.route);
  return winner === undefined ? [] : [winner.deltaId];
}

// One record per (module version, alias, law address) — minted ONCE, so an hourly `blessAll` never
// appends narrative forever and re-running is the natural recovery for a partial one.
async function record(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  ex: SchemaExport | RendererExport,
  kind: "adopted-from" | "witnessed",
  adoptedDelta: string,
): Promise<string[]> {
  const held = readLawAdoptions(gw.reactor, gw.operatorAuthor!).some(
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
      gw.nextTimestamp(),
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
 */
export function lawFromImpl(gw: Gateway, versions: readonly ModuleVersion[]): LawFromRow[] {
  const out = new Map<string, { row: LawFromRow; versions: Set<string> }>();
  for (const version of versions) {
    const src = sourceOf(gw, version);
    for (const row of readManifest(src.members)) {
      let ex: Export;
      try {
        ex = classify(src, row);
      } catch {
        continue; // an unprovable row exposes nothing; blessing is where a row gets named
      }
      if (ex.kind === "fact") continue;
      if (boundElsewhere(gw, ex) === undefined) continue; // listed, not bound: no exposure
      const key = [ex.kind, ex.address, row.alias].join(NUL);
      const held = out.get(key);
      if (held === undefined) {
        out.set(key, {
          row: { alias: row.alias, address: ex.address, kind: ex.kind, versions: [] },
          versions: new Set([version.id]),
        });
      } else {
        held.versions.add(version.id);
      }
    }
  }
  return [...out.values()].map((e) => ({ ...e.row, versions: [...e.versions].sort() }));
}
