# Current work — Step 4: Mutations + subscriptions

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):**

- **`mutate`**: GraphQL mutation fields derived per registered schema — one field per schema,
  one argument per policy prop; each provided arg becomes a signed property-claim delta
  (`subject → {entity, context: prop}` + `value → primitive`), appended through the same
  validated write-through path. The mutation returns the re-resolved view, so the response IS
  the re-query. A gateway without a signing seed refuses mutations.
- **`subscribe`**: GraphQL subscription fields per schema — an initial snapshot event, then a
  patch event per relevant change (`_fromHex → _hex`, `changedProps`, and the fields). Backed
  by a lazily-created, cached materialization per (schema, entity) (the reactor has no
  deregister; reuse is the design). Irrelevant mutations emit nothing.
- _Success (from CLAUDE.md):_ a mutation appends the right deltas (verifiable, signed,
  persisted) and a re-query reflects them; a subscription emits an initial snapshot then a
  patch on a relevant mutation.
- `npm run check` green.

**Sub-tasks:**

- [ ] `test/gateway/mutate.test.ts` — tests first: right deltas (pointers/signature/persistence),
      re-query reflects, multi-prop mutation, seedless refusal, receipt
- [ ] `test/gateway/subscribe.test.ts` — initial snapshot + patch; irrelevant silence;
      two subscribers; unsubscribe stops delivery
- [ ] `src/gateway/gateway.ts` — signing seed option; `mutate` path; subscription
      materialization cache + fan-out
- [ ] `src/gateway/gql.ts` — Mutation + Subscription types derived from the registered defs
- [ ] Gate green → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
