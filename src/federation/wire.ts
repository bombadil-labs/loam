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

export function fromWire(wire: WireDelta): Delta {
  const claims = parseClaims(wire.claims);
  const id = computeId(claims);
  if (id !== wire.id) {
    throw new Error(`federation: delta ${wire.id} does not recompute from its claims — refused`);
  }
  return makeDelta(claims, wire.sig);
}
