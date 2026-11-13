import type { Reactor } from "@bombadil/rhizomatic";
import type { Container } from "./container.js";
import type { Gateway } from "./gateway.js";

export type Peer = Pick<
  Gateway,
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
  | "prepareRoute"
  | "serveRoute"
  | "writeRoute"
  | "close"
  | "store"
  | "append"
  | "federate"
  | "strike"
  | "exportManifestRows"
  | "arrivalStamps"
  | "adoptLaw"
  | "prepareRead"
  | "readContribution"
  | "eraseReplica"
  | "probe"
>;

export interface UserGround {
  readonly reactor: Reactor;
  readonly operatorAuthor: string | undefined;
  watchUsers(onMoved: () => void): () => void;
}

export type PeerEntry = Omit<Container, "gateway"> & { readonly gateway?: Peer };
