// The ordinary journal seam. A backend that can hold a peer journal offers one
// `DurableOrdinaryJournalStore` per store object; the substrate plans, and the adapter commits the
// head, the frame and the newly admitted rows in one transaction.
//
// The journal is the authority. Rows it does not name are never served on this path, and an
// admitted id with no row fails the open.

import type { DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

export interface JournalBackend extends StoreBackend {
  journalStore(): DurableOrdinaryJournalStore;
  /** The peers whose journals live here. A journaled store opens only through its journal. */
  journalPeers(): Promise<string[]>;
  ids(): Promise<Set<string>>;
  /** Report admitted rows the journal found unavailable, the way a boot read sets rows aside (§25). */
  setAside?(rows: readonly { id: string; reason: string }[]): void;
  /** The rows beside the journal, where they differ from `ids` (a mirror: its primary tier's). */
  journalRowIds?(): Promise<Set<string>>;
  /** A wrapper answers for its inner store: false when that store keeps no journal. */
  keepsJournals?(): boolean;
}

export function holdsJournals(backend: StoreBackend): backend is JournalBackend {
  const b = backend as Partial<JournalBackend>;
  return typeof b.journalStore === "function" && (b.keepsJournals?.() ?? true);
}
