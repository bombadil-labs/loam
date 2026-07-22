// A registration is a REFERENCE, not a carrier. The HYPERSCHEMA itself is DEFINED by schema-schema
// deltas — rhizomatic's `publishHyperSchemaClaims` shape — filed at a hyperschema entity
// (`hyperschema:<Name>` by default); the registration delta, under the constitutional context `loam.registration`,
// holds only a pointer to that entity, the resolution schema as canonical JSON, and the roots. The GraphQL
// surface is therefore GENERATED: `readRegistrations` meta-resolves each referenced entity via
// `loadHyperSchema` over the store's surviving definitions, so evolution is append (republish at the
// same entity) and deprecation is negation (a definition with no survivor binds nothing).
//
// Schema carries no schema-schema and needs none: it is the reader's lens, not the entity's
// shape, and travels as canonical JSON (rhizomatic's own profile, so parse∘serialize is
// identity). In a governed store only the operator's law binds — definitions, registrations,
// and the negations that retire them are all read from the operator-authored slice, so a
// federated foreign delta merges as data but reshapes nothing.

import {
  DeltaSet,
  contentAddress,
  loadHyperSchema,
  loadSchema,
  parseSchema,
  parseTerm,
  publishSchemaClaims,
  schemaCanonicalHex,
  type Claims,
  type HyperSchema,
  type Schema,
  type Primitive,
  type Reactor,
  type Term,
} from "@bombadil/rhizomatic";

export const CTX_REGISTRATION = "loam.registration";

// The edge roles a gather DECLARES (SPEC §14 edge verbs). An `expand` in the HYPERSCHEMA's gather
// body — never the resolution Schema — is what turns a field's entity pointers into a nested child
// view; its `role` names the pointer an edge write must carry to be followed. Walking the body for
// those roles is how the surface learns a schema HAS edges (and which role links them): a gather
// with no `expand` resolves no edges, so it is offered no entity-pointer write. Only concrete
// (`exact`) roles are collected — a wildcard expand marks no single writable relation.
export function edgeRoles(body: Term): string[] {
  const roles = new Set<string>();
  const walk = (t: Term): void => {
    switch (t.kind) {
      case "expand":
        if (t.role.kind === "exact") roles.add(t.role.value);
        walk(t.of);
        break;
      case "select":
      case "mask":
      case "group":
      case "prune":
      case "resolve":
        walk(t.of);
        break;
      case "union":
        walk(t.left);
        walk(t.right);
        break;
      case "input":
      case "fix":
        break; // input gathers nothing; fix invokes another schema, walked via the registry
    }
  };
  walk(body);
  return [...roles];
}

// The first `expand` in a gather that names NO `reading` (rhizomatic 0.8 / issue #23), reported by its
// role so the refusal can point at it — or undefined when every expansion names the child's reading.
// Shares `edgeRoles`' traversal exactly, including `union`'s two arms, so no branch of a body escapes
// the check. A wildcard role has no single name; it prints as `*`.
export function readinglessExpandRole(body: Term): string | undefined {
  const walk = (t: Term): string | undefined => {
    switch (t.kind) {
      case "expand":
        if (t.reading === undefined) return t.role.kind === "exact" ? t.role.value : "*";
        return walk(t.of);
      case "select":
      case "mask":
      case "group":
      case "prune":
      case "resolve":
        return walk(t.of);
      case "union":
        return walk(t.left) ?? walk(t.right);
      case "input":
      case "fix":
        return undefined; // input gathers nothing; fix invokes another schema, checked on its own
    }
  };
  return walk(body);
}

// The write discipline (step 12): a claim template is a pointer skeleton with argument holes.
// `at` + `context` make an entity pointer (the hole takes an id; `each` takes a list of them);
// `value` takes a primitive hole or a fixed literal. One template call emits ONE delta shaped
// exactly as declared — the guarantee that makes a published schema a PROTOCOL.
export interface ClaimPointerTemplate {
  readonly role: string;
  readonly at?: { readonly arg: string };
  readonly context?: string;
  readonly value?: { readonly arg: string } | Primitive;
  readonly each?: boolean;
}
export interface ClaimTemplate {
  readonly pointers: readonly ClaimPointerTemplate[];
}
export type ClaimTemplates = Readonly<Record<string, ClaimTemplate>>;

// A custom resolver (SPEC §22): the last, optional step of a lens — `resolve(bucket) → value`,
// downstream of the Policy. The Policy keeps the epistemics (WHICH claims survive, in what order);
// the resolver overrides only the semantics (what the gathered claims MEAN as a value in this lens (SPEC §22.9: the bucket is what the Policy is given)). It
// travels on the BINDING, per field, so changing a resolver mints a new registration version (SPEC
// §22.4 at the version-delta level; folding it into the `name@hash` VersionedSchema waits for §23's
// renderer pin, exactly as §21 deferred `VersionedHyperSchema`).
//
// v1 admits RUNG (a) ONLY — bucket-pure, a function of the field's gathered deltas alone: cacheable,
// deterministic, reproducible on any peer. The higher rungs (b hyperview-scoped, c store-querying, d
// effectful) and (e) synthetics are described by SPEC §22 but not built; a resolver declaring any of
// them is refused, so a reader trusts exactly the purity the signed definition names.
export type ResolverRung = "a";

// The field's declared output TYPE (SPEC §22.6): what the doors advertise once a resolver changes
// what the value IS. The signed definition carries it so GraphQL/OpenAPI speak the field they serve —
// a resolver turning a `pick` string into a histogram must not leave the door advertising `String`.
export type ResolverOutputType = "string" | "number" | "boolean" | "list" | "object" | "bytes";
const RESOLVER_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "list",
  "object",
  "bytes",
]);

export interface ResolverSpec {
  readonly rung: ResolverRung;
  readonly type: ResolverOutputType;
  // Directly-runnable ESM (SPEC §22.3): `export default (bucket) => value`. What is audited IS what
  // runs — one hash, no signed-vs-executed gap. Inline for v1 (the snapshot doctrine's first rung).
  readonly code: string;
}
export type ResolverSpecs = Readonly<Record<string, ResolverSpec>>;

// Parse and validate the resolvers' JSON profile. Every entry must name rung (a) — the only rung v1
// builds — a known output type, and non-empty ESM. Throws on anything malformed; the caller decides
// loud (a publish refusal) vs quiet (drop from a replayed registration — the schema still binds, the
// field simply falls back to its Policy value). Field-EXISTENCE is checked by the publisher, which
// holds the schema; this validates shape alone.
export function parseResolvers(raw: unknown): ResolverSpecs {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("resolvers must be an object of per-field resolver specs");
  }
  const out: Record<string, ResolverSpec> = {};
  for (const [field, spec] of Object.entries(raw as Record<string, unknown>)) {
    const s = spec as { rung?: unknown; type?: unknown; code?: unknown } | null;
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`resolver "${field}": wants { rung, type, code }`);
    }
    if (s.rung !== "a") {
      throw new Error(
        `resolver "${field}": rung ${JSON.stringify(s.rung)} is not admitted — v1 builds bucket-pure ` +
          `rung (a) only (SPEC §22); the higher rungs and synthetics are designed but not built`,
      );
    }
    if (typeof s.type !== "string" || !RESOLVER_TYPES.has(s.type)) {
      throw new Error(`resolver "${field}": type must be one of ${[...RESOLVER_TYPES].join(", ")}`);
    }
    if (typeof s.code !== "string" || s.code.trim() === "") {
      throw new Error(`resolver "${field}": code must be non-empty runnable ESM`);
    }
    out[field] = { rung: "a", type: s.type as ResolverOutputType, code: s.code };
  }
  return out;
}

// The serving key (§21.7): the LENS name when the binding carries one, the hyperschema name in
// the degenerate case. Every door keys on this — never on the hyperschema name, which sibling
// lenses share.
//
// LensName and ProgramName are BRANDS, not runtime values — `string & {unique symbol}` erases to
// `string` at compile time, so this costs nothing and changes no bytes. Their whole job is to make
// the confusion behind hazard H6 a TYPE ERROR: `LensName === ProgramName` has no overlap, so the
// compiler refuses it. Read a program name through `programOf`, a lens name through `lensOf`, and
// type every door parameter that keys on a lens as `LensName` — then a door that gates on the
// program cannot type-check. The one residual hole is raw `r.hyperschema.name` (rhizomatic types it
// as bare `string`), which is why `programOf` exists: route through it and the brand is restored.
export type LensName = string & { readonly __lens: unique symbol };
export type ProgramName = string & { readonly __program: unique symbol };

export const lensOf = (r: { lensName?: string; hyperschema: { name: string } }): LensName =>
  (r.lensName ?? r.hyperschema.name) as LensName;

// The PROGRAM name (the hyperschema's own name) — the thing sibling lenses SHARE and doors must
// never gate on. Reading it through here rather than raw `r.hyperschema.name` restores the brand, so
// comparing it to a lens name is caught. Materializations are per-program, so this is the right key
// there and the wrong key at every door.
export const programOf = (r: { hyperschema: { name: string } }): ProgramName =>
  r.hyperschema.name as ProgramName;

export interface Registration {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  // The LENS name (§21.7 coexistence): the resolution Schema's own semantic name, read from the
  // binding's bytes (the `schema` pointer's target minus the `schema:` prefix). Defaults to the
  // hyperschema's name — today's 1:1 reading, forever the degenerate case. Serving keys on THIS
  // (GraphQL family, REST path segment, loam.public admission, the §17 ladder), never on the
  // hyperschema name, which many sibling lenses share.
  readonly lensName?: string;
  // The hyperschema entity the definition lives at (`hyperschema:<Name>` by default). Identity is
  // the ENTITY, not the name: republishing here evolves; a different entity is a different schema.
  readonly entity?: string;
  // The write discipline, traveling with the read program.
  readonly mutations?: ClaimTemplates;
  // Front-door writability (SPEC §14, immutable-by-default): when present, ONLY these fields accept
  // a surface write; the rest are read-only. Absent → NO field is writable (silence means "you may
  // not" — the deny-by-default posture §21's wave flipped in). Every registration Loam mints names
  // its writable fields explicitly.
  readonly writable?: readonly string[];
  // Custom resolvers (SPEC §22), per field — the optional last step of the lens.
  readonly resolvers?: ResolverSpecs;
}

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

// Parse and validate the templates' JSON profile. Throws on anything malformed — the caller
// decides whether that refuses a publish (loud) or drops the templates from a stored
// registration (quiet: the schema still binds; the surface just lacks the mutation).
export function parseClaimTemplates(raw: unknown): ClaimTemplates {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("mutations must be an object of named claim templates");
  }
  const out: Record<string, ClaimTemplate> = {};
  // GraphQL's own grammar for names, minus a leading underscore for templates (built-ins own
  // that space) and minus double-underscore anywhere it leads for ARGS (introspection's, and
  // "__proto__" would vanish into a plain object's prototype setter).
  const argOk = (a: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(a) && !a.startsWith("__");
  for (const [name, tpl] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`template "${name}": not a usable mutation name`);
    }
    const t = tpl as { pointers?: unknown };
    if (
      t === null ||
      typeof t !== "object" ||
      !Array.isArray(t.pointers) ||
      t.pointers.length === 0
    ) {
      throw new Error(`template "${name}": wants { pointers: [...] }, at least one`);
    }
    const pointers = t.pointers.map((p: unknown, i: number): ClaimPointerTemplate => {
      const o = p as Record<string, unknown>;
      if (
        o === null ||
        typeof o !== "object" ||
        typeof o["role"] !== "string" ||
        o["role"] === ""
      ) {
        throw new Error(`template "${name}" pointer ${i}: a pointer names a role`);
      }
      const at = o["at"] as { arg?: unknown } | undefined;
      const hasAt = at !== undefined;
      const hasValue = o["value"] !== undefined;
      if (hasAt === hasValue) {
        throw new Error(`template "${name}" pointer ${i}: exactly one of at/value`);
      }
      if (hasAt) {
        if (
          typeof at?.arg !== "string" ||
          !argOk(at.arg) ||
          typeof o["context"] !== "string" ||
          o["context"] === ""
        ) {
          throw new Error(
            `template "${name}" pointer ${i}: at wants { arg } (a usable argument name) ` +
              `and a non-empty context`,
          );
        }
        return {
          role: o["role"],
          at: { arg: at.arg },
          context: o["context"],
          ...(o["each"] === true ? { each: true } : {}),
        };
      }
      if (o["each"] === true) {
        throw new Error(`template "${name}" pointer ${i}: each belongs to entity pointers only`);
      }
      const value = o["value"];
      const hole = value as { arg?: unknown };
      if (typeof hole === "object" && hole !== null) {
        if (typeof hole.arg !== "string" || !argOk(hole.arg)) {
          throw new Error(
            `template "${name}" pointer ${i}: value hole wants { arg }, a usable argument name`,
          );
        }
        return { role: o["role"], value: { arg: hole.arg } };
      }
      if (!isPrimitive(value)) {
        throw new Error(`template "${name}" pointer ${i}: a literal value must be a primitive`);
      }
      return { role: o["role"], value };
    });
    out[name] = { pointers };
  }
  return out;
}

// The at-rest entity a hyperschema DEFINITION lives at. `hyperschema:<Name>` by default (§21): the
// prefix names what the entity holds — the gather program — and is shape-distinguishable from the
// old `schema:<Name>` form by construction, so a §20 migration can tell a pre-rename store from a
// migrated one without a per-delta version stamp. `schema:` is freed for the resolution Schema's own
// entities (a later §21 slice). An explicit `entity` always overrides the default.
export const schemaEntityFor = (hyperschema: HyperSchema, entity?: string): string =>
  entity ?? `hyperschema:${hyperschema.name}`;

// The living resolution Schema's own entity (SPEC §21): `schema:<name>`, freed for exactly this by
// slice 1's `schema:`→`hyperschema:` rename. Single-lens for now — the name is the hyperschema's,
// so one lens per gather program. A migrated store may still hold the OLD hyperschema definition at
// this id, but those deltas are negated by slice 1 and the SCHEMA_SCHEMA gather masks negations, so
// `loadSchema` here only ever sees the resolution Schema's own claims — the ids coexist, never collide.
export const schemaLivingEntityFor = (name: string): string => `schema:${name}`;

// A VersionedSchema's true name (SPEC §21 — `name@hash`): the content address of the FROZEN bytes.
// `schemaCanonicalHex` is the canonical CBOR of `props`+`default` only (name/alg are identity
// metadata, excluded), so renaming a lens never moves the version and two peers computing it agree;
// `contentAddress` bounds it to one BLAKE3 multihash — the same addressing discipline §17's version
// door already runs one rung down. The frozen bytes cannot be unsaid, so a snapshot is grow-only.
const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const versionedSchemaHash = (schema: Schema): string =>
  contentAddress(hexToBytes(schemaCanonicalHex(schema)));

export const versionedSchemaEntityFor = (name: string, schema: Schema): string =>
  `${schemaLivingEntityFor(name)}@${versionedSchemaHash(schema)}`;

// The registration entity for a hyperschema entity — one registration per hyperschema entity,
// latest wins. Keys off the (now `hyperschema:`-prefixed) entity, so the registration files under
// `registration:hyperschema:<Name>`.
const registrationEntity = (schemaEntity: string): string => `registration:${schemaEntity}`;

// The pointer context every registration-internal entity pointer wears (the hyperschema definition,
// the living Schema, the frozen snapshot). It is NOT `CTX_REGISTRATION` on purpose — that context is
// the `registers` key alone, the one pointer `survivingCandidates` groups on. `loadHyperSchema` /
// `loadSchema` re-gather at the pointed-at entity id under `definition` context, so this tag is only
// a namespace marker keeping the definition bucket clear of a registration masquerading in it.
const CTX_POINTER = "registration";

// The claims a registration BINDING carries (SPEC §21 — registration demoted to a binding). It names
// three entities and no definitions: the hyperschema gather program, the LIVING resolution Schema
// (`schema:<name>` — what the latest lens resolves and evolves against), and this version's FROZEN
// VersionedSchema snapshot (`schema:<name>@<hash>` — what §17's version door resolves an old version
// against, so v1 keeps its reading forever). Roots, mutations, and writability still ride the binding
// inline: they are serving discipline, local to a deployment, never part of the reading (§21).
export function registrationClaims(
  schemaEntity: string,
  livingEntity: string,
  snapshotEntity: string,
  roots: readonly string[],
  author: string,
  timestamp: number,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  resolvers?: ResolverSpecs,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      ...(mutations === undefined
        ? []
        : [
            {
              role: "mutations",
              target: { kind: "primitive" as const, value: JSON.stringify(mutations) },
            },
          ]),
      ...(writable === undefined
        ? []
        : [
            {
              role: "writable",
              target: { kind: "primitive" as const, value: JSON.stringify(writable) },
            },
          ]),
      // Custom resolvers ride the binding (SPEC §22): per-field runnable ESM + rung + output type,
      // so changing a resolver mints a new version. Inline JSON, the snapshot doctrine's first rung.
      ...(resolvers === undefined
        ? []
        : [
            {
              role: "resolvers",
              target: { kind: "primitive" as const, value: JSON.stringify(resolvers) },
            },
          ]),
      {
        role: "registers",
        target: {
          kind: "entity",
          entity: { id: registrationEntity(schemaEntity), context: CTX_REGISTRATION },
        },
      },
      // `hyperschema` names the gather program's entity (the definition read by loadHyperSchema);
      // `schema` names the LIVING resolution Schema entity (read by loadSchema, the latest lens);
      // `schemaVersion` names this binding's FROZEN VersionedSchema snapshot (the §17 version freeze).
      {
        role: "hyperschema",
        target: { kind: "entity", entity: { id: schemaEntity, context: CTX_POINTER } },
      },
      {
        role: "schema",
        target: { kind: "entity", entity: { id: livingEntity, context: CTX_POINTER } },
      },
      {
        role: "schemaVersion",
        target: { kind: "entity", entity: { id: snapshotEntity, context: CTX_POINTER } },
      },
      { role: "roots", target: { kind: "primitive", value: JSON.stringify(roots) } },
    ],
  };
}

// Everything a registration plants beyond the hyperschema definition (SPEC §21). The Schema, once a
// passenger quoted inline in the binding, is now a first-class entity in its own right: published
// twice — as the LIVING `schema:<name>` (which evolves on republish) and as an immutable
// VersionedSchema SNAPSHOT at its content address (which never supersedes) — and then REFERENCED by
// the binding. rhizomatic requires a published Schema to carry name+alg, so the single-lens name is
// stamped here. All four deltas (definition aside) go down together: `loadSchema` needs the entities
// present before the binding that points at them can resolve. Timestamps come from the caller's own
// monotonic clock so genesis stays idempotent and a live publish stays ordered.
export interface RegistrationDeltaClaims {
  readonly living: Claims;
  readonly snapshot: Claims;
  readonly binding: Claims;
  readonly livingEntity: string;
  readonly snapshotEntity: string;
}
export function registrationDeltaClaims(
  schemaEntity: string,
  name: string,
  schema: Schema,
  roots: readonly string[],
  author: string,
  nextTimestamp: () => number,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  resolvers?: ResolverSpecs,
): RegistrationDeltaClaims {
  const named: Schema = { ...schema, name, alg: schema.alg ?? 1 };
  const livingEntity = schemaLivingEntityFor(name);
  const snapshotEntity = versionedSchemaEntityFor(name, schema);
  const living = publishSchemaClaims(named, livingEntity, author, nextTimestamp());
  const snapshot = publishSchemaClaims(named, snapshotEntity, author, nextTimestamp());
  const binding = registrationClaims(
    schemaEntity,
    livingEntity,
    snapshotEntity,
    roots,
    author,
    nextTimestamp(),
    mutations,
    writable,
    resolvers,
  );
  return { living, snapshot, binding, livingEntity, snapshotEntity };
}

// The ONE shape every registration surface accepts — the `loam register` file, POST
// /:mount/register, and the MCP `loam_register` tool — identical to the `Registration` it yields:
//
//   { hyperschema: { name, alg?, body }, schema, roots, entity?, mutations? }
//
// The body and schema travel as rhizomatic's own JSON profiles (parse∘serialize is identity).
// Anything malformed throws a plain-English reason; each caller renders it (a CLI exit code, an
// HTTP 400, an MCP error) — so the three doors can never drift on what a registration looks like.
export interface RegistrationInput {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: string[];
  readonly entity?: string;
  readonly mutations?: ClaimTemplates;
  readonly writable?: string[];
  readonly resolvers?: ResolverSpecs;
}

export function parseRegistrationInput(raw: unknown): RegistrationInput {
  const o = raw as {
    hyperschema?: { name?: unknown; alg?: unknown; body?: unknown };
    schema?: unknown;
    roots?: unknown;
    entity?: unknown;
    mutations?: unknown;
    writable?: unknown;
    resolvers?: unknown;
  } | null;
  if (
    o === null ||
    typeof o !== "object" ||
    o.hyperschema === null ||
    typeof o.hyperschema !== "object"
  ) {
    throw new Error("register wants { hyperschema: { name, alg?, body }, schema, roots, entity? }");
  }
  const { name, alg, body } = o.hyperschema;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("register: hyperschema.name must be a non-empty string");
  }
  if (alg !== undefined && typeof alg !== "number") {
    throw new Error("register: hyperschema.alg must be a number when given");
  }
  if (!Array.isArray(o.roots) || o.roots.some((r) => typeof r !== "string")) {
    throw new Error("register: roots must be an array of entity ids");
  }
  if (o.entity !== undefined && typeof o.entity !== "string") {
    throw new Error("register: entity must be a string when given");
  }
  if (
    o.writable !== undefined &&
    (!Array.isArray(o.writable) || o.writable.some((f) => typeof f !== "string"))
  ) {
    throw new Error("register: writable must be an array of field names when given");
  }
  return {
    hyperschema: { name, alg: alg ?? 1, body: parseTerm(body) },
    schema: parseSchema(o.schema),
    roots: o.roots as string[],
    ...(o.entity === undefined ? {} : { entity: o.entity }),
    ...(o.mutations === undefined ? {} : { mutations: parseClaimTemplates(o.mutations) }),
    ...(o.writable === undefined ? {} : { writable: o.writable as string[] }),
    ...(o.resolvers === undefined ? {} : { resolvers: parseResolvers(o.resolvers) }),
  };
}

// The slice of the store whose law binds: everything when ungoverned, the operator's deltas
// when governed. Definitions, registrations, and negations are all read from this set — a
// foreign negation can no more retire the operator's schema than a foreign definition can
// replace it.
export function lawfulSnapshot(reactor: Reactor, operator?: string): DeltaSet {
  if (operator === undefined) return reactor.snapshot();
  return DeltaSet.from([...reactor.snapshot()].filter((d) => d.claims.author === operator));
}

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

// Every surviving registration, its schema GENERATED from the surviving definition deltas.
// The latest registration per schema entity names the policy and roots; `loadHyperSchema` over the
// lawful slice yields the schema itself. A registration whose definition does not survive (or
// never arrived, or is malformed) binds nothing — unbound, never a crash.
// The substrate's negation algebra, over the lawful slice — shared by every constitutional
// reader (registrations here, binding definitions in the runner): a negation retires its
// target only while it survives itself (negating the negation revives), and only LAWFUL
// negations count — a write-granted author's strike, or a federated stranger's, retires
// nothing the operator planted. Content addressing keeps the chain acyclic; memoized anyway.
export function lawfulNegated(reactor: Reactor, operator?: string): (id: string) => boolean {
  const lawfulIds = new Set([...lawfulSnapshot(reactor, operator)].map((d) => d.id));
  const memo = new Map<string, boolean>();
  const negated = (id: string): boolean => {
    const memoed = memo.get(id);
    if (memoed !== undefined) return memoed;
    memo.set(id, false); // in-progress: treat as surviving (acyclic by construction)
    const verdict = reactor
      .negationsOf(id)
      .some((negation) => lawfulIds.has(negation) && !negated(negation));
    memo.set(id, verdict);
    return verdict;
  };
  return negated;
}

interface Candidate {
  schemaEntity: string;
  // The living lens and this version's frozen snapshot — resolved to a Schema lazily by the reader
  // (latest → living, a version → snapshot), each against the lawful ground it already holds.
  livingEntity: string;
  snapshotEntity: string;
  roots: readonly string[];
  mutations?: ClaimTemplates;
  writable?: readonly string[];
  resolvers?: ResolverSpecs;
  timestamp: number;
  id: string;
}

// The entity a registration pointer names, by role — the living `schema` and the frozen
// `schemaVersion`. An entity target under this role, or undefined (a malformed binding binds nothing).
const entityRef = (claims: Claims, role: string): string | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

// The shared walk both readers stand on: every SURVIVING (lawful, non-negated) registration
// delta, grouped by the registration entity it files under, each group ascending in ground
// order — (timestamp, id), the same tie-break everywhere. readRegistrations takes the last of
// each group (the live lens); readRegistrationVersions takes them all (§17: publishing is
// append-only, and every survivor is an answerable version).
function survivingCandidates(
  reactor: Reactor,
  operator?: string,
  withdrawn?: Candidate[],
): Map<string, Candidate[]> {
  const lawful = lawfulSnapshot(reactor, operator);
  const negated = lawfulNegated(reactor, operator);
  const groups = new Map<string, Candidate[]>();
  for (const delta of lawful) {
    let key: string | undefined; // the registration entity this delta files under
    for (const p of delta.claims.pointers) {
      if (p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION) {
        key = p.target.entity.id;
        break;
      }
    }
    if (key === undefined) continue;
    // A lawfully struck registration is WITHDRAWN, not unparseable: the caller who asked for
    // the withdrawn list still gets its parsed shape (the 410 door needs the schema it named);
    // everyone else skips it exactly as before.
    const struck = negated(delta.id);
    if (struck && withdrawn === undefined) continue;

    const schemaRef = delta.claims.pointers.find(
      (p) => p.role === "hyperschema" && p.target.kind === "entity",
    );
    // The Schema no longer travels inline (SPEC §21): the binding NAMES its living entity and its
    // frozen snapshot, and the reader resolves the right one via loadSchema. A binding missing any
    // of the three references — hyperschema, living schema, snapshot — binds nothing.
    const livingEntity = entityRef(delta.claims, "schema");
    const snapshotEntity = entityRef(delta.claims, "schemaVersion");
    const rootsJson = primitive(delta.claims, "roots");
    if (
      schemaRef?.target.kind !== "entity" ||
      livingEntity === undefined ||
      snapshotEntity === undefined ||
      typeof rootsJson !== "string"
    ) {
      continue; // a malformed registration binds nothing
    }
    let roots: string[];
    try {
      roots = JSON.parse(rootsJson) as string[];
    } catch {
      continue;
    }
    // A malformed template payload is dropped QUIETLY (the schema still binds; the surface
    // just lacks the mutation) — the loud refusal belongs to publish, not replay.
    let mutations: ClaimTemplates | undefined;
    const mutationsJson = primitive(delta.claims, "mutations");
    if (typeof mutationsJson === "string") {
      try {
        mutations = parseClaimTemplates(JSON.parse(mutationsJson));
      } catch {
        mutations = undefined;
      }
    }
    // Writability is a plain string[] — a malformed payload is likewise dropped quietly, leaving
    // the schema permissive rather than refusing to bind.
    let writable: readonly string[] | undefined;
    const writableJson = primitive(delta.claims, "writable");
    if (typeof writableJson === "string") {
      try {
        const parsed: unknown = JSON.parse(writableJson);
        if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) {
          writable = parsed;
        }
      } catch {
        writable = undefined;
      }
    }
    // Resolvers (SPEC §22) are dropped QUIETLY on a malformed or unadmitted-rung payload — the schema
    // still binds, the field just falls back to its Policy value. The loud refusal belongs to publish.
    let resolvers: ResolverSpecs | undefined;
    const resolversJson = primitive(delta.claims, "resolvers");
    if (typeof resolversJson === "string") {
      try {
        resolvers = parseResolvers(JSON.parse(resolversJson));
      } catch {
        resolvers = undefined;
      }
    }
    const schemaEntity = schemaRef.target.entity.id;
    const candidate: Candidate = {
      schemaEntity,
      livingEntity,
      snapshotEntity,
      roots,
      ...(mutations === undefined ? {} : { mutations }),
      ...(writable === undefined ? {} : { writable }),
      ...(resolvers === undefined ? {} : { resolvers }),
      timestamp: delta.claims.timestamp,
      id: delta.id,
    };
    if (struck) {
      withdrawn?.push(candidate);
      continue;
    }
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }
  // Ground order within each group: (timestamp, id) ascending — the same tie-break the
  // latest-wins reader has always used, so "last of the group" IS the historical answer.
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return groups;
}

// The gateway's NUL alphabet, restated locally (this module must not import gateway.ts).
const NUL_SEP = String.fromCharCode(0);

// The lens name a binding carries in its own bytes: the living `schema:<name>` pointer's target,
// minus the prefix (slice 2prime put it there). A binding predating the prefix convention falls
// back to the whole id — one name per entity, the conservative pre-coexistence regrouping.
const lensNameOf = (cand: Candidate): string =>
  cand.livingEntity.startsWith("schema:")
    ? cand.livingEntity.slice("schema:".length)
    : cand.livingEntity;

export function readRegistrations(reactor: Reactor, operator?: string): Registration[] {
  const lawful = lawfulSnapshot(reactor, operator);
  const groups = survivingCandidates(reactor, operator);
  // Latest-wins narrows to latest-PER-LENS (§21.7): within one registration entity's group, each
  // lens name (the living `schema:<name>` pointer, in the bytes since slice 2prime) keeps its own
  // latest survivor — registering FilmClassic no longer evicts Film. A pre-coexistence store's
  // bindings all carry one lens name per entity, so this reads exactly as the old latest-wins did.
  const latest = new Map<string, Candidate>();
  for (const [key, group] of groups) {
    for (const cand of group) {
      latest.set([key, lensNameOf(cand)].join(NUL_SEP), cand); // ground order: last write wins
    }
  }

  // Loosely dependency-ordered by timestamp so refs tend to resolve on replay; the gateway's
  // fixpoint handles what order cannot (ties, forward refs).
  const out: Registration[] = [];
  for (const cand of [...latest.values()].sort((a, b) => a.timestamp - b.timestamp)) {
    try {
      const hyperschema = loadHyperSchema(lawful, cand.schemaEntity);
      // NUL is the gateway's own alphabet (internal materialization names): a definition whose
      // name carries it — plantable only by hand, never through publishRegistration — binds
      // nothing rather than colliding with that namespace.
      if (hyperschema.name.includes("\u0000")) continue;
      // The LIVE lens resolves against the latest SURVIVING binding's own frozen snapshot (SPEC §21) —
      // NOT the living `schema:<name>` entity. The distinction bites under withdrawal: striking the
      // latest registration must revert the live surface to the prior version, but the struck binding's
      // living-entity publish is not itself negated, so the living entity would stay ahead of the
      // surviving binding and keep serving a withdrawn shape. Resolving each surviving binding against
      // ITS snapshot keeps the live reading and the version door in lockstep — the snapshot of the
      // latest survivor IS the current reading, and it recedes exactly when its binding is withdrawn.
      // (The living entity remains a first-class, directly-loadable node; it just is not the read path.)
      const schema = loadSchema(lawful, cand.snapshotEntity);
      out.push({
        hyperschema,
        schema,
        roots: cand.roots,
        entity: cand.schemaEntity,
        lensName: lensNameOf(cand),
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
        ...(cand.writable === undefined ? {} : { writable: cand.writable }),
        ...(cand.resolvers === undefined ? {} : { resolvers: cand.resolvers }),
      });
    } catch {
      // no surviving (or a malformed) definition/schema: the registration is unbound, not fatal
    }
  }
  return out;
}

// One answerable version of a registration (SPEC §17): the Nth surviving registration for its
// entity, in ground order. `deltaId` is the version's TRUE NAME — the registration delta's
// content address; the `version` number is the derived, human-friendly alias, and it SHIFTS
// when an earlier version is withdrawn (struck): aliases are conveniences, the hash never lies.
export interface RegistrationVersion extends Registration {
  readonly version: number;
  readonly deltaId: string;
  readonly timestamp: number;
}

// Every answerable version of every registration, ascending per entity. A version pins the
// REGISTRATION — policy and roots, the lens's resolution discipline. The schema definition
// resolves as currently defined: its identity is the ENTITY (see Registration), and evolving
// a definition in place is the same append-only story one level down.
export function readRegistrationVersions(
  reactor: Reactor,
  operator?: string,
): RegistrationVersion[] {
  const lawful = lawfulSnapshot(reactor, operator);
  const out: RegistrationVersion[] = [];
  for (const group of survivingCandidates(reactor, operator).values()) {
    let n = 0;
    for (const cand of group) {
      let hyperschema: HyperSchema;
      let schema: Schema;
      try {
        // The SCHEMA entity the candidate references, not the registration entity it files
        // under — the same resolution readRegistrations performs.
        hyperschema = loadHyperSchema(lawful, cand.schemaEntity);
        // NUL is the gateway's own alphabet (see readRegistrations) — it binds nothing.
        if (hyperschema.name.includes(String.fromCharCode(0))) continue;
        // A VERSION freezes against ITS OWN snapshot (SPEC §21/§17) — never the living entity — so
        // v1 keeps resolving an evolved field with its old reading long after the living Schema has
        // moved on. This IS §17's per-version freezing, now a named, content-addressed entity.
        schema = loadSchema(lawful, cand.snapshotEntity);
      } catch {
        continue; // no surviving definition/snapshot: this candidate is unbound, not fatal
      }
      n += 1;
      out.push({
        hyperschema,
        schema,
        roots: cand.roots,
        entity: cand.schemaEntity,
        lensName: lensNameOf(cand),
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
        ...(cand.writable === undefined ? {} : { writable: cand.writable }),
        ...(cand.resolvers === undefined ? {} : { resolvers: cand.resolvers }),
        version: n,
        deltaId: cand.id,
        timestamp: cand.timestamp,
      });
    }
  }
  // Total order: (timestamp, deltaId) — boot-stable even when timestamps tie across entities,
  // so vN aliasing downstream never rides Map iteration order.
  return out.sort(
    (a, b) =>
      a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0),
  );
}

// A WITHDRAWN registration: it was lawful, the operator struck it, the ground remembers. The
// 410 door (SPEC §17) answers from this list and ONLY this list — a hash that was never a
// lawful registration here is a plain 404, whatever bytes it names.
export interface WithdrawnRegistration {
  readonly deltaId: string;
  readonly schemaName: string;
}

export function readWithdrawnRegistrations(
  reactor: Reactor,
  operator?: string,
): WithdrawnRegistration[] {
  const lawful = lawfulSnapshot(reactor, operator);
  const withdrawn: Candidate[] = [];
  survivingCandidates(reactor, operator, withdrawn);
  const out: WithdrawnRegistration[] = [];
  for (const cand of withdrawn) {
    try {
      const schema = loadHyperSchema(lawful, cand.schemaEntity);
      out.push({ deltaId: cand.id, schemaName: schema.name });
    } catch {
      // its definition is gone too: nothing nameable remains to say "withdrawn" about
    }
  }
  return out;
}
