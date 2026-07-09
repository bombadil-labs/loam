# Current work — Step 7: Runner + genesis assembly

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Three pieces:**

1. **Registrations as deltas (audit-1 gap).** A registration is a signed delta carrying the
   schema (via `publishSchemaClaims`), the policy (`policyToJson` as a primitive), and the roots.
   `Gateway.open` replays them and re-registers — so the GraphQL surface is a function of the
   store and survives reopen with no re-registration code. `gateway.publishRegistration(...)`
   writes one (operator-only: it's constitutional).
2. **The runner.** A peer client that plays the execution role: reads stored **binding
   definitions** (a `BindingSpec` filed as a delta) from the store, installs each into a
   `DerivationHost` over the gateway's reactor with an implementation from an in-process
   registry (`fnId → DerivedFn`), and routes the gateway's ingest through the host so bindings
   fire and emit. Passive (no runner: definitions sit inert) vs animate (runner attached:
   they compute) is a `Runner.attach(gateway, impls)` call, not a fork.
3. **Genesis.** `assembleGenesis({ operator })` → the bootstrap delta-set every store is born
   from (the Tenant schema registration + operator's root standing + any fn/trigger schemas);
   `Gateway.boot(backend, genesis)` opens a fresh store already governed and registered.

**Success criteria (from CLAUDE.md):** install a derived function via the store, and on ingest
it fires and emits; passive vs animate demonstrated; genesis boots a fresh store; a reopened
store serves its registered schemas without re-registration code; `npm run check` green.

**Sub-tasks:**

- [ ] `test/runner/runner.test.ts` + `test/gateway/genesis.test.ts` — tests first
- [ ] `src/gateway/registration.ts` — registration claims + replay
- [ ] `src/gateway/gateway.ts` — `animate()` ingest routing; registration replay on open;
      `publishRegistration`; `Gateway.boot`
- [ ] `src/runner/runner.ts` — binding-definition claims, the Runner, in-process impl registry
- [ ] `src/gateway/genesis.ts` — genesis assembly
- [ ] Gate green → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
