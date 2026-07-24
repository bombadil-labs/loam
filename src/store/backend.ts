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
  // actually asks. `deltasSince` cannot stand in for it: that read is DEFINED to skip what
  // `purge` exists to find (a crash-left tmp file, a misfiled copy), so a read seeing nothing
  // proves only that nothing is READABLE, while §11 promises the bytes are GONE.
  // The invariant every driver keeps: `holds` sees at least everything `purge` reaches —
  // implemented against the bytes that driver's purge sweeps, never a bookkeeping index of what
  // this handle believes it wrote.
  holds(id: string): Promise<boolean>;

  // OPTIONAL batch companion to `holds`: of `ids`, which does this backend still hold — answered
  // in ONE pass, not one `holds` sweep per id. It exists for the tier where per-id is a cliff:
  // `heal` hands the whole accumulated tombstone set to its byte verdict, and an archive whose
  // `holds` pays a full directory sweep on every ABSENT id turns that verdict into O(dead × files).
  // A driver implements this only when its `holds` is not already cheap (the archive does; sqlite's
  // indexed lookup and memory's Set do not need to). Callers MUST fall back to per-id `holds` when
  // it is absent. It keeps `holds`'s guarantees exactly — same byte reach, same fail-closed (a tier
  // that cannot examine part of its store REJECTS rather than answer a false clean, H9).
  heldAmong?(ids: Iterable<string>): Promise<Set<string>>;

  // Release held resources.
  close(): Promise<void>;
}
