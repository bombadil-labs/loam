// The host store as one substrate peer (step 6 host trial, refactor/audit/step6-host-trial.md).
// Loam's own checks run first, under the gateway's admission lock; the substrate's ordinary
// journal then admits, records arrivals and refusals, and commits a frame and the new rows.
//
// Erasure is not on this path: the substrate reports `unsupported-erasure`, and an erasure is
// refused here rather than purged by Loam's older path while the journal still admits its target.

import {
  OrdinaryJournalPeer,
  type ArrivalOrigin,
  type Delta,
  type DurableOrdinaryJournalStore,
  type OrdinaryJournalAdmissionResult,
} from "@bombadil/rhizomatic";

// One peer, one commit queue. The door and the write-through both commit, and the journal peer
// asks its caller to serialize writers.
export interface HostPeer {
  journal: OrdinaryJournalPeer;
  readonly store: DurableOrdinaryJournalStore;
  tail: Promise<unknown>;
}

// A Loam author is already a canonical PeerId (`ed25519:<hex>`): the peer IS its governing key.
export const peerIdOf = (author: string): string => author;

// Open the journal. Returns the peer and the rows it admitted, in arrival order.
export async function openHostPeer(
  store: DurableOrdinaryJournalStore,
  peerId: string,
): Promise<{ peer: HostPeer; rows: Delta[] }> {
  const opened = await OrdinaryJournalPeer.open(store, peerId);
  if (opened.status === "rows-without-journal") {
    throw new Error(
      "peer journal: this store holds rows but no peer journal, so it cannot open as a single " +
        "peer. The trial path starts only from a fresh, empty store.",
    );
  }
  if (opened.status !== "open") {
    throw new Error(`peer journal: the open did not commit (${describe(opened)})`);
  }
  const order = opened.peer.snapshot().base.arrivals.map((a) => a.id);
  const byId = new Map((await store.readAdmittedRows(peerId, order)).map((d) => [d.id, d]));
  const rows = order.map((id) => byId.get(id)!);
  return { peer: { journal: opened.peer, store, tail: Promise.resolve() }, rows };
}

// Another writer moved the journal's head. Nothing was admitted or refused; the caller reopens,
// re-runs its checks and retries with the same receive time and origin.
export class JournalConflict extends Error {}

// Reopen at the latest head. Returns the admitted rows this process does not hold yet, in arrival
// order.
export async function reopenHostPeer(
  peer: HostPeer,
  holds: (id: string) => boolean,
): Promise<Delta[]> {
  const { peer: fresh, rows } = await openHostPeer(peer.store, peer.journal.peerId);
  peer.journal = fresh.journal;
  return rows.filter((d) => !holds(d.id));
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
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status !== "committed") {
    throw new Error(`append rejected by the peer journal: ${describe(result)}`);
  }
}

// A federation receive: per delta. The ids the journal admitted or already held.
export async function admitReceived(
  peer: HostPeer,
  batch: readonly Delta[],
  arrivedAt: number,
  isErasure: (d: Delta) => boolean,
): Promise<Set<string>> {
  const result = await transfer(peer, batch, UNATTRIBUTED, arrivedAt, isErasure, "individual");
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status !== "committed") {
    throw new Error(`federation refused by the peer journal: ${describe(result)}`);
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
): Promise<OrdinaryJournalAdmissionResult> {
  const run = peer.tail.then(() =>
    peer.journal.admit({
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
