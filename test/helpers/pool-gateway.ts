import type { Gateway } from "../../src/gateway/gateway.js";
import type { Peer } from "../../src/gateway/peer.js";

export function gatewayOf(entry: { readonly gateway?: Peer }): Gateway {
  if (entry.gateway === undefined) {
    throw new Error("gatewayOf: this container has no gateway of its own");
  }
  return entry.gateway as Gateway;
}
