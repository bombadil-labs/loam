# Current work — Step 3: Read gateway

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):**

- A `Gateway` that fronts one `StoreBackend`: boots by replaying `deltasSince(∅)` into a
  `Reactor`; `append` ingests + writes through to the backend (via `subscribeRaw`, so future
  derivation emissions persist by the same path); `loadSchema(deltas, entity)` appends
  schema-defining deltas and meta-resolves them via `SCHEMA_SCHEMA`; `register(schema, policy,
  roots)` holds a live materialization per root.
- A GraphQL schema **derived from `HyperSchema` + `Policy`**: one query field + object type per
  registered schema; field names from `Policy.props` (+ observed props); field shapes from the
  `PropPolicy` kind (pick → scalar, all/conflicts → list, merge → number/boolean, absentAs →
  inner shape); every view type carries `_entity: ID!` and `_hex: String!` (the content-addressed
  snapshot).
- _Success (from CLAUDE.md):_ define a schema via `loadSchema` (meta-resolved through
  `SCHEMA_SCHEMA`); append deltas; a GraphQL query returns the resolved view; its snapshot hash
  is stable (same deltas any order → same `_hex`); and it all survives close/reopen on the
  sqlite backend.
- `npm run check` green.

**Sub-tasks:**

- [ ] `test/gateway/read.test.ts` — tests first: boot/replay, append + re-query, loadSchema,
      policy-shaped fields, stable `_hex`, order-independence, sqlite reopen survival,
      write-through completeness
- [ ] `src/gateway/gateway.ts` — the Gateway (backend + reactor + write-through + loadSchema +
      register)
- [ ] `src/gateway/gql.ts` — HyperSchema + Policy → GraphQLSchema; resolveView over
      materializations
- [ ] `graphql` dependency; exports from `src/index.ts`
- [ ] Gate green → branch → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
