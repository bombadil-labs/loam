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
- [ ] Feature branch → PR → adversarial review → resolve → merge

**Left off here:** all spike tests green (24 total incl. smoke); docs updated; next is the full
gate, then branch + PR (stage 4).
