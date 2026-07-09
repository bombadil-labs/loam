# Current work — Step 0: Scaffold

_The live checklist for the step in progress. Replaced at the start of each step; cleared when a step merges._

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
- [ ] Feature branch → PR → adversarial review → resolve → merge
- [ ] `JOURNAL.md` entry

**Left off here:** gate green locally on branch `step-0-scaffold`; next is stage 4 (push + PR),
then stage 5 (adversarial review).
