# Current work — Step 1: Confirm the rhizomatic surface (the spike)

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):**

- Tests against the **real** `@bombadil/rhizomatic` dependency pass for each SPEC §2 claim Loam
  will stand on: `loadSchema` round-trips; `resolveView` across pick/all/conflicts (+merge);
  reactor materialization + `subscribe`; `DerivationHost` binding firing, emitting, replaying.
- `JOURNAL.md` records what is confirmed vs. what differs from SPEC §2; SPEC corrected.
- `npm run check` green (all stages, all tests).

**Sub-tasks:**

- [x] Read rhizomatic's own tests — learned the real call shapes (terms via `parseTerm` JSON
      profile; `register(name, term, roots)`; `DerivationHost.install(spec, fn, seed) → author`)
- [x] `test/spike/garden.ts` — shared world (two signing authors, one fern)
- [x] `test/spike/schema.test.ts` — publish→load, evolution, negation, the metacircular seed
- [x] `test/spike/resolve.test.ts` — pick/all/conflicts/merge, pluralism, stable snapshots
- [x] `test/spike/reactor.test.ts` — materializations, subscribe, dispatch, convergence, forgery
- [x] `test/spike/derivation.test.ts` — fire+emit+provenance, supersede, pure replay, budget
- [x] SPEC §2 corrections (MaterializationChange shape, subscribeRaw, unsigned-ingest note,
      conflicts nuance) + JOURNAL entry
- [x] Feature branch → PR #2 → adversarial review (4 angles: test honesty, missing coverage,
      docs accuracy, quality) → resolved 21 findings: falsifiable evolution + order tests,
      exact provenance/suspension targets, ground-truth newHex, the resolveView-over-
      materialization gateway seam, negation through the live read, subscribeRaw contract,
      late registration, multiple subscribers, schema-ref expansion + collectRefs, absentAs +
      byPred, honest narrowing (no casts), shared plantReactor, journal factually corrected
      (rhizomatic. prefix, scoped re-evaluation claim, supersede semantics, parseTerm grammar)
- [ ] CI green on the resolved PR → merge by PR number

**Left off here:** review resolved, gate green (30/30); awaiting CI on PR #2, then merge +
re-plan (stages 6-8).
