# Loam — Specification

**Loam is the substrate where the rhizome becomes the tree.** A general database: a reflective,
homoiconic, content-addressed, signed, temporal, CRDT graph-substrate whose queryable state is the
memoized present tense of an ongoing distributed computation. It is the general layer beneath
[Chorus](https://github.com/bombadil-labs/chorus) — Chorus is one _application_ of Loam (a bundle of
schemas + a skill). Loam does not know what a "belief" is.

Loam is built **on** [rhizomatic](https://github.com/bombadil-labs/rhizomatic)
(`@bombadil/rhizomatic`), and — this is the load-bearing fact — **rhizomatic already provides most of
what a naïve reading would call "the database": the object model, resolution, the self-hosting
schema-schema, and the function substrate.** Loam is the _wrapper_ that makes that core a deployable,
GraphQL-fronted, persistent, multi-tenant, federatable server. Do not reinvent the core; build on it.

---

## 1. The three layers

1. **[rhizomatic](https://github.com/bombadil-labs/rhizomatic)** (`@bombadil/rhizomatic`, **frozen /
   normative**) — the format _and_ the typed reactive core (see §2). Never changed from here; a
   genuine substrate need is a PR there (conformance vectors + version bump) and a conversation with
   Myk.
2. **Loam** (this repo) — the wrapper (see §3): GraphQL interface, durable/pluggable persistence,
   accounts & capabilities, the gateway transport, deployment, and the genesis assembly.
3. **applications** (e.g. Chorus) — a genesis-extending bootstrap delta-set + client ergonomics. No
   app ships its own server. Apps and runners are **peer clients** of Loam, coordinating only through
   the store (stigmergy).

## 2. The foundation — what rhizomatic already provides (build on these)

Confirmed at the type level (`@bombadil/rhizomatic@0.1.0` `dist/*.d.ts`); **confirm semantics against
its source/tests as the first build step.** Adopt rhizomatic's names; do not parallel them with
near-synonyms (that is how you get two colliding "schema" concepts).

- **Data & CRDT** — `Delta` / `Claims` / `Pointer` / `Target`; `DeltaSet` with `merge`/`federate`/
  `fork`; signing (`authorForSeed`, `signClaims`, `verifyDelta`). Merge is union — order-blind,
  idempotent, conflict-free.
- **Hyperschema** (the gather/selection stage) — `HyperSchema { name, alg, body: Term }` +
  `SchemaRegistry`; recursion via schema-refs (`collectRefs`). A hyperschema is a named term that
  scopes and shapes the relevant deltas.
- **Hyperview** (the gathered, arborescent, bucketed tree) — `HView { id, props: Map<string,
  HVEntry[]> }`, `HVEntry { delta, negated, expanded?: Map<number, HView> }` (the recursion + the
  negation-awareness), content-addressed via `hviewCanonicalHex`.
- **Resolution & policy** (the resolve stage) — `resolveView(Policy, HView) → View`. `View =
  Primitive | View[] | { [k]: View }`. `Policy = { props: Map<string, PropPolicy>, default }`.
  `PropPolicy` = `pick(order)` / `all(order)` / `merge(fn)` / `conflicts(order)` / `absentAs(const,
  then)`. `Order` = `byTimestamp` / `byAuthorRank(authors)` / `byPred` / `lexById`. `MergeFn` =
  max/min/sum/count/and/or/concatSorted. **This is the reduction library** (latest = `pick
  byTimestamp`; trusted-first = `byAuthorRank`; set-union = `all`; contested = `conflicts`).
  Confirmed nuance: `conflicts` surfaces a property **only when ≥ 2 distinct values contend** —
  an agreed single value resolves to absent (superposition is for the contested, not the settled);
  and every `Order` chain ends in an implicit `lexById` tiebreak, so resolution is total and
  deterministic.
- **Snapshots** — a resolved `View` is content-addressed via `viewCanonicalHex`; a `HView` via
  `hviewCanonicalHex`. Static view = snapshot = a commit.
- **Self-hosting schema-schema** — `SCHEMA_SCHEMA: HyperSchema`, `loadSchema(dset, entity) →
  HyperSchema` (deltas → schema), `publishSchemaClaims(schema, …) → Claims` (schema → deltas),
  `definitionRoles()`. Schemas are data; the metacircular seed is already written.
- **The reactor** — `ingest` (verifies content-addressing and any signature; unsigned deltas are
  accepted, forged ones rejected without trace); live indexes (`byTarget`/`byValue`/`negationsOf`);
  `arrivalLog`; `eval` over a `SchemaRegistry`; named, rooted **materializations**
  (`register(name, term, roots, registry?)` / `materializedView` → `HView` / `materializedHex`)
  kept current on each ingest; **`subscribe(name, cb)`** (push change-notification via
  `MaterializationChange { materialization, root, changedProps, responsibleDeltaIds, newHex }`)
  plus **`subscribeRaw(cb)`** (every accepted delta — the federation/audit stream). Dynamic view =
  subscription = a branch.
- **The function substrate** — `DerivedFn = (view: HView, root) => Pointer[][]` (a function is
  hyperview → deltas). `BindingSpec { name, fnId, materialization, pure, budget, emit:
  append|supersede|{keyed} }` (the _application_: binds a function to a materialization, with purity,
  a termination budget, and an output strategy). `DerivationHost` (install / ingest / trigger /
  drain / emitSigned — the execution engine). `derivedClaims(spec, author, substantive, inputHex)`
  (execution records keyed on input content). `verifyPureDerivation(...) → boolean` (pure replay).
  Definition / application / execution, pure-vs-effectful, termination, idempotent emit — all present.
- **Federation** — `Peer`, `syncBoth`, `SyncReport`, `servePeer` / `offerFor` / `pullFromUrl`.
- **Reflective plumbing** — terms, policies, and predicates are serializable (`term-io` / `term-json`)
  → storable as data.

## 3. Loam's actual scope — what to build

- **The GraphQL interface** — GraphQL derived from `HyperSchema` + `Policy`, exposing `query` /
  `mutate` / `subscribe` / `loadSchema` over rhizomatic's `resolveView` and reactor. rhizomatic gives
  the resolution primitives; GraphQL-as-the-surface is Loam's. (Chorus's read-only `gql.ts` is the
  design reference; Loam's is written clean: hyperschema-sourced, plus mutations.)
- **Durable / pluggable persistence** — rhizomatic is in-memory `DeltaSet` + `pack`/`unpack`. Loam
  adds the **async** `StoreBackend` seam + drivers (in-memory, sqlite, and a hosted one — Turso /
  libSQL is shaped right) + a store registry. Chorus's persistence tier is the reference (§10).
- **Accounts & capabilities** — users / ownership / capability-grants as schemas in the genesis set;
  the gateway authorizes a mutation iff a resolved grant permits it; an operator identity roots the
  first grants. Policy-as-data, enforcement-as-gateway-code.
- **The gateway transport** — MCP + HTTP serving the gateway (mounts, token auth). Chorus
  `mcp-http.ts` is the reference.
- **Deployment & runtime variety** — CLI, containerization, turnkey hosted persistence; and function
  **runtimes beyond in-process `DerivedFn`** (HTTP, VM, human) plus the runner's peer-client
  deployment (§6).
- **The genesis assembly** — bundle `SCHEMA_SCHEMA` + accounts + names + function/trigger schemas
  into a shippable genesis every store is born from.

## 4. The object model & flow

`deltas —[Hyperschema: gather]→ Hyperview —[Policy: resolve]→ View`. Two stages, kept separate: one
`HView` backs many resolutions; one policy runs over many hyperviews.

- **Selector** — the root/scope of a resolution: **static** (an id/list) or **dynamic** (a sub-query
  evaluated at execution — late-binding; composes; may be clock-effectful, but a snapshot pins the
  resolved scope deterministically).
- **View — static vs dynamic.** `query` returns a **snapshot** (a resolved, content-addressed,
  immutable value — a commit). `subscribe` returns a **dynamic view** (a live materialization — a
  branch — an initial snapshot + a patch stream `old-hash → new-hash + diff`), samplable to a
  snapshot at any instant. Every resolution product (Hyperview or View) is either live (maintained +
  subscribable) or pinned (a snapshot); sampling crosses live → pinned.
- **Two reads** — `query → View` (the resolved value) and a gather read `→ Hyperview` (the scoped
  deltas = the receipts). Functions consume one or the other by declaration (value-functions take a
  `View`; superposition functions take a `HView`).
- The raw **scan** is ground truth; a hyperschema is a named, cacheable, structured scan; a snapshot
  memoizes it.

## 5. The gateway (Loam's only surface)

HTTP, CLI and MCP interfaces exposing GraphQL: **`query`** (resolve → snapshot), **`subscribe`** (live →
snapshot + patches), **`mutate`** (a schema's write-resolvers turn field-args → deltas → append),
**`loadSchema(deltas) → schema`** (append schema-defining deltas, meta-resolve via `SCHEMA_SCHEMA`,
return it). Nothing is reachable except through GraphQL over a schema — including schema CRUD.
**Schemas are always built from deltas.** Underneath there are two primitives — **`append`** and
**`resolve`** — and `query`/`mutate`/`loadSchema`/`subscribe` are framings of them. Query is
reflective (resolving a schema is itself a resolve); snapshots amortize the reflection (meta-resolve
once at snapshot time, read cheap thereafter).

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

## 7. Object-capability & accounts

No ambient authority, anywhere. A user's write permission and a function's effect access are the same
construct: an explicit, signed, reified **capability grant** (a delta granting a reference). Accounts
/ capabilities are core genesis schemas; a mutation authorizes **iff a resolved grant permits it**
(policy is data, enforcement is gateway code, rooted in an operator identity). Capabilities are thus
auditable, time-traveled, revocable. **(decided 2026-07-09)** v1 is fully multi-tenant: tenant
isolation is a first-class construct in the genesis schemas and gateway enforcement, not a deferment.

## 8. Persistence, deployment, federation

- **Store ⟂ app.** The running app (gateway + resolution) is separate from the store (persisted
  deltas). The store is a **pluggable persistence engine**; **N apps may front one store** (the
  CRDT's sweet spot). **One store = one isolated persistence unit** — never a shared `store_id`
  table.
- **Async.** A hosted/networked store is async ⇒ the read/resolution path is async (build it that way
  from the start). **Turso / libSQL** is the backend shaped right (it _is_ sqlite; hosted, replicated,
  multi-connection).
- **Passive or animate** — a deploy flag (§6), not an architecture.
- **Cloud turnkey** — fastest-secure-persistent path (a container + hosted persistence + a deploy
  button); replaces a tailscale-exposed box with a plain authed HTTPS endpoint.
- **Federation** — rhizomatic's `Peer`/`syncBoth` over the authed HTTP surface + a "subscribe to
  instance X's published lens" declaration. `deltasSince` is one primitive at every scale.

## 9. Constraints & invariants

- **Append-only, everything** — including materializations: a snapshot is never mutated; recompute
  yields a new snapshot (new id, new timestamp). Nothing is edited; the store only learns.
- **Content-addressed identity** — the same delta/snapshot is the same everywhere; merge is union;
  two resolutions over the same deltas converge to the same hash.
- **Object-capability always** — no ambient authority in the gateway, functions, or federation.
- **rhizomatic is frozen** — the one live candidate for a substrate change is a resolution reduction
  `PropPolicy`/`Order`/`MergeFn` cannot express (unlikely; confirm in the spike). Any real need is a
  PR + conversation with Myk, never an edit from here.
- **Vocabulary reconciles to rhizomatic** — `HyperSchema`, `HView`, `View`, `Policy`, `DerivedFn`,
  `BindingSpec`. Metaphor lives in the product name (Loam), never in the load-bearing nouns.
- **If Loam ever ingests a legacy EAV store** (e.g. Chorus's current one): the honest path is an
  opt-in streaming transform that **appends** typed deltas, signs as the migrator, cites the source
  deltas (provenance), and never re-signs as the original authors.

## 10. Reference inventory — what to learn from Chorus

Roughly half of Loam's _plumbing_ has a shipped, tested ancestor in
[chorus](https://github.com/bombadil-labs/chorus)'s `src/`. **Decided (2026-07-09): chorus is
reference-only** — read it as a design guide (its seams, its edge cases, its lessons), but write
Loam's code clean, against Loam's tests; no EAV residue rides in. The reference map: the
**persistence tier** (`store-tier` / `sqlite-core` / drivers / content-sniffing — Loam's is async
from birth), the **store registry** (`stores.ts`, incl. `adopt`), the **GraphQL lifecycle** (`gql.ts`
— Loam's is hyperschema-sourced, plus mutations), the **MCP/HTTP transport** (`mcp-http.ts`), the
**CLI scaffolding** (`cli*.ts`, `config.ts`), and the **resolution-policy set** (`policies.ts`).
Design-pattern references (they carry the EAV model): `agent.ts` (`beliefPointers`), `decisions.ts`
(the pin-and-replay pattern), and the belief instruments/messages/briefing/librarian. The genuinely
new code is the hyperschema-sourced GraphQL, accounts-as-schema, and the runner's runtime variety
and deployment.

## 11. Glossary

- **Delta** — the signed, content-addressed atom (rhizomatic).
- **Hyperschema** — recursive gather definition; `HyperSchema { name, alg, body: Term }`.
- **Hyperview** — arborescent tree of bucketed scoped deltas; `HView`; live or pinned.
- **Policy** — per-property reduction over a hyperview bucket; `resolveView(Policy, HView) → View`.
- **View** — resolved output: **Snapshot** (static, content-addressed = a commit) or **Subscription**
  (dynamic, live = a branch).
- **Snapshot** — a pinned, content-addressed resolution product (View or Hyperview).
- **DerivedFn / BindingSpec / DerivationHost** — a function / its application (bound to a
  materialization, with purity + budget + emit) / the execution engine (rhizomatic).
- **Runner** — a peer client playing the execution role; passive vs animate.
- **Capability** — a signed delta granting a reference; the unit of all authority.
- **Genesis** — the bootstrap deltas every store is born from (`SCHEMA_SCHEMA` + accounts + …).
