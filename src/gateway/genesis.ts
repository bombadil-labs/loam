// Genesis: the bootstrap delta-set every store is born from. It is nothing exotic — just the
// deltas that make a fresh store already governed and already registered: the operator's
// registrations, the first tenancies and grants, any function definitions. Because every delta
// is content-addressed and signed by the operator, booting the same genesis twice is idempotent
// (the second boot's deltas are the first's, by id) and authorized (the operator needs no
// grant). A store's shape is thus reproducible from a single seed value.

import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import { registrationClaims, type Registration } from "./registration.js";

export interface GenesisSpec {
  readonly operatorSeed: string;
  readonly registrations?: readonly Registration[];
  // Constitutional claims (memberships, grants) and anything else the operator plants at birth,
  // each already authored by the operator. Signed as the operator here.
  readonly grants?: readonly Claims[];
  readonly extra?: readonly Claims[];
}

export interface Genesis {
  readonly operatorSeed: string;
  readonly deltas: readonly Delta[];
}

export const STORE_ENTITY = "loam:store";
export const CTX_OPERATOR = "loam.operator";

// The genesis marker: an operator-signed delta recording who governs this store, filed at the
// store entity. It makes every booted store non-empty from birth (a store always knows its own
// operator), is idempotent (content-addressed — the same operator mints the same marker), and
// is auditable like anything else.
export function operatorMarkerClaims(operator: string): Claims {
  return {
    timestamp: 0, // fixed, so the marker is the same delta on every boot
    author: operator,
    pointers: [
      {
        role: "operator",
        target: { kind: "entity", entity: { id: STORE_ENTITY, context: CTX_OPERATOR } },
      },
      { role: "author", target: { kind: "primitive", value: operator } },
    ],
  };
}

// Assemble the genesis: every claim signed by the operator, so the whole bundle is authorized
// when it lands (the operator roots the capability chain). Always leads with the operator marker.
export function assembleGenesis(spec: GenesisSpec): Genesis {
  const seed = spec.operatorSeed;
  const operator = authorForSeed(seed);
  const deltas: Delta[] = [signClaims(operatorMarkerClaims(operator), seed)];
  let clock = 1;
  for (const reg of spec.registrations ?? []) {
    deltas.push(signClaims(registrationClaims(reg, operator, clock++), seed));
  }
  for (const claims of spec.grants ?? []) deltas.push(signClaims(claims, seed));
  for (const claims of spec.extra ?? []) deltas.push(signClaims(claims, seed));
  return { operatorSeed: seed, deltas };
}
