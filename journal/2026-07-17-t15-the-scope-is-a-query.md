## 2026-07-17 — T15: the scope is a query

The container primitive's first implementation slice
([#132](https://github.com/bombadil-labs/loam/pull/132)): membership stops being configuration and
becomes what §27.6 decided it always was — a rhizomatic Term evaluated over the ground, static
(`select`) or live (`watch`), local today, remote when federation wants it. The framing the design
pinned turned out to be the implementation: `select` IS `offeredDeltas` parameterized, and it lives
in `ingest.ts` two functions below it.

The satisfying part was how little new mechanism the slice needed. `watch` rides the same Channel
the entity streams ride (coalescing to the newest membership, detaching on return); the quarantine's
membership Term is a wrapper over the same federate-with-admit path the predicate knob already
walked, with T16's tombstone pass-through applying verbatim — a scope narrows what a pool *sees*,
never what it must *forget*, and the rail that proves it is the §24.8 byte-for-byte assertion
re-aimed at a Term-seeded pool. The 0.6.0 boundary held without friction: difference and intersect
composed at the Term layer (nested difference through the seeding edge, live-following — the
depth-1 `inView` idiom's impossible case) and nothing ever wanted them inside a predicate.

One honest wrinkle recorded in the rails: a non-dset refusal has two voices — a term that cannot
even evaluate rootless is refused by the evaluator itself (E9), one that evaluates to the wrong
sort by `select`'s own check. Both are the door being loud; the rail asserts the refusal, not the
wording.

Six rails, five red-first; 647 tests; the village's trial-pool act
(`phase-membership.mjs`: a scope said as algebra, live-followed, erased through, dropped) — 30 acts
in the fresh sweep. Deferred exactly as the ticket ordered: the module manifest, Merkle-set
identity, trust-on-load, the §27.7 lifting. Next in queue: T18, the last audit-2 finding pair.
