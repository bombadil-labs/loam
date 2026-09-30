// What one container may use of another (ruling 13). Container code holds a child only as a
// `Peer`, never as the child's `Gateway`, so this list is all that crosses between containers. The
// host is only the root container, so it is a `Peer` too, and a walk over the tree takes one type.
// The census counts the members; a change that adds one widens the boundary and must say why.

import type { Container } from "./container.js";
import type { Gateway } from "./gateway.js";

export type Peer = Pick<
  Gateway,
  // Reads: the rows, the container's clock, its governing key, and what it binds and serves.
  | "reactor"
  | "validityNow"
  | "operatorAuthor"
  | "localAuthors"
  | "lawAuthors"
  | "registered"
  | "registrationVersions"
  | "renderers"
  | "surface"
  | "isPublicPin"
  | "envelope"
  | "poolHandle"
  | "probation"
  // The container serves its own app when a door routes to it.
  | "prepareRoute"
  | "serveRoute"
  | "writeRoute"
  // Lifecycle, and the tree's shared services.
  | "close"
  | "store"
  // Its doors, which admit deltas their authors signed.
  | "append"
  | "federate"
  // Operations it performs with its own key when another container asks. No container holds
  // another's key or signs in its name (ruling 11).
  | "strike"
  | "exportManifestRows"
  | "arrivalStamps"
  | "adoptLaw"
  // It refreshes what it derives from its own law.
  | "preloadResolvers"
  | "replayRegistrations"
  // Erasure: an order delivered to it, and read-only questions about the bytes it holds. The
  // container purges and settles itself; no other container reaches its store.
  | "eraseReplica"
  | "probe"
>;

/** A child's handle as container code sees it: the opener's handle, with the child as a `Peer`. */
export type PeerEntry = Omit<Container, "gateway"> & { readonly gateway?: Peer };
