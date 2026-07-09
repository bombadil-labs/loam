# Current work — Step 4: Mutations + subscriptions

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria:** GraphQL `mutate` (args → signed deltas → append; response = re-resolved
view; seedless refusal) and `subscribe` (initial snapshot + relevant patches; leavable streams);
`npm run check` green.

**Sub-tasks:**

- [x] `test/gateway/mutate.test.ts` + `test/gateway/subscribe.test.ts` (+ shared `fixtures.ts`)
- [x] `src/gateway/channel.ts` — the always-leavable push-to-pull adapter (+ coalescence + fail)
- [x] `src/gateway/gateway.ts` — seed option, mutate, watch (lazy cached materializations,
      sink isolation, no-op suppression, close-ends-subscriptions)
- [x] `src/gateway/gql.ts` — Mutation + Subscription derivation; PrimitiveValue input scalar;
      `__proto__` refusal
- [x] PR #5 → one review agent (7 findings: sink error isolation, close-stranded readers,
      unbounded queue → coalescence, lazy-mat name collision → NUL alphabet, `__proto__`,
      no-op patches, lifetime coverage) → all resolved
- [ ] CI green on the resolved PR → merge by PR number → journal committed

**Left off here:** review resolved, gate green (76/76); awaiting CI on PR #5, then merge +
re-plan (stages 6–8). Step 5 (accounts & capabilities, full multi-tenant) is next — plan a
small review panel for it per the budget rule.
