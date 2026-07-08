# The Database — Design Specification

**Name:** **Loam** (internal codename: Ithaca). **Status:** draft spec, 2026-07-07, written by Opus 4.8 from a
long design conversation with Myk, as the seed for the greenfield database repo. **Audience:**
Fable (claude-fable-5) and Myk. **Convention:** _decided_ statements are stated plainly; things
still in motion are marked **(open)**; things beyond the first build are marked **(north-star)**.

This is the general database beneath Chorus — Myk's ~15-year passion; Chorus (https://github.com/bombadil-labs/chorus) is one application of it. Build it like the thing it is.

---

## 0. One-paragraph orientation

A **reflective, homoiconic, content-addressed, signed, temporal, CRDT graph-substrate** whose
queryable state is the _memoized present tense_ of an ongoing distributed computation. A database
is a fold over an event log with a queryable accumulator; this one puts the **reducers into the
log** (schemas and functions are data) and makes the **log a CRDT** (the fold is distributed and
mergeable). Everything above the raw delta stream — types, resolutions, computations, permissions —
is itself data in the same store, so the system can evolve its own types and behavior by writing
claims, and every step of that evolution is a signed, replayable delta.

> ⚠️ **Read [RHIZOMATIC-SURFACE.md](RHIZOMATIC-SURFACE.md) first.** A deep read of rhizomatic's
> actual type surface (2026-07-08) found that **most of the core this spec describes — the object
> model (§3), the self-hosting schema-schema (§6), and the function substrate (§7) — is already
> provided by rhizomatic** (`HyperSchema`, `HView`, `resolveView`/`Policy`, `SCHEMA_SCHEMA` +
> `loadSchema`, `DerivationHost`/`DerivedFn`/`BindingSpec`/`verifyPureDerivation`, and the reactor
> with subscribable materializations). **Build on it; do not reinvent it.** Loam's genuine scope is
> the _wrapper_: GraphQL interface, durable/pluggable persistence, accounts/capabilities, the
> gateway transport, deployment, and the genesis assembly. §3/§6/§7 are pending revision to
> _import_ that core rather than re-specify it; the §11 spike is largely answered (rhizomatic's
> `Policy` is the reduction library). Treat this spec's model as _conceptually_ right but
> _mis-attributed_ until reconciled with the map.

## 1. Purpose, scope, non-goals

**Purpose:** a domain-agnostic database that makes full use of rhizomatic's affordances (signed
content-addressed deltas, CRDT union merge, temporal identity, federation) and adds a typed,
self-hosting, reactive layer on top, exposed as GraphQL.

**Non-goals:** it does not know what a "belief" is (that's Chorus, an application: a bundle of
schemas + a skill). It does not re-implement the format (that's rhizomatic, frozen). It does not
ship domain semantics beyond the genesis standard library.

## 2. Context: the three layers

1. **rhizomatic** (`@bombadil/rhizomatic`, existing, **frozen/normative**) provides: the **Delta**
   (arbitrary typed pointers/roles, canonical bytes, content address, signature), the **delta-set
   CRDT** (merge = union; order-blind, idempotent), the **evaluator** (8 operators) + **resolution
   policies**, and the **reactor** — more than a live-index shorthand: ingest + live indexes + `arrivalLog` + `eval` over a **`SchemaRegistry`** + named, rooted **materializations** returning **`HView`s** (hyperviews), kept current on each ingest, with **`subscribe`** (push change-notification via `MaterializationChange`). **Consequence: rhizomatic already ships `HView`, a `SchemaRegistry`, and maintained/subscribable materializations — so it may already provide much of what §3–§4 call resolution and §3's live-view mechanism. The Loam/rhizomatic line in this spec is PROVISIONAL until mapped (§11 spike #1); rhizomatic's schema concept must be disambiguated from our Schema/Hyperschema.** Also **`Peer`**/federation, packs,
   derivation. We change it only by a deliberate PR there (conformance vectors + version bump).
2. **the database** (this spec) — the typed, self-hosting, reactive, capability-secured layer.
3. **applications** (e.g. Chorus) — a genesis-extending **bootstrap delta-set** + client
   ergonomics (a skill). No application ships its own server.

**Topology is a hub and a flat ring, not a stack.** Loam is the hub; everything else — apps,
runners, dashboards — are **peer clients** of the gateway, and they coordinate **only through the
store, never with each other** (stigmergy / blackboard). A **runner** (§7) is not a tier between
database and apps; it's a _sibling app_ playing the **execution role** (running ready-to-fire
function-deltas). Pipelines self-assemble by subscription: drop a sentiment-runner that subscribes
to memory-deltas and emits sentiment-deltas, and a Chorus already subscribed to sentiment scores
starts benefiting — neither app knowing the other exists. A Loam instance runs **passive** (no
executor in the ring) or **animate** (one present).

## 3. The object model

The whole system is these objects, each a domain node (data) unless noted.

- **Delta** — the atom. Signed, content-addressed, append-only, unioned. Never edited; a retraction
  is another delta.
- **Domain node** — a _thing the store knows about_ (a user, a function, a schema). **Not a delta**
  — a node is the resolved view over the deltas that target it, and it can evolve as deltas arrive.
- **Selector** — names the _root/scope_ of a resolution. Either **static** (a literal id or list)
  or **dynamic** (a sub-query evaluated at execution time — late-binding; e.g. "users created since
  yesterday", where `yesterday` binds when it runs). Dynamic selectors **compose** (a query feeding
  another query's scope) and may be **clock-effectful** — but see Snapshots: sampling pins the
  effectful scope into a deterministic artifact.
- **Hyperschema** — `(Selector, store) → Hyperview`. The **gather/selection** stage. Recursive:
  for each property it names the sub-hyperschema of what that property binds to, terminating at
  primitives — so it defines a _traversal_, and its output is a **tree**.
- **Hyperview** — the gather output: an **arborescent, typed tree of bucketed deltas** — the
  relevant deltas, pre-routed into the exact bucket each resolver will read. (The Hyperschema does
  indexing/routing; the Schema does reduction over pre-routed buckets.) A Hyperview is either
  **live** (reactor-maintained, always current) or **pinned** (a hyperview-snapshot). Cyclic
  traversals (friend-of-friend) are bounded by the query's requested shape and/or the snapshot's
  declared depth.
- **Schema** — `(Selector, Hyperview) → View`. The **resolve/projection** stage. _Literally a
  GraphQL schema._ **Bidirectional:** read resolvers (a **Policy** applied to a hyperview bucket →
  field value) and write resolvers (field args → deltas). A Schema is itself a domain node.
- **Policy** — a field's **reduction rule** over its hyperview bucket: `latest` / `latest-trusted`
  / `set-union` / `surface-all` / custom. "A field is _shape + reduction_"; the Policy is the
  reduction. Trust-ranking (for `*-trusted`) is itself a resolved view (the accounts/trust schema),
  so policy parameterization is data.
- **View** — the resolve output. **Two modes:**
  - **Snapshot** (static view) — immutable, **content-addressed**, timestamped. _A commit._
    Identified by its value. Two subscribers over the same deltas sample identical snapshot hashes
    (convergence, for the same reason merge is union).
  - **Subscription** (dynamic view) — a **live standing resolution**. _A branch._ Identified by its
    definition (schema + selector + policy). Emits an initial snapshot + a stream of patches
    (`old-hash → new-hash + diff`); can be **sampled** to a snapshot at any instant (the same
    operation `query` performs). If named/persisted, it's a first-class node you can reference,
    share, or distrust.
- **Snapshot** (general) — a **pinned resolution product**. Everyday case: a View-snapshot. Also
  needed: a **Hyperview-snapshot** (for superposition-input functions and replay/provenance —
  precedented by Chorus's decision-basis, which pins the resolved view-hash _and_ the arrival
  prefix = the scope). **Two stages × two modes**, and one _sampling_ operation crossing live →
  pinned. Do **not** generalize to "pin arbitrary intermediates" — there are only two stages, so
  only two pinnable products.

**The load-bearing duality:** _every resolution product — Hyperview or View — is either live (a
subscription that patches) or pinned (a snapshot, addressed); sampling a live one yields a pinned
one._ The delta stream is ground truth; snapshots are the memoized present tense you work against.

## 4. Resolution

- **Two stages:** `deltas --[Hyperschema]--> Hyperview (scoped tree) --[Schema]--> View`. Gather,
  then resolve. (SQL: `FROM…WHERE` then `SELECT`+aggregates. Datalog: body then head.) Separating
  them buys reuse: one Hyperview backs many Schemas; one Schema runs over many Hyperviews.
- **Two reads:** `query → View` (the resolved value; Chorus's `recall`) and `gather → Hyperview`
  (the scoped deltas = the receipts; Chorus's `explain`). Functions, like external readers, consume
  one or the other by declaration.
- **The scan is ground truth.** The fully general read is a function scanning every delta; a
  Hyperschema is a _named, tree-structured, cacheable scan_; a Snapshot memoizes it. Schemas cost no
  generality — scan is the fallback, hyperschema the structured path, snapshot the frozen result.

## 5. Operations & the gateway

The database's **only surface** is a gateway (MCP + HTTP) exposing GraphQL. Named operations:

- **`query(gql) → snapshot`** — resolve once (dereference a dynamic view to a snapshot).
- **`subscribe(gql) → dynamic view`** — hold the resolution open: initial snapshot + patch stream.
- **`mutate(gql) → deltas`** — a Schema's write-resolvers turn field args into deltas; append them.
- **`loadSchema(deltas) → schema`** — append schema-defining deltas, meta-resolve the new schema
  (§6), return it. Nothing is reachable except through GraphQL over a schema — including schema CRUD,
  which goes through the schema-schema. **Schemas are always built from deltas** (never a bare
  schema divorced from the deltas that define it).

**Underneath, there are two primitives: `append` and `resolve`.** `mutate` = append. `query` /
`subscribe` = resolve (sampled-once / held-live). `loadSchema` = append + resolve. Everything is
append + resolve.

**Query is reflective.** Answering `{ user(id:"…"){ … } }` is: (1) **reify the `User` Schema** —
itself a resolve against the meta-layer (§6) — then (2) apply it at the root → View → project
fields. Every query is preceded by a schema-resolution that is itself a query; the meta-nodes are
the fixed point that lets the recursion bottom out. **Snapshots amortize the reflection:** the
meta-resolution happens once, at snapshot time; per-query you read a snapshot (cheap). Reflection is
expensive exactly once, then pinned.

## 6. Self-hosting & bootstrap

Types are defined by data. Read the machinery as **two reifier-engines** and **two def-gatherers**:

- **Schema Schema** — reifies any Schema from its defining deltas. **The metacircular base:** it
  reifies _itself_. (Like `eval` evaluating `eval`.)
- **Hyperschema Schema** — reifies any Hyperschema from its defining deltas. (Is a Schema → reified
  by Schema Schema.)
- **Schema Hyperschema** — gathers the deltas that define Schemas. (Is a Hyperschema → reified by
  Hyperschema Schema.)
- **Hyperschema Hyperschema** — gathers the deltas that define Hyperschemas. (Is a Hyperschema →
  reified by Hyperschema Schema.)

**Bootstrap:** the genesis set ships the delta-definitions of all four, plus a **host-language seed**
of the reifier (essentially the Schema Schema). The seed runs one cycle to reify the store's _own_
definitions; you verify seed-behavior equals store-defined behavior; then the seed can be dropped.
After that the type system is defined entirely in the store, in itself, as data — versioned,
contestable, time-traveled.

**The genesis / bootstrap delta-set (the keystone).** Every store is born from it: the **four
meta-nodes** (schema-schema), the **accounts/capabilities** schema (§8), **names**,
**federation-subscription** schemas, and the **function/trigger** schemas (§7). It is the standard
library and the root of trust in one. Building the smallest self-describing genesis set + a gateway
that serves it is the spine (§11).

## 7. The function-substrate (north-star; phase 6)

**Three _roles_, distributed across the hub and its peer clients — not three stacked layers**
(topology is a hub + a flat ring; see §2). This is the load-bearing structure of the reactive layer,
and it means the store runs _passive_ or _animate_ (§9) as a deploy choice, not an architecture fork:

- **Core Loam** (the hub) natively _holds_ functions and _signals readiness_:
  definition/application/execution are genesis schemas (functions are domain nodes = data), and a
  subscription reaching its sufficiency predicate is the ready-to-fire signal. **Core Loam never runs
  code.** (The function model as data + the trigger mechanism.)
- **The execution role** is played by a **runner** — a _peer client / sibling app_ (not a tier
  beneath others), reusable and domain-agnostic — which subscribes to ready-to-fire applications,
  **executes** the implementation in its runtime, and appends the output deltas. All the hard,
  dangerous machinery (sandboxing untrusted federated code, effect handling, termination budgets —
  §7a) lives here, quarantined out of the core: the rhizomatic "small sacred core" lesson one level
  up. This is Substrate's kernel-vs-runner cut. Any client can play the role — a dedicated shared
  executor, or an app running its own functions inline.
- **Apps** (Chorus) _populate_ the reactor: they ship function-**definitions** as bootstrap deltas
  (the Chorus skeptic/review are definitions). They feed it; they do not implement it. Apps and
  runners are peers; they compose only through the store (stigmergy), never by knowing one another.

**Execution assignment** (which client runs a ready function) is a client-coordination concern, not
a substrate one: content-addressing makes double-execution harmless (two runners of the same
`(definition, input)` emit the same delta → union dedups), and an orphan function simply waits until
some runner subscribes. (Substrate's _run-claiming_ is the elaborated version; it lives out in the
ring.)

Structurally this is the **transactional-outbox / job-queue-and-worker** pattern — ready-to-fire
functions are a reactive job queue _in the store_ (core), the runner is the worker (attachable),
results write back — the only novelty being that jobs, code, and results are all signed
content-addressed deltas in one homoiconic store, and the queue is a live subscription, not a polled
table.

The model itself requires **zero rhizomatic changes** — functions are deltas; the reactor gives
change-detection; the evaluator resolves views; append emits outputs; the conventions are hyperschemas.

- **A function is a domain node** (inputs, output, implementation, language, runtime). It can evolve.
- **A definition is a snapshot of that node** — frozen, content-addressed → **reproducible
  executions** and **versioning** (a new snapshot is a new definition; applications upgrade by
  deliberately re-binding, or stay pinned; a running computation never has its function shift under
  it).
- **An application** binds a definition to a **subscription** (a live view or hyperview) with a
  **firing rule** — a **monotone sufficiency predicate** over the bound input. (This is the same
  live-standing-resolution primitive as a GraphQL `subscribe`; §3/§5.)
- **An execution** is a firing, keyed on `hash(definition, sampled-input-snapshot)`.
- **Input type is declared per function:** value-functions take a **View** (resolved); superposition
  functions (adjudicators, the Chorus skeptic) take a **Hyperview** (raw — they must _see the
  disagreement_). Maps to recall/explain.
- **Pure vs effectful.** A pure function `(definition, input) → output` is deterministic →
  **memoize/replay** (fetch the execution by its content key). An effectful function (human, LLM,
  HTTP) → same input, different output → **not memoized**; each firing is its own execution record
  (**testimony, not derivation**). This is `decide`/`replay` generalized from "an agent about to
  act" to "any node in the graph."
- **Confluence (CALM).** Firing on sufficiency over a resolved view is **monotone**, which by the
  CALM theorem (Consistency As Logical Monotonicity) is exactly the boundary of coordination-free
  correctness. Keying executions on the content-address of their input makes **memoization =
  confluence = idempotence = one fact** — the store's own dedup is the enforcement.
- **Provenance graph = dataflow-dependency graph.** Every output cites its execution cites its
  input-snapshot cites its sources. Retraction makes resolution non-monotone (a value can vanish);
  **invalidation is a forward walk of the citation graph you already keep for the flight recorder.**
  Lineage and incremental recompute are one structure, opposite directions.
- **Termination** holds for the pure/monotone core: each distinct `(definition, input)` computes at
  most once — **the memo table is the termination bound.** Effectful and fresh-emitting functions
  (clocks, counters) sit outside it and need budgets.
- **The database is itself a function:** delta(s) in → deltas out; default interpretation = persist +
  check subscriptions (including functions). It was never a database; it's a distributed function
  closure whose state happens to be queryable. **(open)** whether transient/trigger deltas are
  compacted vs never-persisted — recommend **persist + compact**, keep provenance total; prefer
  change-driven subscriptions over clock-driven triggers.
- **Runtime is open:** a function's implementation + runtime may be pure code in a VM, an HTTP
  service, an LLM, or **a human + email/web-form** — differing only in determinism and latency.

### 7a. `isolated` functions & compartment execution (the runner's job)

**This is the runner's concern — core Loam never executes code.**

Pure function bodies are **object-capability-confined**: zero ambient authority; access only to
arguments, an explicit `context` capability bag, and a **vetted allowlist** of pure stdlib globals
(**default-deny**, so future/unknown APIs are impure until proven pure — the only future-forward
posture). `isolated`/`bind`/`call` ≡ definition/application/execution; `isolated` is the static
referential-transparency counterpart to content-addressing (it closes the "smuggled `Date.now()`"
hole). **Two enforcement points:** a **lint rule** (authoring DX) and a **runtime compartment** (SES
/ locked Worker / wasm — **required** for executing function-deltas that arrive from untrusted
federated peers; the realm physically lacks the impure globals). Impure powers (`Date.now`,
`Math.random`, `fetch`, timers, storage, `Intl`, `eval`, host globals, `WeakRef`) are bind-only
capabilities — and _which capabilities are bound_ classifies an execution as memoizable-pure vs
receipt-leaving-effectful.

## 8. Object-capability & accounts

**No ambient authority, anywhere.** A user's write permission and a function's effect access are the
_same construct_: an explicit, signed, **reified capability grant** (a delta granting a reference).
Authority is testimony. This unifies accounts/auth, the effect boundary, and federation security
into one idea, natural here because everything is already a signed content-addressed claim.

- **Accounts/capabilities is a core genesis schema:** users, ownership, capability-grants as
  hyperschemas. A mutation authorizes **iff a resolved grant permits it.**
- **Policy is data** (the grants), **enforcement is code** (the gateway rejects unauthorized
  mutations before append), rooted in an **operator identity** that bootstraps the first grants on a
  hosted instance.
- Capabilities become **auditable, time-traveled, revocable** data — the one place Substrate was
  ahead, closed more elegantly.
- **(open)** multi-tenant scope for v1: plan the model fully; decide whether v1 ships single-tenant
  (operator + bearer, schema present but simple) or multi-tenant.

## 9. Persistence, deployment, federation

- **Store ⟂ app.** Separate the running **app** (stateless: gateway + resolution) from the **store**
  (persisted deltas). The store lives in a **pluggable persistence engine**; **N app instances may
  front one store** (the CRDT's sweet spot — concurrent appenders can't conflict). **One store = one
  isolated persistence unit** — never multiple stores sharing a table via `store_id`.
- **Async.** A hosted/networked store is async ⇒ the read/resolution path is **async** (the one
  genuinely invasive shape; a reason to build greenfield, not retrofit). **Turso / libSQL** is the
  backend shaped exactly right (it _is_ sqlite; hosted, replicated, multi-connection).
- **Cloud turnkey:** fastest-secure-persistent path (recommend Fly.io reference + a deploy button),
  **pluggable persistence not just a stateful container**. Replaces the tailscale-exposed local box
  with a plain authed HTTPS endpoint.
- **Federation** via the CRDT: `deltasSince` is one primitive at every scale (multi-app-over-one-
  store = LAN; peer federation = WAN). Exposed over the authed HTTP surface + a "subscribe to
  instance X's published lens" declaration. See CONSTELLATION.md in the chorus repo (https://github.com/bombadil-labs/chorus/blob/main/claude_notes/CONSTELLATION.md).
- **Passive or animate (a deploy choice, not a fork).** A Loam instance with **no runner** (§7)
  attached is a complete passive store — query / subscribe / mutate / resolve / federate. Attach a
  runner and the same store **animates**: functions fire, derived deltas flow. The function
  _data-model_ is always core; _execution_ is an optional attached tier.

## 10. Invariants & constraints

- **Append-only, everything.** Even materializations: a snapshot is never mutated; recompute yields
  a _new_ snapshot (new id, new timestamp). Nothing is edited; the store only learns.
- **Content-addressed identity.** A delta's / snapshot's id is its canonical content hash → the same
  thing is the same everywhere; merge is union; sync can't conflict; two resolutions over the same
  deltas converge to the same hash.
- **Object-capability always** (§8). No ambient authority in gateway, functions, or federation.
- **rhizomatic is frozen.** The **one** possible format conversation is the **resolution-
  expressiveness spike** (§11): can the evaluator + policies express every field reduction? Even the
  function-sufficiency check can almost certainly be DB-level code over a resolved view, so probably
  nothing is needed. Anything that _is_ needed goes through conformance vectors + a version bump.
- **The live store never breaks.** Chorus's migrated 619-belief store is EAV. **EAV is the default
  schema** (safety floor). A migration to typed frames is an **opt-in, honest streaming transform:**
  it **appends** typed deltas, the migrator **signs as itself**, each new delta **cites the EAV
  deltas it derived from** (backpointers = provenance), originals stay in history. **Never re-sign
  migrated data as the original authors** (forgery of testimony). The transform is itself a DB
  procedure.

## 11. The spike + sequencing

1. **Spike first — map the substrate, then re-draw the line.** rhizomatic's reactor already exposes `eval` + a `SchemaRegistry` + `HView` + maintained, subscribable materializations (§2), so the first task is to map its actual reactor/HView/SchemaRegistry/materialization surface against this spec's object model and re-draw the Loam/rhizomatic line — Loam may be much thinner than written, and rhizomatic's schema concept must be disambiguated from ours. Within that: can rhizomatic's evaluator + policies express the
   resolution reductions a Schema field needs? Sizes the whole layer; the only likely rhizomatic
   change. Report findings before building.
2. **The spine:** the minimal self-describing **genesis set** (four meta-nodes) + the **gateway**
   (`query`/`mutate`/`loadSchema`) + **schema-driven reads**, EAV as default schema. "A self-hosting
   typed store you can talk to." Prove end-to-end.
3. **Mutations** + **accounts/capabilities** enforcement in the gateway.
4. **`subscribe`** (dynamic views / patch streams) + the live/pinned duality.
5. **Pluggable async persistence** (Turso) + **N-apps-over-one-store**.
6. **Chorus as client:** cognition schemas as bootstrap deltas + skill; the EAV migration procedure;
   measure-instruments as DB query tools.
7. **The function-substrate** (§7), in tier order: (a) **core Loam's** function schemas + the
   sufficiency/readiness signal (data + trigger — can land early, it's just subscriptions + genesis
   schemas); (b) a **runner** (a peer client) that executes (isolated/compartment, sandboxing,
   budgets); (c) **apps populate** with definitions (Chorus's instruments as trigger-deltas). The
   store is useful and shippable at (a) alone — passive; (b) makes it animate.
8. **Cloud deploy** + **federation**.

## 12. Open questions

- ~~Name~~ **decided: Loam** (Ithaca kept as internal codename). **Multi-tenant scope** for v1 (§8). **Clean-room vs port** into the
  greenfield repo (recommend clean-room, the chorus repo's `src/` as quarry (https://github.com/bombadil-labs/chorus)). **What remains of the
  chorus repo** (the distribution: bootstrap deltas + skill + deploy + docs).
- Transient/trigger delta compaction policy (§7).
- Exact firing-rule / sufficiency-predicate grammar, and the retraction-invalidation cascade's
  precise fixpoint semantics.
- Whether `subscribe` patches are diffs-of-snapshots or full snapshots on the wire (recommend
  diffs, since snapshots are content-addressed: `old-hash → new-hash + diff`).

## 13. Glossary

- **Delta** — the signed, content-addressed atom (rhizomatic).
- **Domain node** — a thing the store knows about; a resolved view over its deltas; evolves.
- **Selector** — the root/scope of a resolution; static or dynamic (a sub-query).
- **Hyperschema** — recursive gather definition; `(Selector, store) → Hyperview`.
- **Hyperview** — arborescent tree of bucketed scoped deltas; live or pinned.
- **Schema** — bidirectional GraphQL resolver; `(Selector, Hyperview) → View`; a domain node.
- **Policy** — a field's reduction rule over its hyperview bucket.
- **View** — resolve output; **Snapshot** (static, immutable, addressed = a commit) or
  **Subscription** (dynamic, live = a branch).
- **Snapshot** — a pinned, content-addressed, timestamped resolution product (View or Hyperview).
- **Function / Definition / Application / Execution** — a node / its snapshot / its bound
  subscription+firing-rule / a firing keyed on `(definition, input-snapshot)`.
- **Runner** — not a tier but a **role**: a peer client (sibling of apps like Chorus) that executes
  ready-to-fire function applications in their runtimes and appends outputs. Any client can play it;
  optional (passive vs animate). Core Loam never runs code; peers coordinate only through the store.
- **Capability** — a signed delta granting a reference; the unit of all authority.
- **Genesis set** — the bootstrap deltas every store is born from.
- **The four meta-nodes** — Schema-Schema (metacircular base), Hyperschema-Schema, Schema-
  Hyperschema, Hyperschema-Hyperschema.
