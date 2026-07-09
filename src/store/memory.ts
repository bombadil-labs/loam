// The in-memory driver: a DeltaSet keeping the StoreBackend contract's promises immediately.
// Nothing survives the process — this is the ephemeral tier for tests, scratch stores, and
// contract parity.

import { DeltaSet, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

export class MemoryBackend implements StoreBackend {
  private readonly set = new DeltaSet();

  append(deltas: Iterable<Delta>): Promise<number> {
    let stored = 0;
    for (const d of deltas) if (this.set.add(d)) stored += 1;
    return Promise.resolve(stored);
  }

  deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    const out: Delta[] = [];
    for (const d of this.set) if (!knownIds.has(d.id)) out.push(d);
    return Promise.resolve(out);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
