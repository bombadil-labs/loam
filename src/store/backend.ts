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
// lone surrogate, whose bytes and identity disagree — is refused at APPEND, and one refusal
// refuses its whole batch, atomically. A stored row that no longer recomputes, or whose
// signature no longer verifies, is never laundered onward as healthy data — but on the READ path
// the key-owning drivers (sqlite, localStorage) do not brick on it: they SET IT ASIDE into a
// quarantine and read on (SPEC §25, RepairableBackend). One bad row must never darken the whole
// store; what the quarantine holds is surfaced and settled by `loam repair`. (The archive vault
// is the deliberate exception: restored only through the mirror's loud `heal`, it still refuses a
// misfiled file rather than replant damage as health.) After `close()`, every method rejects.
// What a store returns is the canonical form of what went in (the JSON profile's fixed point) —
// so any two drivers return byte-identical deltas.
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

  // Physically remove the named ids — the deliberate, loud exception to grow-only (SPEC §11:
  // erasure). MECHANICAL, not law: a purged delta may be appended again; refusing its return
  // is the gateway's job (tombstones at admission), never a backend grudge. Unknown ids are
  // no-ops. Resolves to the count actually removed.
  purge(ids: Iterable<string>): Promise<number>;

  // Does this backend still hold bytes filed under `id`, on ANY tier it owns? The question §11
  // actually asks, asked directly instead of inferred from a read. `deltasSince` cannot stand in
  // for it: that read is DEFINED to skip what `purge` exists to find — a crash-left
  // `<id>.json.<pid>.tmp`, a misfiled copy — so a read seeing nothing proves only that nothing is
  // READABLE, and §11 promises the bytes are GONE. Conflating the two is what let an erasure report
  // completeness while the plaintext sat on a mirror tier (ticket T67).
  //
  // The invariant every driver keeps: `holds` sees at least everything `purge` reaches. Implement it
  // against the same bytes that driver's own purge sweeps, never against a bookkeeping index of what
  // this handle believes it wrote — index the work you COMPLETED, never the data you expect to FIND.
  holds(id: string): Promise<boolean>;

  // Release held resources.
  close(): Promise<void>;
}
