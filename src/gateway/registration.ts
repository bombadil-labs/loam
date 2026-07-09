// A registration is data. Schema, policy, and roots — the three inputs to `register` — are
// serialized into one delta filed at a registration entity under the constitutional context
// `loam.registration`. Because they are deltas, the GraphQL surface is a function of the store:
// a reopened gateway replays them and re-registers, with no re-registration code and no drift
// between what a store holds and what it will answer.

import {
  parsePolicy,
  parseTerm,
  policyToJson,
  termToJson,
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
}

// The registration entity for a schema name — one registration per name, latest wins.
const registrationEntity = (schemaName: string): string => `registration:${schemaName}`;

// Serialize (schema, policy, roots) into a signed registration's claims. The body and policy
// travel as canonical JSON strings (rhizomatic's own profile, so parse∘serialize is identity).
export function registrationClaims(reg: Registration, author: string, timestamp: number): Claims {
  const entity = registrationEntity(reg.schema.name);
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "registers",
        target: { kind: "entity", entity: { id: entity, context: CTX_REGISTRATION } },
      },
      { role: "schemaName", target: { kind: "primitive", value: reg.schema.name } },
      { role: "alg", target: { kind: "primitive", value: reg.schema.alg } },
      {
        role: "body",
        target: { kind: "primitive", value: JSON.stringify(termToJson(reg.schema.body)) },
      },
      {
        role: "policy",
        target: { kind: "primitive", value: JSON.stringify(policyToJson(reg.policy)) },
      },
      { role: "roots", target: { kind: "primitive", value: JSON.stringify(reg.roots) } },
    ],
  };
}

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

// Every surviving registration in the store — the latest per schema name, negations honored. In
// a governed store (an operator is named) only the operator's registrations bind, so one planted
// while the store was ungoverned cannot silently reshape the surface once an operator opens it.
export function readRegistrations(reactor: Reactor, operator?: string): Registration[] {
  const latest = new Map<string, { reg: Registration; timestamp: number; id: string }>();
  for (const delta of reactor.snapshot()) {
    const files = delta.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
    );
    if (!files) continue;
    if (reactor.negationsOf(delta.id).length > 0) continue;
    if (operator !== undefined && delta.claims.author !== operator) continue;

    const schemaName = primitive(delta.claims, "schemaName");
    const alg = primitive(delta.claims, "alg");
    const body = primitive(delta.claims, "body");
    const policy = primitive(delta.claims, "policy");
    const roots = primitive(delta.claims, "roots");
    if (
      typeof schemaName !== "string" ||
      typeof alg !== "number" ||
      typeof body !== "string" ||
      typeof policy !== "string" ||
      typeof roots !== "string"
    ) {
      continue; // a malformed registration binds nothing
    }
    const reg: Registration = {
      schema: { name: schemaName, alg, body: parseTerm(JSON.parse(body)) },
      policy: parsePolicy(JSON.parse(policy)),
      roots: JSON.parse(roots) as string[],
    };
    const prior = latest.get(schemaName);
    const candidate = { reg, timestamp: delta.claims.timestamp, id: delta.id };
    if (
      prior === undefined ||
      candidate.timestamp > prior.timestamp ||
      (candidate.timestamp === prior.timestamp && candidate.id > prior.id)
    ) {
      latest.set(schemaName, candidate);
    }
  }
  // Registrations dependency-order themselves loosely by timestamp so refs resolve on replay.
  return [...latest.values()].sort((a, b) => a.timestamp - b.timestamp).map((v) => v.reg);
}
