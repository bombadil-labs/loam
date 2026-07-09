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

// Failure semantics, uniform across drivers: every failure is a REJECTED PROMISE, never a
// synchronous throw. A delta whose id does not recompute from its claims — or that carries a
// lone surrogate, whose bytes and identity disagree — is refused, and one refusal refuses its
// whole batch, atomically. A stored row that no longer recomputes, or whose signature no longer
// verifies, is corruption: reads reject rather than laundering. After `close()`, every method
// rejects. What a store returns is the canonical form of what went in (the JSON profile's fixed
// point) — so any two drivers return byte-identical deltas.
//
// Concurrency: the durable drivers keep the DISK convergent across handles (union by id), but a
// reader holds no live view of other writers — whoever fronts a store (the Gateway) reads it
// once at open. One writing gateway per store; cross-process liveness is federation's job, not
// a file's.

export interface StoreBackend {
  // Durably store every supplied delta not already held. Idempotent by id, deduped within the
  // batch. Resolves to the count newly stored.
  append(deltas: Iterable<Delta>): Promise<number>;

  // Every stored delta whose id is not in `knownIds` — the watermark read.
  deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]>;

  // Release held resources.
  close(): Promise<void>;
}
