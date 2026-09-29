// A memory backend whose row writes pass one hook first, on both write paths: a direct `append`
// and a journal commit. A host writes through its peer journal, so a fault fixture that only
// wrapped `append` would never fire there.

import type { Delta, DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";

export class FaultableBackend extends MemoryBackend {
  /** Throw to fail the write; nothing in `batch` is then stored. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async checkWrite(batch: readonly Delta[]): Promise<void> {}

  override async append(deltas: Iterable<Delta>): Promise<number> {
    const batch = [...deltas];
    await this.checkWrite(batch);
    return super.append(batch);
  }

  #journal: DurableOrdinaryJournalStore | undefined;
  override journalStore(): DurableOrdinaryJournalStore {
    const inner = super.journalStore();
    return (this.#journal ??= {
      ...inner,
      compareAndAppend: async (peer, expected, next, frame, rows) => {
        await this.checkWrite(rows);
        return inner.compareAndAppend(peer, expected, next, frame, rows);
      },
      compareAndAppendErasure: async (peer, expected, next, frame, rows, absent) => {
        await this.checkWrite(rows);
        return inner.compareAndAppendErasure!(peer, expected, next, frame, rows, absent);
      },
    });
  }
}
