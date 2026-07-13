## 6. Functions & the runner (roles across a hub + a flat ring)

The reactive substrate is three **roles**, not three layers:

- **Core** (rhizomatic + Loam's store) natively holds functions-as-data and signals readiness
  (`DerivationHost` + reactor materializations). It never runs foreign code beyond what a binding's
  `fn` is.
- **The runner** — a **peer client / sibling app**, reusable and domain-agnostic — plays
  the **execution role**: subscribes to ready-to-fire bindings, executes the implementation in its
  runtime, appends outputs. Sandboxing (object-capability confinement — `isolated` bodies in a SES /
  Worker / wasm compartment, required for federated code), effect handling, and termination budgets
  live here. Any client can play it; a Loam instance runs **passive** (no executor in the ring) or
  **animate** (one present) — a deploy choice, not a fork.
- **Apps** _populate_ the reactor (ship function-definitions); they don't implement it.

Apps and runners coordinate only through the store (stigmergy): drop a sentiment-runner subscribing
to memory-deltas and emitting sentiment-deltas, and any client already subscribed to sentiment
benefits — neither knowing the other exists. **Execution assignment** is a client concern:
content-addressing makes double-execution harmless (union dedups), an orphan binding simply waits for
a runner. Structurally it is the transactional-outbox / job-queue-and-worker pattern on a homoiconic
store.

**The mill (first animate deployment, 2026-07-10)** — the reference pattern, learned by running
it in the village:

- **Two authorities, deliberately separate**: the operator blesses the recipe (a governed store
  honors only operator-authored definitions) AND grants the runner identity write standing —
  the recipe and the key to the granary are different keys.
- **The latest blessing per binding is the law**: `readBindingDefinitions` resolves
  latest-per-name (timestamp, then id), the same discipline registrations and translations
  keep — a re-blessed recipe supersedes, never duplicates an install.
- **Choose the emit mode by shape**: `supersede` is WHOLESALE (each trigger negates every live
  emission of the binding, across all roots); per-subject outputs want `keyed` supersession.
- **Supersession's ledger is per-attach, in memory**: a prior process's surviving emissions tie
  at timestamp 0 (pure emissions are functions of (fn, input hash) only) — a fresh attach
  sweeps its own author's stale emissions with idempotent ts-0 negations.
- **The budget is a lifetime trigger count** (a divergence guard, not a rate limit) — size it
  to the deployment, and remember the wheel suspends itself when it runs out.
- **A runner is process machinery, not ground**: emissions persist and survive restore (the
  vault archives flour too), but the wheel must be rehung after any gateway rebirth.
- **Derived output must not feed its own grist** (the reactor's own-trigger guard covers the
  binding's author; the FUNCTION must also exclude its output contexts from its inputs, or a
  second runner identity re-grinds the first's flour).

**Provenance.** Landed — [#9](https://github.com/bombadil-labs/loam/pull/9) (step 7: the runner as a peer client, genesis assembly) and [#32](https://github.com/bombadil-labs/loam/pull/32) (the mill: first animate deployment, `supersede`/`keyed` emission, budget-as-lifetime learned from running it). Lives in `src/runner/runner.ts` (`Runner.attach`, `readBindingDefinitions`, `bindingDefinitionClaims`) and the gateway's single `ingestVia` hook (`src/gateway/gateway.ts`) that flips passive ↔ animate. Key line: the passive/animate distinction cost one settable field, not a fork — exactly the "roles, not layers" the section names.
