// A registration is a REFERENCE, not a carrier. The schema itself is DEFINED by schema-schema
// deltas — rhizomatic's `publishSchemaClaims` shape — filed at a schema entity (`schema:<Name>`
// by default); the registration delta, under the constitutional context `loam.registration`,
// holds only a pointer to that entity, the policy as canonical JSON, and the roots. The GraphQL
// surface is therefore GENERATED: `readRegistrations` meta-resolves each referenced entity via
// `loadSchema` over the store's surviving definitions, so evolution is append (republish at the
// same entity) and deprecation is negation (a definition with no survivor binds nothing).
//
// Policy carries no schema-schema and needs none: it is the reader's lens, not the entity's
// shape, and travels as canonical JSON (rhizomatic's own profile, so parse∘serialize is
// identity). In a governed store only the operator's law binds — definitions, registrations,
// and the negations that retire them are all read from the operator-authored slice, so a
// federated foreign delta merges as data but reshapes nothing.

import {
  DeltaSet,
  loadSchema,
  parsePolicy,
  policyToJson,
  type Claims,
  type HyperSchema,
  type Policy,
  type Primitive,
  type Reactor,
} from "@bombadil/rhizomatic";

export const CTX_REGISTRATION = "loam.registration";

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
  readonly schema: HyperSchema;
  readonly policy: Policy;
  readonly roots: readonly string[];
  // The schema entity the definition lives at. Identity is the ENTITY, not the name:
  // republishing here evolves; a different entity is a different schema.
  readonly entity?: string;
  // The write discipline, traveling with the read program.
  readonly mutations?: ClaimTemplates;
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

export const schemaEntityFor = (schema: HyperSchema, entity?: string): string =>
  entity ?? `schema:${schema.name}`;

// The registration entity for a schema entity — one registration per schema entity, latest wins.
const registrationEntity = (schemaEntity: string): string => `registration:${schemaEntity}`;

// Serialize a registration's claims: a pointer to the schema entity plus policy and roots.
// The schema-entity pointer targets the "registration" context, NEVER "definition" — the
// definition bucket is loadSchema's alone, and a registration must not masquerade in it.
export function registrationClaims(
  schemaEntity: string,
  policy: Policy,
  roots: readonly string[],
  author: string,
  timestamp: number,
  mutations?: ClaimTemplates,
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
      {
        role: "registers",
        target: {
          kind: "entity",
          entity: { id: registrationEntity(schemaEntity), context: CTX_REGISTRATION },
        },
      },
      {
        role: "schema",
        target: { kind: "entity", entity: { id: schemaEntity, context: "registration" } },
      },
      {
        role: "policy",
        target: { kind: "primitive", value: JSON.stringify(policyToJson(policy)) },
      },
      { role: "roots", target: { kind: "primitive", value: JSON.stringify(roots) } },
    ],
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
// The latest registration per schema entity names the policy and roots; `loadSchema` over the
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
  policy: Policy;
  roots: readonly string[];
  mutations?: ClaimTemplates;
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
      (p) => p.role === "schema" && p.target.kind === "entity",
    );
    const policyJson = primitive(delta.claims, "policy");
    const rootsJson = primitive(delta.claims, "roots");
    if (
      schemaRef?.target.kind !== "entity" ||
      typeof policyJson !== "string" ||
      typeof rootsJson !== "string"
    ) {
      continue; // a malformed registration binds nothing
    }
    let policy: Policy;
    let roots: string[];
    try {
      policy = parsePolicy(JSON.parse(policyJson));
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
    const schemaEntity = schemaRef.target.entity.id;
    const candidate: Candidate = {
      schemaEntity,
      policy,
      roots,
      ...(mutations === undefined ? {} : { mutations }),
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
      const schema = loadSchema(lawful, cand.schemaEntity);
      // NUL is the gateway's own alphabet (internal materialization names): a definition whose
      // name carries it — plantable only by hand, never through publishRegistration — binds
      // nothing rather than colliding with that namespace.
      if (schema.name.includes("\u0000")) continue;
      out.push({
        schema,
        policy: cand.policy,
        roots: cand.roots,
        entity: cand.schemaEntity,
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
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
      let schema: HyperSchema;
      try {
        // The SCHEMA entity the candidate references, not the registration entity it files
        // under — the same resolution readRegistrations performs.
        schema = loadSchema(lawful, cand.schemaEntity);
        // NUL is the gateway's own alphabet (see readRegistrations) — it binds nothing.
        if (schema.name.includes(String.fromCharCode(0))) continue;
      } catch {
        continue; // no surviving definition: this candidate is unbound, not fatal
      }
      n += 1;
      out.push({
        schema,
        policy: cand.policy,
        roots: cand.roots,
        entity: cand.schemaEntity,
        ...(cand.mutations === undefined ? {} : { mutations: cand.mutations }),
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
      const schema = loadSchema(lawful, cand.schemaEntity);
      out.push({ deltaId: cand.id, schemaName: schema.name });
    } catch {
      // its definition is gone too: nothing nameable remains to say "withdrawn" about
    }
  }
  return out;
}
