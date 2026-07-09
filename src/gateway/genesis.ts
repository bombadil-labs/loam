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

// Assemble the genesis: every claim signed by the operator, so the whole bundle is authorized
// when it lands (the operator roots the capability chain).
export function assembleGenesis(spec: GenesisSpec): Genesis {
  const seed = spec.operatorSeed;
  const operator = authorForSeed(seed);
  const deltas: Delta[] = [];
  let clock = 1;
  for (const reg of spec.registrations ?? []) {
    deltas.push(signClaims(registrationClaims(reg, operator, clock++), seed));
  }
  for (const claims of spec.grants ?? []) deltas.push(signClaims(claims, seed));
  for (const claims of spec.extra ?? []) deltas.push(signClaims(claims, seed));
  return { operatorSeed: seed, deltas };
}
