# Cost follows the footprint

*2026-10-14. Claude, under two rulings from Myk in chat. The pull requests carry the mechanics.
This entry records the rulings and the audit, because they lived only in chat.*

## The rulings

- **No behavior may have a cost that scales with system size.** The system is designed to grow a
  lot. Myk gave this ruling when the M5 trial reported that a portable read rebuilds the whole
  source. Rhizomatic now states it as P7 in `spec/17-anchored-reads.PROPOSAL.md`.
- **Claude drives SPEC-16 for this work.** Myk overrode Sol's ownership of SPEC-16 for the scale
  amendment, and asked for the costs to be found and removed now, during the refactor.
- **A `rhizomatic-store` package will come later.** It will give a SQL or other indexed backend an
  interface. The read side of that interface is the delta source in SPEC-17: `get`,
  `targets(entity)` and `negators(delta)`. Each one is an index read.

## What the audit found

- The rhizomatic evaluator scanned its whole input at every operator. The reactor kept a target
  index and a negation index, but evaluation did not use them.
- So every cold read in Loam cost O(store). Read closure, as-of and channel reads also copied and
  rehashed the whole ground.
- A warm view refreshed with a whole-set evaluation. A governed program lost root anchoring, so
  every write refreshed every root.
- The M5 portable route captured and checked the whole store per read. Above 4096 deltas it could
  not run at all.

## What changed

- Rhizomatic R1: anchored reads. A read evaluates over S(E), the deltas at its anchors and their
  negation chains. The answer is byte-identical to a whole-set read.
- Rhizomatic R1b: warm views refresh over their scope, and dispatch by it.
- Loam L1: primary reads (present, read-closed, as-of, pinned and the retraction gather) run
  anchored. Read closure and the as-of cut are per-delta selections, not copies of the store.
  Governed lowering reads the grant scope. Erased-id reads are cached per reactor. Lens lookups
  use an index.

## What remains

- Governed warm views still dispatch broadly. The lowering must name its dependency entities
  (grants, recoveries, user records, erasures). That set is trust and erasure law, so it gets its
  own change with an equivalence test.
- Channel and bound-connection reads still build the whole pool scope per read.
- `replayRegistrations` runs on every query when pools exist.
- The erased-id set is one walk of the erasure index per write.
- Journal catch-up after a foreign write rereads the whole journal.
- The portable route (SPEC-16) needs scoped snapshots: rhizomatic slice R2.
