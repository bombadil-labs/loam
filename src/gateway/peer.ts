// What one container may use of another (ruling 13). Container code holds a child only as a
// `Peer`, never as the child's `Gateway`, so this list is all that crosses between containers. The
// host is only the root container, so it is a `Peer` too, and a walk over the tree takes one type.
// The census counts the members; a change that adds one widens the boundary and must say why.

import type { Reactor } from "@bombadil/rhizomatic";
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
  // A peer refreshes its own admitted source and decides what it contributes to serving.
  | "prepareRead"
  | "readContribution"
  // Erasure: an order delivered to it, and read-only questions about the bytes it holds. The
  // container purges and settles itself; no other container reaches its store.
  | "eraseReplica"
  | "probe"
>;

/**
 * The user records a pool resolves its `user:<name>` grants against: its host's rows and governing
 * key, and a way to hear when they move. A port the opener hands the pool; the pool holds this, not
 * its host, and adds nothing to the host but a watcher it can release.
 */
export interface UserGround {
  readonly reactor: Reactor;
  readonly operatorAuthor: string | undefined;
  /** Call `onMoved` whenever the users here may have moved. Returns the release. */
  watchUsers(onMoved: () => void): () => void;
}

/** A child's handle as container code sees it: the opener's handle, with the child as a `Peer`. */
export type PeerEntry = Omit<Container, "gateway"> & { readonly gateway?: Peer };
