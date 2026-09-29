// The host store as one substrate peer (step 6 host trial, refactor/audit/step6-host-trial.md).
// Loam's own checks run first, under the gateway's admission lock; the substrate then admits,
// records arrivals and refusals, and commits the image and the new rows together.
//
// Erasure is not on this path: the substrate reports `unsupported-erasure`, and an erasure is
// refused here rather than purged by Loam's older path while the image still admits its target.

import {
  admitSinglePeerTransfer,
  openSinglePeer,
  type ArrivalOrigin,
  type Delta,
  type DurablePeerStore,
  type SinglePeerTransferResult,
} from "@bombadil/rhizomatic";
import { imageRows } from "../store/peer-image.js";
import type { StoreBackend } from "../store/backend.js";

// One peer, one commit queue. The door and the write-through both commit to the image, and a
// compare-and-set that loses a race is a lost write, so every commit waits for the one before it.
export interface HostPeer {
  readonly store: DurablePeerStore;
  readonly peerId: string;
  tail: Promise<unknown>;
}

export function hostPeer(store: DurablePeerStore, peerId: string): HostPeer {
  return { store, peerId, tail: Promise.resolve() };
}

// A Loam author is already a canonical PeerId (`ed25519:<hex>`): the peer IS its governing key.
export const peerIdOf = (author: string): string => author;

// Open the image and return the rows it admitted, in arrival order. A store with rows and no
// image, a conflict or an unconfirmed commit refuses the open.
export async function openHostPeer(
  store: DurablePeerStore,
  peerId: string,
  backend: StoreBackend,
): Promise<Delta[]> {
  const opened = await openSinglePeer(store, peerId);
  if (opened.status === "rows-without-image") {
    throw new Error(
      "peer image: this store holds rows but no peer image, so it cannot open as a single peer. " +
        "The trial path starts only from a fresh, empty store.",
    );
  }
  if (opened.status !== "open") {
    throw new Error(`peer image: the open did not commit (${describe(opened)})`);
  }
  const order = opened.state.base.arrivals.map((a) => a.id);
  return imageRows(order, await backend.deltasSince(new Set()));
}

const LOCAL: ArrivalOrigin = { kind: "local" };
const UNATTRIBUTED: ArrivalOrigin = { kind: "unattributed" };

// A local append: all or nothing, one reason.
export async function admitLocal(
  peer: HostPeer,
  batch: readonly Delta[],
  arrivedAt: number,
  isErasure: (d: Delta) => boolean,
): Promise<void> {
  const result = await transfer(peer, batch, LOCAL, arrivedAt, isErasure, "atomic");
  if (result.status !== "committed") {
    throw new Error(`append rejected by the peer image: ${describe(result)}`);
  }
}

// A federation receive: per delta. The ids the image admitted or already held.
export async function admitReceived(
  peer: HostPeer,
  batch: readonly Delta[],
  arrivedAt: number,
  isErasure: (d: Delta) => boolean,
): Promise<Set<string>> {
  const result = await transfer(peer, batch, UNATTRIBUTED, arrivedAt, isErasure, "individual");
  if (result.status !== "committed") {
    throw new Error(`federation refused by the peer image: ${describe(result)}`);
  }
  return new Set(
    result.outcomes
      .filter((o) => o.status === "admitted" || o.status === "duplicate")
      .map((o) => o.id),
  );
}

function transfer(
  peer: HostPeer,
  offered: readonly Delta[],
  origin: ArrivalOrigin,
  arrivedAt: number,
  isErasure: (d: Delta) => boolean,
  mode: "atomic" | "individual",
): Promise<SinglePeerTransferResult> {
  const run = peer.tail.then(() =>
    admitSinglePeerTransfer(peer.store, peer.peerId, {
      offered,
      origin,
      arrivedAt,
      policyState: {},
      guards: [],
      isErasureCandidate: isErasure,
      mode,
      capacity: Number.MAX_SAFE_INTEGER,
    }),
  );
  peer.tail = run.catch(() => {});
  return run;
}

function describe(r: { status: string; reason?: string; fault?: string }): string {
  return r.reason ?? r.fault ?? r.status;
}
