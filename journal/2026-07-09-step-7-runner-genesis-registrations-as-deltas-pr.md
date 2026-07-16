## 2026-07-09 — Step 7: Runner + genesis + registrations-as-deltas (PR #9)

Three pieces, one theme — the store describes itself. 126/126.

- **Registrations are deltas.** A registration (schema + policy + roots) serializes into one
  operator-signed delta (`termToJson`/`policyToJson` as JSON-string primitives); `Gateway.open`
  replays them and re-registers, so a reopened store serves its schemas with **no
  re-registration code** — the audit-1 gap closed. In a governed store only the operator's
  registrations bind (an unsanctioned one planted while ungoverned roots nowhere, same discipline as
  the constitution).
- **The runner is a peer client, not a tier.** Function DEFINITIONS live in the store (a
  `BindingSpec` filed as a delta); `Runner.attach(gateway, { seed, implementations })` reads
  them, installs each into a `DerivationHost` over the gateway's reactor with an in-process
  implementation it holds (`fnId → DerivedFn`), and animates the gateway (ingest routes through
  the host). **Passive** (definitions inert) vs **animate** (they compute) is that one call.
  A definition whose `fnId` the runner lacks is skipped, not fatal — an orphan waits for a
  runner that holds it. What a binding emits rides `subscribeRaw` into the backend and replays
  like any other delta.
- **Genesis boots a self-describing store.** `assembleGenesis({ operatorSeed, registrations,
  grants })` → a content-addressed, operator-signed bundle; `Gateway.boot(backend, genesis)`
  opens a fresh store already governed and registered, and is idempotent (the same genesis
  twice is the same deltas by id).

Learning: the gateway's `animate` hook is a single settable ingest router (`ingestVia`), so the
passive/animate distinction cost one field and no fork — exactly the "roles, not layers" shape
SPEC §6 wanted. And derived emissions persist for free: they were already riding the raw stream
(step 4), so the runner needed no persistence code of its own.

Review resolution (6 findings):

- **The privilege-confusion gap, closed twice.** The review's sharpest: a binding definition the
  runner installs makes it compute and sign under its own seed — so who may plant one is who may
  direct the runner. In a governed store that's now the operator alone, enforced at BOTH ends:
  a non-operator's definition is refused at `append` (it files on ungoverned ground, which only
  the operator may write), and `readBindingDefinitions` filters to operator-authored on install
  (defense in depth for anything planted while the store was ungoverned). Derived emissions
  therefore carry the operator's delegated authority by construction; confining untrusted
  (federated) function bodies stays a runner-runtime concern SPEC §6 reserves for later — now
  said plainly in the raw-subscriber comment.
- **Registration replay is a fixpoint, not a sort.** Timestamp order can't guarantee a schema's
  refs register first (ties, same millisecond); replay now installs in rounds until no progress,
  and a schema whose refs never resolve is left unbound rather than crashing the boot.
- **`publishRegistration` refuses a non-operator up front** rather than persisting a registration
  that would look registered but never bind (the operator filter would drop it on replay).
- Passive test now asserts the definition is *present* (not merely that nothing computed);
  the O(store) scan for the constitutional slice is acknowledged as indexable-later.
