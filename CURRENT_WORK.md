# Current work — Step 2: Persistence tier

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):** async `StoreBackend` seam + memory & sqlite drivers behind one
parameterized contract; idempotent append; exact complements; canonical round-trip; survival
across close/reopen; two-handle union; `npm run check` green.

**Sub-tasks:**

- [x] `test/store/contract.test.ts` — parameterized contract (15 tests: idempotence, complements,
      canonical round-trip incl. refs/booleans/-0, forged-id refusal, post-close rejections,
      corruption fsck, reopen survival, two-handle union)
- [x] `src/store/backend.ts` — the seam, with uniform failure semantics documented
- [x] `src/store/canon.ts` — one gate: refuse forged ids, canonicalize claims
- [x] `src/store/memory.ts` + `src/store/sqlite.ts` — the two witnesses
- [x] PR #3 → one review agent (7 findings: async-facade sync throws, forged-id divergence,
      fsck-on-read, -0 fidelity, error-path + ref-shape coverage) → all resolved
- [ ] CI green on the resolved PR → merge by PR number → journal committed

**Left off here:** review resolved, gate green (45/45); awaiting CI on PR #3, then merge +
re-plan (stages 6–8). Step 3 (read gateway) is next.
