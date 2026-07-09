// One gate for what enters a store. A delta must be what it claims to be — its id must
// recompute from its claims (content addressing; never repaired, only refused) — and what a
// store holds is the CANONICAL form: claims passed through the JSON profile's round-trip, so
// every driver returns byte-identical deltas (JSON cannot say -0, so no driver should).
// The id is indifferent to this normalization: canonical CBOR already collapses -0 to 0.

import { claimsToJson, computeId, makeDelta, parseClaims, type Delta } from "@bombadil/rhizomatic";

export function canonicalDelta(d: Delta): Delta {
  if (computeId(d.claims) !== d.id) {
    throw new Error(`delta id ${d.id} does not match its claims — refused, never repaired`);
  }
  const claims = parseClaims(JSON.parse(JSON.stringify(claimsToJson(d.claims))));
  return makeDelta(claims, d.sig);
}
