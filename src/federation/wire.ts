// The federation wire format: a delta as JSON. Claims travel through rhizomatic's JSON profile
// (the same canonical form the store keeps), the id and signature as strings. Reconstruction
// recomputes the id from the claims and refuses anything that does not match — a forgery cannot
// survive the crossing, whatever a peer claims its id to be.

import { claimsToJson, computeId, makeDelta, parseClaims, type Delta } from "@bombadil/rhizomatic";

export interface WireDelta {
  readonly id: string;
  readonly claims: unknown;
  readonly sig?: string;
}

export function toWire(delta: Delta): WireDelta {
  return {
    id: delta.id,
    claims: claimsToJson(delta.claims),
    ...(delta.sig === undefined ? {} : { sig: delta.sig }),
  };
}

// Reconstruct a delta from the wire, refusing one whose claims do not recompute to its id.
export function fromWire(wire: WireDelta): Delta {
  const claims = parseClaims(wire.claims);
  const id = computeId(claims);
  if (id !== wire.id) {
    throw new Error(`federation: delta ${wire.id} does not recompute from its claims — refused`);
  }
  return makeDelta(claims, wire.sig);
}
