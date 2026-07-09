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

export function readRegistrations(reactor: Reactor, operator?: string): Registration[] {
  const lawful = lawfulSnapshot(reactor, operator);
  const negated = lawfulNegated(reactor, operator);

  interface Candidate {
    schemaEntity: string;
    policy: Policy;
    roots: readonly string[];
    mutations?: ClaimTemplates;
    timestamp: number;
    id: string;
  }
  const latest = new Map<string, Candidate>();
  for (const delta of lawful) {
    let key: string | undefined; // the registration entity this delta files under
    for (const p of delta.claims.pointers) {
      if (p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION) {
        key = p.target.entity.id;
        break;
      }
    }
    if (key === undefined) continue;
    if (negated(delta.id)) continue;

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
    const prior = latest.get(key);
    if (
      prior === undefined ||
      candidate.timestamp > prior.timestamp ||
      (candidate.timestamp === prior.timestamp && candidate.id > prior.id)
    ) {
      latest.set(key, candidate);
    }
  }

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
