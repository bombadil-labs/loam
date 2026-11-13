import {
  OrdinaryJournalPeer,
  type ArrivalOrigin,
  type Delta,
  type DurableOrdinaryJournalStore,
  type EffectiveErasureOrder,
  type OrdinaryJournalAdmissionResult,
} from "@bombadil/rhizomatic";

export interface HostPeer {
  journal: OrdinaryJournalPeer;
  readonly store: DurableOrdinaryJournalStore;
  tail: Promise<unknown>;
}

export const peerIdOf = (author: string): string => author;

const OPEN_RETRIES = 5;

export async function openHostPeer(
  store: DurableOrdinaryJournalStore,
  peerId: string,
): Promise<{
  peer: HostPeer;
  rows: Delta[];
  unavailable: readonly { id: string; reason: string }[];
}> {
  let opened = await OrdinaryJournalPeer.open(store, peerId, { allowDegraded: true });
  for (let attempt = 1; opened.status === "conflict" && attempt < OPEN_RETRIES; attempt += 1) {
    opened = await OrdinaryJournalPeer.open(store, peerId, { allowDegraded: true });
  }
  if (opened.status === "conflict") throw new JournalConflict("the peer journal kept moving");
  if (opened.status === "rows-without-journal") {
    throw new Error(
      "peer journal: this store holds rows but no peer journal. It was written by an earlier " +
        "Loam, and this Loam does not carry old stores forward. Start a new store.",
    );
  }
  if (opened.status !== "open" && opened.status !== "degraded") {
    throw new Error(`peer journal: the open did not commit (${describe(opened)})`);
  }
  const available = opened.peer.availableDeltas();
  const rows = opened.peer
    .snapshot()
    .base.arrivals.map((a) => available.get(a.id))
    .filter((d): d is Delta => d !== undefined);
  return {
    peer: { journal: opened.peer, store, tail: Promise.resolve() },
    rows,
    unavailable: opened.status === "degraded" ? opened.unavailable : [],
  };
}

function queued<T>(peer: HostPeer, fn: () => Promise<T>): Promise<T> {
  const run = peer.tail.then(fn);
  peer.tail = run.catch(() => {});
  return run;
}

export class JournalConflict extends Error {}

export function reopenHostPeer(peer: HostPeer, holds: (id: string) => boolean): Promise<Delta[]> {
  return rereadHostPeer(peer).then((rows) => rows.filter((d) => !holds(d.id)));
}

export function rereadHostPeer(peer: HostPeer): Promise<Delta[]> {
  return queued(peer, async () => {
    const { peer: fresh, rows } = await openHostPeer(peer.store, peer.journal.peerId);
    peer.journal = fresh.journal;
    return rows;
  });
}

const LOCAL: ArrivalOrigin = { kind: "local" };
const UNATTRIBUTED: ArrivalOrigin = { kind: "unattributed" };

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
  return queued(peer, () =>
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
}

function describe(r: { status: string; reason?: string; fault?: string }): string {
  return r.reason ?? r.fault ?? r.status;
}

export async function admitErasureOrders(
  peer: HostPeer,
  orders: readonly EffectiveErasureOrder[],
  origin: "local" | "unattributed",
  arrivedAt: number,
  ordinary: readonly Delta[] = [],
): Promise<Set<string>> {
  const result = await queued(peer, () =>
    peer.journal.admitErasures({
      orders,
      ...(ordinary.length === 0 ? {} : { ordinary, capacity: Number.MAX_SAFE_INTEGER }),
      origin: origin === "local" ? LOCAL : UNATTRIBUTED,
      arrivedAt,
      policyState: {},
      guards: [],
      mode: origin === "local" ? "atomic" : "individual",
      targetBudget: Number.MAX_SAFE_INTEGER,
      advanceRefusalCap: Number.MAX_SAFE_INTEGER,
      authorize: () => true,
    }),
  );
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

export async function reportPurged(
  peer: HostPeer,
  targetId: string,
  report: { readonly status: "removed" } | { readonly status: "failed"; readonly fault: string },
): Promise<void> {
  const result = await queued(peer, async () => {
    const owed = peer.journal
      .snapshot()
      .obligations.find((o) => o.targetId === targetId && o.status !== "removed");
    return owed === undefined
      ? undefined
      : peer.journal.reportPurge(targetId, owed.generation, report);
  });
  if (result === undefined) return;
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status === "absence-refuted") {
    throw new Error(`the bytes of ${targetId} are not proven gone; the purge stays owed`);
  }
  if (result.status !== "committed") {
    throw new Error(`purge report not committed: ${describe(result)}`);
  }
}

export async function rebaseHostPeer(peer: HostPeer): Promise<void> {
  const result = await queued(peer, () => peer.journal.rebase());
  if (result.status === "conflict") throw new JournalConflict("the peer journal moved");
  if (result.status !== "durable") {
    throw new Error(`rebase not committed: ${result.fault}`);
  }
}
