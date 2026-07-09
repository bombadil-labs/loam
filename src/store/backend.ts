// The persistence seam. Loam persists a grow-only set of content-addressed deltas; correctness
// rides the CRDT (merge is union, any interleaving converges), so a backend is correct exactly
// as long as it preserves "a set of deltas, deduped by id." The interface is the asset; every
// driver is an interchangeable witness to it (test/store/contract.test.ts is the contract).
//
// The seam is async from birth: a hosted or networked store cannot be otherwise, and the local
// drivers simply keep their promises quickly. It is delta-level only — append and the watermark
// read are one primitive serving durable persistence and remote sync alike. `deltasSince` takes
// a set of ids, not a sequence number: watermarks are order-free, so a delta arriving mid-sync
// is never skipped.

import type { Delta } from "@bombadil/rhizomatic";

export interface StoreBackend {
  // Durably store every supplied delta not already held. Idempotent by id, deduped within the
  // batch. Resolves to the count newly stored.
  append(deltas: Iterable<Delta>): Promise<number>;

  // Every stored delta whose id is not in `knownIds` — the watermark read.
  deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]>;

  // Release held resources. Further use of the handle is undefined.
  close(): Promise<void>;
}
