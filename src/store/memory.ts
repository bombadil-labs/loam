// The in-memory driver: a DeltaSet keeping the StoreBackend contract's promises immediately.
// Nothing survives the process — this is the ephemeral tier for tests, scratch stores, and
// contract parity.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw into the rejected promise the seam promises. */
import { DeltaSet, type Delta, type DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";
import { canonicalDelta } from "./canon.js";

export class MemoryBackend implements StoreBackend {
  private set = new DeltaSet();
  private closed = false;

  private assertOpen(): void {
    if (this.closed) throw new Error("this store is closed");
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    // Canonicalize the WHOLE batch before touching the set: one refused delta refuses the lot,
    // atomically — the same all-or-nothing every driver must keep.
    const batch = [...deltas].map(canonicalDelta);
    let stored = 0;
    for (const d of batch) if (this.set.add(d)) stored += 1;
    return stored;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    for (const d of this.set) if (!knownIds.has(d.id)) out.push(d);
    return out;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    this.assertOpen();
    // DeltaSet is grow-only by design; forgetting is a rebuild from the survivors.
    const gone = new Set(ids);
    const survivors = new DeltaSet();
    let removed = 0;
    for (const d of this.set) {
      if (gone.has(d.id)) removed += 1;
      else survivors.add(d);
    }
    this.set = survivors;
    return removed;
  }

  async holds(id: string): Promise<boolean> {
    this.assertOpen();
    return this.set.has(id);
  }

  async holdsAny(): Promise<boolean> {
    this.assertOpen();
    return this.set.size > 0;
  }

  async ids(): Promise<Set<string>> {
    this.assertOpen();
    const out = new Set<string>();
    for (const d of this.set) out.add(d.id);
    return out;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  // One journal per peer: a head and its committed frames, which never change once written. The
  // compare, the frame, the head and the rows change with no await between them, so they are one
  // step for every other caller.
  private journals = new Map<string, { head: string; frames: Uint8Array[] }>();
  private store: DurableOrdinaryJournalStore | undefined;

  journalStore(): DurableOrdinaryJournalStore {
    return (this.store ??= {
      readJournal: async (peerId) => {
        this.assertOpen();
        const j = this.journals.get(peerId);
        if (j !== undefined) {
          return {
            status: "journal",
            head: j.head,
            frames: j.frames.map((f) => Uint8Array.from(f)),
          };
        }
        return this.set.size > 0 ? { status: "rows-without-journal" } : { status: "empty" };
      },
      readAdmittedRows: async (_peerId, ids) => {
        this.assertOpen();
        return ids.flatMap((id) => {
          const d = this.set.get(id);
          return d === undefined ? [] : [d];
        });
      },
      readHead: async (peerId) => {
        this.assertOpen();
        const j = this.journals.get(peerId);
        return j === undefined ? { status: "missing" } : { status: "head", head: j.head };
      },
      compareAndAppend: async (peerId, expectedHead, nextHead, frame, newlyAdmitted) => {
        this.assertOpen();
        const j = this.journals.get(peerId);
        const matches =
          expectedHead === null
            ? j === undefined && this.set.size === 0
            : j !== undefined && j.head === expectedHead;
        if (!matches) return { status: "conflict" };
        const batch = newlyAdmitted.map(canonicalDelta);
        for (const d of batch) this.set.add(d);
        const frames = j?.frames ?? [];
        if (frame !== null) frames.push(Uint8Array.from(frame));
        this.journals.set(peerId, { head: nextHead, frames });
        return { status: "durable" };
      },
    });
  }
}
