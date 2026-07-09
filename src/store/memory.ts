// The in-memory driver: a DeltaSet keeping the StoreBackend contract's promises immediately.
// Nothing survives the process — this is the ephemeral tier for tests, scratch stores, and
// contract parity.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw into the rejected promise the seam promises. */
import { DeltaSet, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";
import { canonicalDelta } from "./canon.js";

export class MemoryBackend implements StoreBackend {
  private readonly set = new DeltaSet();
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

  async close(): Promise<void> {
    this.closed = true;
  }
}
