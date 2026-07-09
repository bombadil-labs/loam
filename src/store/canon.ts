// One gate for what enters a store. A delta must be what it claims to be — its id must
// recompute from its claims (content addressing; never repaired, only refused) — and what a
// store holds is the CANONICAL form: claims passed through the JSON profile's round-trip, so
// every driver returns byte-identical deltas (JSON cannot say -0, so no driver should).
// The id is indifferent to this normalization: canonical CBOR already collapses -0 to 0.
//
// Strings must be well-formed Unicode. Canonical CBOR hashes a lone surrogate as U+FFFD, so
// two byte-different claims would share one id — a delta that is not byte-identical to its own
// identity. Such a delta is refused outright; there is no honest canonical form for it.

import { claimsToJson, computeId, makeDelta, parseClaims, type Delta } from "@bombadil/rhizomatic";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertWellFormed(node: unknown, id: string): void {
  if (typeof node === "string") {
    if (LONE_SURROGATE.test(node)) {
      throw new Error(
        `delta ${id} contains a lone surrogate — its bytes and its identity disagree; refused`,
      );
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) assertWellFormed(item, id);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      assertWellFormed(key, id);
      assertWellFormed(value, id);
    }
  }
}

export function canonicalDelta(d: Delta): Delta {
  if (computeId(d.claims) !== d.id) {
    throw new Error(`delta id ${d.id} does not match its claims — refused, never repaired`);
  }
  const json = claimsToJson(d.claims);
  assertWellFormed(json, d.id);
  const claims = parseClaims(JSON.parse(JSON.stringify(json)));
  return makeDelta(claims, d.sig);
}
