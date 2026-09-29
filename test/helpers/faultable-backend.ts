// A memory backend whose row writes pass one hook first, on both write paths: a direct `append`
// and a journal commit. A host writes through its peer journal, so a fault fixture that only
// wrapped `append` would never fire there.

import type { Delta, DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
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

// A view of a memory backend that replaces only the probes a fault fixture is about (a purge that
// lies, a blind read, a mute probe, a pen that never empties). Everything else, the peer journal
// included, is the backend's own, so a pool, which is always its own journal peer, still opens
// over it.
export function overlay<B extends MemoryBackend>(
  backend: B,
  over: Partial<StoreBackend> & Record<string, unknown>,
): B {
  return new Proxy(backend, {
    get(target, prop) {
      if (Object.hasOwn(over, prop)) return over[prop as string];
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
    has: (target, prop) => Object.hasOwn(over, prop) || Reflect.has(target, prop),
  });
}
