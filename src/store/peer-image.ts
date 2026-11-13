import type { DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

export interface JournalBackend extends StoreBackend {
  journalStore(): DurableOrdinaryJournalStore;
  journalPeers(): Promise<string[]>;
  ids(): Promise<Set<string>>;
  setAside?(rows: readonly { id: string; reason: string }[]): void;
  journalRowIds?(): Promise<Set<string>>;
  holdsAnyRow(): Promise<boolean>;
  discardJournals(): Promise<void>;
  keepsJournals?(): boolean;
}

export function holdsJournals(backend: StoreBackend): backend is JournalBackend {
  const b = backend as Partial<JournalBackend>;
  return typeof b.journalStore === "function" && (b.keepsJournals?.() ?? true);
}

export interface PoolKeySource {
  load(pool: string): string | undefined;
  create(pool: string): string;
}

export interface HoldsPoolKeys {
  poolKeys(): PoolKeySource | undefined;
}
export function holdsPoolKeys(backend: object): backend is HoldsPoolKeys {
  return typeof (backend as Partial<HoldsPoolKeys>).poolKeys === "function";
}
