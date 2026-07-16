## 2026-07-09 — Step 14: Normalization, and the gauntlet (PR #19)

Divergent dialects are normalized, never mutated. A TRANSLATION is one operator-signed delta:
a recognizer (a rhizomatic Pred over candidate deltas) beside an emit template whose holes
bind from the recognized delta's own pointers. One generic `translate()` pass renders every
lawful spec against every surviving source; each emission cites its source (`translates`
delta-ref), inherits its source's TIMESTAMP — so idempotence IS content addressing, and
re-runs mint identical ids that union swallows whole. The gauntlet closed the arc: a fifth
village store (cinelog, an alien dialect, a stranger's standing) federated into the open
almanac, one spec rendered its entries into the village's tongue, and Wren's dossier showed a
screening recorded by an app that has never heard of the village — provenance visible in the
resolved view itself. 235/235; phase 9, 4/4; the living village translates on every pulse.

Learnings worth keeping:

- **"Parses" and "runs" are different guarantees, and the gap is a landmine.** parsePred
  happily accepts inView / aliased / holes / var-root; a bare evalPred THROWS on each — so one
  publishable spec would have killed every future pass for every source. The refusal is
  structural (those constructs appear only as object KEYS in the JSON profile, so key-walking
  cannot false-positive on constants), loud at publish, defensive at read. When a validator
  and an executor come from different layers, validate against the EXECUTOR.
- **Translation must respect negation, or it resurrects the dead.** Sources come from the raw
  union; negation is a read-time mask — so a pass over `snapshot()` happily re-rendered
  facts the operator had struck, in a fresh dialect no existing negation touched. Sources now
  pass the lawful-negation filter. Any DERIVED emission over an append-only store has this
  hazard: the deriver reads the union, the readers read the masks.
- **Refuse ambiguity whole.** Two viewers, one hole: binding the first silently is a
  half-translated fact — exactly what the missing-hole rule existed to prevent. Multiplicity
  now refuses the emission (and the report distinguishes matched from unbound, so an operator
  can see "recognized but untranslatable" instead of silence).
- **The terminal rule is shape, not authorship — and that's an opt-out, said plainly.**
  `translates` is a reserved role; a source that decorates itself with one is telling
  readers where to look, and skipping it is the only loop-safe rule that doesn't reopen
  two-translator ping-pong.
