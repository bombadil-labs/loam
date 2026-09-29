// The ordinary journal seam (step 6 host trial). A backend that can hold a peer journal offers one
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
}

export function holdsJournals(backend: StoreBackend): backend is JournalBackend {
  return typeof (backend as Partial<JournalBackend>).journalStore === "function";
}
