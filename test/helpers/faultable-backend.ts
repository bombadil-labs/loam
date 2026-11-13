import type { Delta, DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";

export class FaultableBackend extends MemoryBackend {
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
