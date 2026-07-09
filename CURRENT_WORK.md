# Current work — Step 0: Scaffold

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):**

- `npm run check` (prettier check + eslint + tsc typecheck + vitest run, **all** of them) is green.
- A smoke test round-trips a delta through `DeltaSet` from the real `@bombadil/rhizomatic` npm
  dependency — sign, ingest, merge, and read it back.
- CI runs that same gate on ubuntu **and** windows.

**Sub-tasks:**

- [x] `package.json` — ESM, `@bombadil/rhizomatic` dep, scripts mirroring rhizomatic's own
      (`check` = format:check + lint + typecheck + test), node >= 22; vitest bumped to ^4 (the
      v2 chain carried audit findings; v4 audits clean)
- [x] `tsconfig.json` (+ `tsconfig.build.json`) — strict, NodeNext
- [x] `eslint.config.js` (flat) + `.prettierrc.json` — match rhizomatic's settings
- [x] `test/smoke.test.ts` — the delta round-trip (tests first; this is the step's behavior)
- [x] `src/index.ts` — minimal honest export (no dead weight)
- [x] `.github/workflows/ci.yml` — ubuntu + windows matrix running `npm run check`
- [x] `npm install` + `npm run check` green locally (4 stages, 3/3 tests, 0 vulnerabilities)
- [x] Feature branch → PR #1 → adversarial review (8 finder angles) → resolved 10 findings:
      `build` added to the gate (declaration emit was unexercised), type-aware eslint
      (floating promises die at lint time before step 2's async seam), honest engines floor
      (>=22.13 — the tooling's real minimum), falsifiable merge test (overlapping non-empty
      sets), behavioral id assertion via `computeId` (no substrate-encoding regex), single
      module-scope fixtures, deduped package entry points, inert tsconfig flags dropped,
      minimal ignore files, restored CURRENT_WORK.md template intro
- [ ] CI green on the resolved PR → merge by PR number
- [ ] `JOURNAL.md` entry

**Left off here:** review resolved, gate green locally (5 stages, 3/3 tests); awaiting CI on
PR #1, then stage 6 (journal + merge).
