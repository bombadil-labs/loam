// The host store as one substrate peer (step 6 host trial, refactor/audit/step6-host-trial.md).
// Loam's own checks run first, under the gateway's admission lock; the substrate's ordinary
// journal then admits, records arrivals and refusals, and commits a frame and the new rows.
//
// Erasure orders enter through `admitErasures`: Loam's erasure law runs first under the same lock,
// and the journal records the refusal and any purge obligation. An order travels without ordinary
// deltas beside it; Loam's purge then reports its result through `reportPurged`.

import {
  OrdinaryJournalPeer,
  type ArrivalOrigin,
  type Delta,
  type DurableOrdinaryJournalStore,
  type EffectiveErasureOrder,
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
  // Arrival history keeps erased ids; only the ones still admitted are served.
  const { base } = opened.peer.snapshot();
  const order = base.arrivals.map((a) => a.id).filter((id) => base.admitted.has(id));
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

// Erasure orders: Loam's erasure law already cleared each one under the admission lock, so the
// journal's own authorization accepts them (one order at a time; several interacting orders would
// need the rule re-expressed over each round's admitted set). Loam erases only targets it holds.
export async function admitErasureOrders(
  peer: HostPeer,
  orders: readonly EffectiveErasureOrder[],
  origin: "local" | "unattributed",
  arrivedAt: number,
  ordinary: readonly Delta[] = [],
): Promise<Set<string>> {
  const run = peer.tail.then(() =>
    peer.journal.admitErasures({
      orders,
      // One transfer: its orders are considered before its ordinary deltas (SPEC-6), so a target
      // offered beside its erasure is refused and never briefly admitted.
      ...(ordinary.length === 0 ? {} : { ordinary, capacity: Number.MAX_SAFE_INTEGER }),
      origin: origin === "local" ? LOCAL : UNATTRIBUTED,
      arrivedAt,
      policyState: {},
      guards: [],
      mode: origin === "local" ? "atomic" : "individual",
      targetBudget: Number.MAX_SAFE_INTEGER,
      // Loam's door admits an erasure of a target it does not hold: the target is refused ahead.
      advanceRefusalCap: Number.MAX_SAFE_INTEGER,
      authorize: () => true,
    }),
  );
  peer.tail = run.catch(() => {});
  const result = await run;
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status !== "committed") {
    throw new Error(`erasure refused by the peer journal: ${describe(result)}`);
  }
  return new Set(
    result.outcomes
      .filter((o) => ["effective-erasure", "admitted", "duplicate"].includes(o.status))
      .map((o) => o.id),
  );
}

// Report what Loam's purge did to `targetId`'s bytes. "removed" settles the obligation only if the
// store proves, in the same transaction, that the bytes are gone. No active obligation: nothing
// was owed (the order asserted the target absent), so nothing is reported.
export async function reportPurged(
  peer: HostPeer,
  targetId: string,
  report: { readonly status: "removed" } | { readonly status: "failed"; readonly fault: string },
): Promise<void> {
  const owed = peer.journal
    .snapshot()
    .obligations.find((o) => o.targetId === targetId && o.status !== "removed");
  if (owed === undefined) return;
  const run = peer.tail.then(() => peer.journal.reportPurge(targetId, owed.generation, report));
  peer.tail = run.catch(() => {});
  const result = await run;
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status === "absence-refuted") {
    throw new Error(`the bytes of ${targetId} are not proven gone; the purge stays owed`);
  }
  if (result.status !== "committed") {
    throw new Error(`purge report not committed: ${describe(result)}`);
  }
}

// Replace the journal's payload-bearing frames with a checkpoint of the current state, so an
// erased target's payload leaves the frames that admitted it. Its purge cannot settle before this.
export async function rebaseHostPeer(peer: HostPeer): Promise<void> {
  const run = peer.tail.then(() => peer.journal.rebase());
  peer.tail = run.catch(() => {});
  const result = await run;
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status !== "durable") {
    throw new Error(`rebase not committed: ${result.fault}`);
  }
}
