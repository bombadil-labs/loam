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
  loadHyperSchema,
  parseSchema,
  parseTerm,
  schemaToJson,
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

export interface Registration {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
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

// The registration entity for a hyperschema entity — one registration per hyperschema entity,
// latest wins. Keys off the (now `hyperschema:`-prefixed) entity, so the registration files under
// `registration:hyperschema:<Name>`.
const registrationEntity = (schemaEntity: string): string => `registration:${schemaEntity}`;

// Serialize a registration's claims: a pointer to the hyperschema entity plus policy and roots.
// The hyperschema-entity pointer targets the "registration" context, NEVER "definition" — the
// definition bucket is loadHyperSchema's alone, and a registration must not masquerade in it.
export function registrationClaims(
  schemaEntity: string,
  schema: Schema,
  roots: readonly string[],
  author: string,
  timestamp: number,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
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
      {
        role: "registers",
        target: {
          kind: "entity",
          entity: { id: registrationEntity(schemaEntity), context: CTX_REGISTRATION },
        },
      },
      // Wire roles follow rhizomatic's 0.3 model, and the parsed `Registration` mirrors them:
      // `hyperschema` names the gather program's entity (the definition read by loadHyperSchema),
      // `schema` carries the resolution program itself.
      {
        role: "hyperschema",
        target: { kind: "entity", entity: { id: schemaEntity, context: "registration" } },
      },
      {
        role: "schema",
        target: { kind: "primitive", value: JSON.stringify(schemaToJson(schema)) },
      },
      { role: "roots", target: { kind: "primitive", value: JSON.stringify(roots) } },
    ],
  };
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
}

export function parseRegistrationInput(raw: unknown): RegistrationInput {
  const o = raw as {
    hyperschema?: { name?: unknown; alg?: unknown; body?: unknown };
    schema?: unknown;
    roots?: unknown;
    entity?: unknown;
    mutations?: unknown;
    writable?: unknown;
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
  schema: Schema;
  roots: readonly string[];
  mutations?: ClaimTemplates;
  writable?: readonly string[];
  timestamp: number;
  id: string;
}

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
    const policyJson = primitive(delta.claims, "schema");
    const rootsJson = primitive(delta.claims, "roots");
    if (
      schemaRef?.target.kind !== "entity" ||
      typeof policyJson !== "string" ||
      typeof rootsJson !== "string"
    ) {
      continue; // a malformed registration binds nothing
    }
    let schema: Schema;
    let roots: string[];
    try {
      schema = parseSchema(JSON.parse(policyJson));
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
    const schemaEntity = schemaRef.target.entity.id;
    const candidate: Candidate = {
      schemaEntity,
      schema,
      roots,
      ...(mutations === undefined ? {} : { mutations }),
      ...(writable === undefined ? {} : { writable }),
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

export function readRegistrations(reactor: Reactor, operator?: string): Registration[] {
  const lawful = lawfulSnapshot(reactor, operator);
  const groups = survivingCandidates(reactor, operator);
  const latest = new Map<string, Candidate>();
  for (const [key, group] of groups) latest.set(key, group[group.length - 1]!);

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
      out.push({
        hyperschema,
        schema: cand.schema,
        roots: cand.roots,
        entity: cand.schemaEntity,
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
        ...(cand.writable === undefined ? {} : { writable: cand.writable }),
      });
    } catch {
      // no surviving (or a malformed) definition: the registration is unbound, not fatal
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
      try {
        // The SCHEMA entity the candidate references, not the registration entity it files
        // under — the same resolution readRegistrations performs.
        hyperschema = loadHyperSchema(lawful, cand.schemaEntity);
        // NUL is the gateway's own alphabet (see readRegistrations) — it binds nothing.
        if (hyperschema.name.includes(String.fromCharCode(0))) continue;
      } catch {
        continue; // no surviving definition: this candidate is unbound, not fatal
      }
      n += 1;
      out.push({
        hyperschema,
        schema: cand.schema,
        roots: cand.roots,
        entity: cand.schemaEntity,
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
        ...(cand.writable === undefined ? {} : { writable: cand.writable }),
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
