# The Database — a brief for Fable

**What this is:** the design brief for the biggest move in the project — extracting a
**general database** out from under Chorus and building it, greenfield, as its own thing. Written
2026-07-07 by Opus 4.8 (in this repo, "Fable") from a long architecture conversation with Myk, as
the starting point for Fable (claude-fable-5) to **plan and then code** from. It is a _brief_, not a
spec: the vision is large, so this states the decisions, the constraints, and a tractable first
slice, and leaves the detailed design to your planning pass. Where reasoning is compressed here, the
full derivation is in that conversation; trust the decisions and re-derive only if something smells
wrong.

**Meta:** the database is Myk's ~15-year passion; Chorus (https://github.com/bombadil-labs/chorus) is
one _application_ of it. The database is **more its own product than Chorus is.** Build it like the
thing it is.

---

## The three layers

1. **rhizomatic** (`@bombadil/rhizomatic`, existing sibling repo, **frozen / normative**) — the
   format: signed content-addressed deltas, the delta-set CRDT (merge = union, order-blind,
   idempotent), the 8-operator evaluator, resolution policies, the **reactor** (live indexes /
   change-detection), `Peer`/federation, packs, derivation, content-addressing. **We do not change
   it** except by a deliberate PR there (conformance vectors + version bump) — a conversation with
   Myk, never an autonomous edit. Default posture: don't touch it.
2. **the database** — **Loam** (codename Ithaca); **greenfield repo** under
   bombadil-labs) — general, belief-agnostic. This brief is mostly about this layer.
3. **Chorus** (the app) — becomes a **distribution**, not a server: a **bootstrap delta-set** (the
   cognition schemas) + a **Claude skill** (the ergonomics/taste). Ships no MCP of its own; it
   specializes purely by installing specific schemas into a database instance. The current `chorus`
   repo slims down to this.

The proof the seam is real is the **sort**: take everything Chorus added on top of rhizomatic and
ask "does this know what a belief is?" Almost everything general (stores, as-of, resolution, contest
detection, diff/bisect, names, hyperschemas→GraphQL) is the database; almost everything
belief-specific turns out to be either **a hyperschema** (belief/decision/trust/identity/message/
doubt/measurement) or **a reactive rule** (the active instruments = saved queries + mutation
templates + triggers) or **ergonomic bindings** (the skill). The app dissolves into data +
configuration; the one thing that does _not_ dissolve is **taste** (the phrasing, the anti-nag
discipline). The database is the passion; the app is the taste applied to it.

## What the database _is_ (the north star)

Not "a database with functions bolted on." A **reflective, homoiconic, content-addressed, signed,
temporal, CRDT graph-substrate** whose queryable state is the _memoized present tense_ of an ongoing
distributed computation. A database is a fold over an event log with a queryable accumulator; this
one puts the **reducers into the log** (functions are data) and makes the **log a CRDT** (the fold
is distributed and mergeable). Five pillars:

1. **Hyperschemas as data + resolution-as-schema.** A schema field is _shape + reduction_ (`owner:
   Person, resolve = latest-trusted`). A GraphQL resolver over a hyperview _is_ that reducer. Reads
   are GraphQL derived from declared schemas; the EAV triple is just the reified default schema.
2. **Self-hosting.** The type system is defined by a **schema-schema** (the hyperschema-hyperschema),
   itself shipped as deltas — so schemas are versioned, contestable, time-traveled data, and the
   system can evolve its own types by writing claims. The bootstrap has a minimal self-describing
   fixed point.
3. **Functions as data (the reactive substrate).** A function is a delta (inputs, output,
   implementation, language, runtime). See the dedicated section below — this is the deep, new part,
   and it needs **zero rhizomatic changes**.
4. **Object-capability all the way down.** No ambient authority, anywhere. A user's write permission
   and a function's effect access are the _same_ construct: an explicit, signed, reified capability
   grant. Natural here because authority itself becomes testimony (a signed delta granting a
   reference). This unifies accounts/auth, the effect boundary, and federation security.
5. **Federation via the CRDT.** Merge is union, so sync/adoption/federation need no coordination;
   `deltasSince` is the one primitive at every scale (multi-app-over-one-store = LAN; peer
   federation = WAN).

## Decided architecture

- **Store vs app decoupling + pluggable persistence.** Separate the running DB _app_ (stateless
  interface: gateway + resolution) from the _store_ (the persisted deltas). The store lives in a
  **pluggable persistence engine**; **N app instances may front one store** (the CRDT's sweet spot —
  content-addressed idempotent union means concurrent appenders can't conflict). **One store = one
  isolated persistence unit** — never multiple stores sharing a table via a `store_id` column (the
  shared-tenant footgun). **Consequence to plan for:** the current `StoreBackend` contract is
  synchronous; a hosted/networked store is async, so the read/resolution path goes **async** — the
  one genuinely invasive refactor, and a reason to build greenfield rather than retrofit. **Turso /
  libSQL** is the persistence backend shaped exactly right (it _is_ sqlite, hosted, replicated,
  multi-connection).
- **The generic gateway (the database's only surface).** MCP + HTTP exposing GraphQL: `query(gql)`,
  `mutate(gql)`, and `loadSchema(deltas) → schema` (post deltas that define a schema, get the schema
  back). **Nothing is reachable except through GraphQL over a schema** — including CRUD on schemas
  themselves, which goes through the schema-schema. This makes a bare instance already agent-usable
  ("here is a typed instance; introspect it, query/mutate it, evolve its own schema").
- **Schemas are always built from deltas.** Never ship or accept a bare GraphQL schema divorced from
  deltas — a schema must always be reducible to the deltas that define it, so it's a first-class
  store citizen (versioned, contestable, time-traveled, federatable) like everything else.
- **The genesis / bootstrap delta-set (the keystone).** Every store is born from a genesis set: the
  **schema-schema** (self-hosting fixed point), the **accounts/capabilities** schema, **names**,
  **federation-subscriptions**, and the **function/trigger** schemas. This is the standard library
  and the root of trust in one. Building the smallest self-describing genesis set + a gateway that
  serves it is the spine (see Sequencing).
- **Accounts / capabilities as a core schema.** Cloud hosting ⇒ multi-user, so this must exist.
  Users, ownership, and capability-grants are hyperschemas in the genesis set; a mutation authorizes
  iff a resolved grant permits it. **Policy is data** (grants), **enforcement is code** (the gateway
  rejects unauthorized mutations), rooted in an **operator identity** that bootstraps the first
  grants. This closes the one gap Substrate had on us — and does it more elegantly (capabilities
  become auditable, time-traveled, revocable data).
- **Chorus = distribution.** Bootstrap deltas (cognition schemas incl. the active instruments as
  trigger-deltas) + a Claude skill. No Chorus process. Instrument split: **measure** tools
  (diff/bisect, most of vitals) are general **database** query tools; **active** tools
  (review/challenge/skeptic) are **trigger-deltas** in the Chorus bootstrap — held/signalled by core
  Loam, executed by a runner (a peer client, sibling to Chorus).

## The function-substrate (the deep layer — build to grow into it, not in v1)

**Three roles across a hub + a flat ring of peer clients (not three stacked layers): (1) core Loam
(the hub) natively holds functions-as-data and signals readiness — it never runs code; (2) the
EXECUTION role is played by a RUNNER — a sibling app / peer client (not a tier beneath others),
reusable and domain-agnostic, which executes ready-to-fire applications and appends outputs; all the
dangerous machinery (sandboxing federated code, effects, budgets) is quarantined here; (3) apps
(Chorus) POPULATE the reactor with function-definitions, they don't implement it.** Apps and runners
are peers that compose only through the store (stigmergy), never by knowing one another — drop a
sentiment-runner and a Chorus already subscribed to sentiment scores benefits without changing. So a
Loam instance runs _passive_ (no executor in the ring) or _animate_ (one present) as a deploy choice,
not a fork. Structurally the outbox / job-queue-and-worker pattern on a homoiconic store; same
kernel-vs-runner cut as Substrate.

Functions are `View → Deltas` and require **no rhizomatic changes** (they're deltas; the reactor
gives change-detection; the evaluator resolves views; append emits outputs; conventions are
hyperschemas). The design that makes it sound:

- **Bind to a single argument = a resolved view derived from a hyperview; fire on _sufficiency_.**
  The function never sees deltas or arrival order — it sees a snapshot. Firing on "the accumulated
  view is sufficient" is **monotone**, which by the **CALM theorem** (Consistency As Logical
  Monotonicity) is exactly the boundary of coordination-free correctness. This keeps rhizomatic's
  "order doesn't matter" property up into the computed layer.
- **Three levels — the load-bearing distinction.** _Definition_ (content-addressed pure code) /
  _application_ (a closure: definition bound to a hyperview — a subscription delta) / _execution_ (a
  firing keyed on `hash(definition, reified-input-view)`). Keying executions on the content-address
  of their input makes **memoization, replay, idempotence, and confluence one fact** — the store's
  own dedup _is_ the confluence enforcement.
- **Pure memoize / effectful receipts.** A pure function: `(definition, input) → output` is
  deterministic → cache/replay. An effectful function (human, LLM, HTTP): same input, different
  output → not memoized; each firing is its own **execution record** (testimony, not derivation).
  This is `decide`/`replay` generalized from "an agent about to act" to "any node in the graph."
- **Provenance graph = dataflow-dependency graph.** Every output cites its execution cites its
  reified input cites its sources. So retraction-invalidation (resolution is non-monotone — a value
  can vanish) is a _forward walk of the citation graph you already keep for the flight recorder_.
  Lineage and incremental recompute are the same structure, opposite directions.
- **Implementation guarantee: `isolated` functions + compartment execution.** Pure function bodies
  should be **capability-confined** (object-capability: zero ambient authority; only args + a
  `context` capability bag + a **vetted allowlist** of pure stdlib globals — default-deny, so future
  APIs are impure until proven pure). A TS **lint rule** gives the authoring guarantee; a **runtime
  compartment** (SES / locked Worker / wasm) gives the execution guarantee — **required** for
  running function-deltas that arrive from untrusted federated peers. `isolated`/`bind`/`call` ≡
  definition/application/execution; `isolated` is the static referential-transparency counterpart to
  content-addressing.
- **Termination** holds for the pure/monotone core (each distinct `(definition, input)` computes at
  most once — the memo table is the bound). Effectful and fresh-emitting functions (clocks,
  counters) sit outside the guarantee and need budgets.

## Constraints (inviolable)

- **The live store never breaks.** Myk's 619-belief personal store (migrated 2026-07-07) is EAV.
  EAV is the **default schema** (safety floor — nothing forced). A migration to typed frames is an
  **opt-in, honest streaming transform**: it **appends** typed deltas, the migrator **signs as
  itself**, each new delta **cites the EAV deltas it derived from** (backpointers = provenance), and
  originals stay in history. **Never re-sign migrated data as the original authors** — even though
  the master key _could_ re-derive their session keys, doing so forges testimony. The transform is
  itself just a DB procedure (a saved query over the old schema → a mutation into the new).
- **rhizomatic is normative.** No change without a deliberate PR + conformance vectors + version bump.
  The one thing that _might_ surface a need: whether the evaluator can express every resolution
  reduction a hyperschema field wants (see the spike). Even the function-sufficiency check can almost
  certainly be DB-level code over a resolved view, so probably nothing is needed.
- **Object-capability, always.** No ambient authority in the gateway, in functions, or in
  federation. Every grant is a signed, reified, revocable delta.
- **The public story stays singular for now.** "Flight recorder for minds" (Chorus) is the sharp
  near-term wedge; the database is the long-term product and its own story. Two-phase narrative.
- **The poetry is as important as the engineering** (standing directive). Prose surfaces are
  first-class craft.

## Sequencing (never destabilizing the live node)

1. **Spike first:** can rhizomatic's evaluator + policies express the resolution reductions a
   hyperschema field needs (latest / trusted-first / set-union / surface-all / custom)? This sizes
   the whole DB layer and is the only likely source of a rhizomatic change. **Do this before
   planning the rest.**
2. **The spine:** the minimal self-describing **genesis set** (schema-schema) + the **gateway**
   (`query`/`mutate`/`loadSchema`) + **schema-driven GraphQL reads**, with EAV as the default schema.
   This is "a self-hosting typed store you can talk to." Prove it end-to-end.
3. **Mutations** (typed writes → deltas) + **accounts/capabilities** enforcement in the gateway.
4. **Pluggable async persistence** (Turso/libSQL driver) + **multi-app-over-one-store**.
5. **Chorus as a client**: port the cognition schemas to bootstrap deltas + the skill; the EAV
   migration procedure; the measure-instruments as DB query tools.
6. **The function-substrate**, in tier order: (a) core Loam's function schemas + readiness signal
   (data + trigger); (b) the separate **runner** tier (execution: isolated/compartment, sandboxing,
   budgets); (c) apps populate with definitions (Chorus's instruments as trigger-deltas). Passive at
   (a), animate at (b).
7. **Cloud deploy** (fastest-secure-persistent turnkey; pluggable persistence, not just a stateful
   container) + **federation** over the authed HTTP surface.

## Open decisions (pending Myk — Fable, ask if not yet answered)

1. ~~The database's name~~ — **decided: Loam** (the substrate where the rhizome becomes the tree;
   Ithaca retained as internal codename). Internal technical vocabulary stays precise/standard.
2. **Multi-tenant scope for v1.** Plan the accounts/capability model fully; decide whether v1 ships
   single-tenant (operator + bearer, the schema present but simple) or multi-tenant. ("Have a plan,
   then decide how to scope it.")
3. **Clean-room vs. port** into the greenfield repo. Greenfield strongly implies **clean-room** —
   build it right from the genesis set up (schema-first, async-persistence-first, gateway-first),
   cannibalizing the chorus repo's `src/` (https://github.com/bombadil-labs/chorus) as a **reference/quarry**, not a foundation. Confirm.
4. **What remains of the current `chorus` repo** once the DB is greenfield and Chorus is
   skill+deltas: it slims to the distribution (bootstrap deltas + skill + deploy + docs/taste). Most
   of `src/` moves or is left as quarry. Confirm the intent.

## Fable's first actions

1. Read this, [CONSTELLATION.md](https://github.com/bombadil-labs/chorus/blob/main/claude_notes/CONSTELLATION.md) (federation), and skim the chorus repo's `src/` (https://github.com/bombadil-labs/chorus) as the
   reference quarry (especially `store-tier.ts`, `gql.ts`, `agent.ts`, `mcp-http.ts`, `stores.ts`).
2. Run **the spike** (item 1 in Sequencing) and report what it found — it may change the plan.
3. Produce the greenfield repo's own design docs (schema-schema shape, gateway contract, genesis-set
   contents) — this brief is the seed, not the spec.
4. Build **the spine** (Sequencing #2) as the first vertical proof.
