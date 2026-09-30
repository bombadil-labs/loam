// A pool as its whole gateway, for a rail. Container code holds a child only as a Peer (ruling 13);
// a rail is a facade over the store, and may reach a pool's gateway to build fixtures and to read
// bytes. The object behind every Peer the Store hands out is that container's Gateway.

import type { Gateway } from "../../src/gateway/gateway.js";
import type { Peer } from "../../src/gateway/peer.js";

export function gatewayOf(entry: { readonly gateway?: Peer }): Gateway {
  if (entry.gateway === undefined) {
    throw new Error("gatewayOf: this container has no gateway of its own");
  }
  return entry.gateway as Gateway;
}
