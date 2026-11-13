import type { Delta } from "@bombadil/rhizomatic";

export interface StoreBackend {
  append(deltas: Iterable<Delta>): Promise<number>;

  deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]>;

  purge(ids: Iterable<string>): Promise<number>;

  holds(id: string): Promise<boolean>;

  heldAmong?(ids: Iterable<string>): Promise<Set<string>>;

  holdsAny?(): Promise<boolean>;

  ids?(): Promise<Set<string>>;

  revision?(): Promise<string>;

  close(): Promise<void>;
}
