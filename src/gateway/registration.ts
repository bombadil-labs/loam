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
  type Reactor,
} from "@bombadil/rhizomatic";

export const CTX_REGISTRATION = "loam.registration";

export interface Registration {
  readonly schema: HyperSchema;
  readonly policy: Policy;
  readonly roots: readonly string[];
  // The schema entity the definition lives at. Identity is the ENTITY, not the name:
  // republishing here evolves; a different entity is a different schema.
  readonly entity?: string;
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
): Claims {
  return {
    timestamp,
    author,
    pointers: [
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
export function readRegistrations(reactor: Reactor, operator?: string): Registration[] {
  const lawful = lawfulSnapshot(reactor, operator);
  const lawfulIds = new Set([...lawful].map((d) => d.id));
  const negated = (id: string): boolean =>
    reactor.negationsOf(id).some((negation) => lawfulIds.has(negation));

  interface Candidate {
    schemaEntity: string;
    policy: Policy;
    roots: readonly string[];
    timestamp: number;
    id: string;
  }
  const latest = new Map<string, Candidate>();
  for (const delta of lawful) {
    const files = delta.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
    );
    if (files === undefined) continue;
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
    const schemaEntity = schemaRef.target.entity.id;
    const key = files.target.kind === "entity" ? files.target.entity.id : schemaEntity;
    const candidate: Candidate = {
      schemaEntity,
      policy,
      roots,
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
      out.push({ schema, policy: cand.policy, roots: cand.roots, entity: cand.schemaEntity });
    } catch {
      // no surviving (or a malformed) definition: the registration is unbound, not fatal
    }
  }
  return out;
}
