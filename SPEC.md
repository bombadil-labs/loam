# Loam — Specification

**Loam is the substrate where the rhizome becomes the tree.** A general database: a reflective,
homoiconic, content-addressed, signed, temporal, CRDT graph-substrate whose queryable state is the
memoized present tense of an ongoing distributed computation. It is the general layer beneath
[Chorus](https://github.com/bombadil-labs/chorus) — Chorus is one _application_ of Loam (a bundle of
schemas + a skill). Loam does not know what a "belief" is.

Loam is built **on** [rhizomatic](https://github.com/bombadil-labs/rhizomatic)
(`@bombadil/rhizomatic`), and — this is the load-bearing fact — **rhizomatic already provides most of
what a naïve reading would call "the database": the object model, resolution, the self-hosting
hyperschema-schema, and the function substrate.** Loam is the _wrapper_ that makes that core a deployable,
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

**Provenance.** Foundational framing — no single landing PR; the three-layer split is the invariant
every later section obeys, realized across the whole build (steps 0–9, PRs [#1](https://github.com/bombadil-labs/loam/pull/1)–[#10](https://github.com/bombadil-labs/loam/pull/10)). Full narrative in the [Journal](JOURNAL.md).

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
- **Resolution & schema** (the resolve stage) — `resolveView(Schema, HView) → View`. `View =
Primitive | View[] | { [k]: View }`. `Schema = { props: Map<string, Policy>, default }`.
  `Policy` = `pick(order)` / `all(order)` / `merge(fn)` / `conflicts(order)` / `absentAs(const,
then)`. `Order` = `byTimestamp` / `byAuthorRank(authors)` / `byPred` / `chain(orders…)` (0.2.0:
  general composition — "trusted, then latest" is `chain[byAuthorRank, byTimestamp]`) /
  `lexById`. `MergeFn` =
  max/min/sum/count/and/or/concatSorted. **This is the reduction library** (latest = `pick
byTimestamp`; trusted-first = `byAuthorRank`; set-union = `all`; contested = `conflicts`).
  Confirmed nuance: `conflicts` surfaces a property **only when ≥ 2 distinct values contend** —
  an agreed single value resolves to absent (superposition is for the contested, not the settled);
  and every `Order` chain ends in an implicit `lexById` tiebreak, so resolution is total and
  deterministic.
- **Snapshots** — a resolved `View` is content-addressed via `viewCanonicalHex`; a `HView` via
  `hviewCanonicalHex`. Static view = snapshot = a commit.
- **Self-hosting hyperschema-schema** — `HYPER_SCHEMA_SCHEMA: HyperSchema`, `loadSchema(dset, entity) →
HyperSchema` (deltas → hyperschema), `publishSchemaClaims(schema, …) → Claims` (hyperschema → deltas),
  `definitionRoles()`. Hyperschemas are data; the metacircular seed is already written.
- **The reactor** — `ingest` (verifies content-addressing and any signature; unsigned deltas are
  accepted, ones whose id does not match their claims rejected without trace); live indexes
  (`byTarget`/`byValue`/`negationsOf`);
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
- **Reflective plumbing** — terms, schemas, and predicates are serializable (`term-io` / `term-json`)
  → storable as data. Since 0.2.0: **`inView` reflective predicates** (a predicate satisfied
  when the candidate's author/id appears in a view extracted — by field or by ROLE — from a
  DSet-sort sub-term over the same delta-set; stratified depth-1, enforced at parse), and
  **`evalPred`** is exported (single-delta predicate evaluation — translation recognizers).

**Provenance.** The substrate, not Loam code — `@bombadil/rhizomatic` (frozen/normative, §1). Verified
name-for-name and semantics-for-semantics against the real package by the step-1 spike ([#2](https://github.com/bombadil-labs/loam/pull/2), 27 tests over four claim-clusters); the `inView`/`evalPred` additions arrived with the 0.2.0 bump the federation and trust work required. Refinements the spike found were folded back into this section, never worked around.

## 3. Loam's actual scope — what to build

- **The GraphQL interface** — GraphQL derived from `HyperSchema` + `Schema`, exposing `query` /
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
- **The genesis assembly** — bundle `HYPER_SCHEMA_SCHEMA` + accounts + names + function/trigger schemas
  into a shippable genesis every store is born from.

**Provenance.** Foundational scope framing — no single landing PR; each bullet is realized section-by-section across the build: persistence (step 2, [#3](https://github.com/bombadil-labs/loam/pull/3)), the read/write gateway (steps 3–4, [#4](https://github.com/bombadil-labs/loam/pull/4)/[#5](https://github.com/bombadil-labs/loam/pull/5)), accounts & capabilities (step 5, [#7](https://github.com/bombadil-labs/loam/pull/7)), the transport (step 6, [#8](https://github.com/bombadil-labs/loam/pull/8)), the runner & genesis assembly (step 7, [#9](https://github.com/bombadil-labs/loam/pull/9)), and CLI/deployment (step 8, [#10](https://github.com/bombadil-labs/loam/pull/10)). Full narrative in the [Journal](JOURNAL.md).

## 4. The object model & flow

`deltas —[Hyperschema: gather]→ Hyperview —[Schema: resolve]→ View`. Two stages, kept separate: one
`HView` backs many resolutions; one schema runs over many hyperviews.

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

**Provenance.** Landed — the two-stage gather/resolve split rides the gateway's own verbs: [#4](https://github.com/bombadil-labs/loam/pull/4) (`query` → snapshot **View**) and [#5](https://github.com/bombadil-labs/loam/pull/5) (`subscribe` → live **dynamic view**, patch stream). Lives in `src/gateway/gateway.ts` (`Gateway.query`, `Gateway.subscribe`, the `Channel` patch stream) atop rhizomatic's `resolveView` and reactor materializations (§2). One `HView` really does back many resolutions in the code — gather and resolve stay two honestly separate steps all the way to the wire.

## 5. The gateway (Loam's only surface)

HTTP, CLI and MCP interfaces exposing GraphQL: **`query`** (resolve → snapshot), **`subscribe`** (live →
snapshot + patches), **`mutate`** (a schema's write-resolvers turn field-args → deltas → append),
**`loadSchema(deltas) → schema`** (append schema-defining deltas, meta-resolve via `HYPER_SCHEMA_SCHEMA`,
return it). Nothing is reachable except through GraphQL over a schema — including schema CRUD.
**Schemas are always built from deltas.** Underneath there are two primitives — **`append`** and
**`resolve`** — and `query`/`mutate`/`loadSchema`/`subscribe` are framings of them. Query is
reflective (resolving a schema is itself a resolve); snapshots amortize the reflection (meta-resolve
once at snapshot time, read cheap thereafter).

**Registration (decided 2026-07-09, step 10 — cutover from step 7's blob form).** A schema is
DEFINED by hyperschema-schema deltas — rhizomatic's `publishSchemaClaims` shape (`rhizomatic.hyperschema.defines` /
`.name` / `.alg` / `.term`) filed at a schema entity, `schema:<Name>` by default. A REGISTRATION is
a separate delta under `loam.registration` holding only references: a `hyperschema` pointer to the
definition entity, the `schema` (the resolution program) as canonical JSON, and the roots. The
GraphQL surface is generated: `readRegistrations`
meta-resolves each referenced entity via `loadSchema` over the store's surviving definitions —
so **evolution is append** (republish at the same entity; the running gateway rebinds — the
reactor has no deregister, so live materialization names are generation-qualified internally —
and a reopened store replays the latest shape) and **deprecation is negation** (a negated
definition leaves its registration unbound; the type drops from the surface). The schema's
identity is the **entity**, not the name. In a governed store only operator-authored definitions
and registrations bind — a federated foreign definition merges as a delta but reshapes nothing
(the same operator-rooting that keeps foreign grants inert). The policy — a Schema — carries no
hyperschema-schema and needs none: it is the reader's lens, not the entity's shape, and travels as
canonical JSON. The register surface is `POST /:mount/register` (operator token), the
`loam_register` MCP tool, and `loam register <file>` — an HTTP endpoint rather than a GraphQL
mutation because an empty store has no GraphQL surface to mutate through; the endpoint IS the
hyperschema-schema mutation mechanism, and GraphQL stays strictly derived-from-what-is-registered.

**Writes become claims (decided 2026-07-09, step 12 — queued).** A schema is a _protocol_: the
read program (the hyperschema body) and the **write discipline**, both data, both traveling in
the registration. The point of writing through a mutation is the SHAPE GUARANTEE — everyone who
adopts a published schema emits byte-compatible facts — so the shape is declared, never
inferred (a read program at one root cannot determine what the fact looks like from the other
roots; one delta serves many views).

- **Claim templates**: a registration may declare named mutations, each a pointer skeleton with
  argument holes (`{ role, at?/value?, context? }`); the GraphQL mutation derives its args from
  the holes and emits ONE signed multi-pointer delta — a hosted screening with host, film,
  guests, and date is one delta filing into four entities' views. Today's primitive-prop
  mutations remain as the auto-derived degenerate template. At registration time each template
  is **trial-proven against the schema's own body** (generate a specimen, evaluate the gather,
  refuse a template whose output its own reads would never see) — prove before persist, as
  everywhere.
- **The generic claim**: a `_claim(pointers: […])` mutation for shapes no template anticipated —
  same signing, same standing, no schema sugar.
- **Raw append** (`POST /:mount/append`): pre-signed wire deltas, verified and admitted under
  the author-standing rule — the non-custodial path, where the server never holds the key.
- **Both hashes on the surface**: `_hex` (the resolved view's canonical bytes — the answer) and
  `_hviewHex` (the gathered hyperview's — the evidence). Two lenses over the same ground share
  `_hviewHex` while their `_hex` diverges exactly when their schemas adjudicate differently.
- **Foreign dialects are transformed, not rejected**: deltas expressing the same ideas in other
  shapes merge as always; a runner binding reads them and emits canonical-shape deltas citing
  their sources (the §9 provenance discipline). Standard shape by guarantee for your own
  writers; translation for everyone else's.

**Provenance.** Landed — [#4](https://github.com/bombadil-labs/loam/pull/4) (the read gateway: `query`/`loadSchema`), [#5](https://github.com/bombadil-labs/loam/pull/5) (`mutate`/`subscribe`), [#13](https://github.com/bombadil-labs/loam/pull/13) (registrations-as-deltas: evolution is append, deprecation is negation), and [#15](https://github.com/bombadil-labs/loam/pull/15) (writes become claims: templates, the generic `_claim`, raw append, `_hviewHex`). Lives in `src/gateway/gateway.ts` (`Gateway`) and `src/gateway/registration.ts` (`readRegistrations`, `schemaEntityFor`, `registrationClaims`). Key decision: the schema's identity is the **entity**, not the name, so a republish at the same entity rebinds the running gateway with no restart.

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

## 7. Object-capability & accounts

No ambient authority, anywhere. A user's write permission and a function's effect access are the same
construct: an explicit, signed, reified **capability grant** (a delta granting a reference). Accounts
/ capabilities are core genesis schemas; enforcement is gateway code, rooted in an operator identity.
Capabilities are auditable, time-traveled, revocable. Multi-tenancy at deployment scale is the mount:
one mount = one store = one isolated world.

**(revised 2026-07-09 — authors, not owners.)** The original step-5 model gated writes on the
tenancy of every entity a delta touched — an ownership model of ids. That was wrong, and Myk
called it: **entities are unowned.** Pointer resolution is string matching; nobody owns an id; a
delta is never a free-floating fact about an entity but an assertion _from a perspective_ — some
author, originating on some instance. Anyone with standing may point at anything. The question is
never "may this be said?" but "who listens?", and that question is answered on the
**read/merge/accept side**, by composable policy — exactly as the constitutional slice already
works (foreign grants, registrations, and definitions merge freely and bind nothing).

- **The write gate is the author's standing on the instance, not the target's tenancy.** A store
  signs and persists only for authors its operator's chain granted `write` — a grant rooted at
  the store entity (`loam:store`), minted by the operator or an `admin` grantee. It is a
  publishing relationship ("may this author publish through this door"), resource gating rather
  than truth gating. The operator needs no grant; an ungoverned store (no operator) welcomes any
  verified author. Callers act as themselves (`{ actor }` per request); grants key on authentic
  authorship; **revocation is negation**; audit is a query.
- **Effectiveness is a chain, unchanged.** A grant governs only if it roots in the operator; a
  registration binds only if the operator authored it; a binding definition installs only if the
  operator blessed it. Open writes make nothing governable that wasn't — they only stop
  pretending the store can fence what ids mean.
- **Negations are assertions like any other.** Standing to append one is the same publishing
  standing; _whose negations a reader honors_ is lens policy. Constitutional readers
  (`grantHeld`, `readRegistrations`, `readBindingDefinitions`) honor only lawful strikes — the
  operator's, or an effective store admin's. **For DATA, the principled lens landed with
  rhizomatic 0.2.0** ([rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2)
  delivered): `governedGatherBody(operator)` masks with an `inView` trusted set — the operator
  plus the operator's grantees, resolved from the live delta-set — so a federated stranger's
  strike is inert while the community's bind, and revoking a grant un-binds its author's
  strikes on the very next read. `tenantSchemaFor(operator)` gives the AUDIT view the same
  discipline (operator + operator-minted admins — what `standsFor` demands), so **audit and
  door move together through the chain's first link** (an operator-minted admin's strike binds
  both — pinned by test). Residuals, stated plainly: the trusted sets reach ONE link — subjects
  of OPERATOR-authored grants surviving OPERATOR-signed strikes (stratification bans
  inView-in-inView, so the chain cannot recurse inside a lens) — therefore standing minted by
  an admin binds enforcement but never enters a lens's trusted set, and an admin's revocation
  bars the door without, by itself, removing the revoked author from the trusted sets; plain
  `mask drop` bodies still honor every present negation BY CHOICE; pre-striking a
  not-yet-arrived delta id remains possible for whomever a lens trusts (narrowed, not
  confined, by governed bodies); and per-tenant admin chains still mint community-vocabulary
  grants while constitutional strikes require store standing — revisit with trust-is-data
  (step 13).
- Tenant machinery (`loam.tenant` / `loam.members` / `loam.grants`) survives as **vocabulary for
  author-communities and read lenses**, not as write fences.

**Provenance.** Landed — [#7](https://github.com/bombadil-labs/loam/pull/7) (step 5: tenants, membership, grants as signed deltas), [#14](https://github.com/bombadil-labs/loam/pull/14) (step 11: the authors-not-owners revision — the write gate moved to author standing), and [#17](https://github.com/bombadil-labs/loam/pull/17) (rhizomatic 0.2.0 adoption: `inView` lenses). Lives in `src/gateway/accounts.ts` (`authorize`, `holdsGrant`, `governedGatherBody`, `tenantSchemaFor`, `constitutionalDefect`). Key correction (Myk, out of the village field test): entities are unowned — the write gate asks only "does this author have standing," never what the delta points at; truth-telling moved entirely to the read/merge side.

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
  button); replaces a tailscale-exposed box with a plain authed HTTPS endpoint. Implemented
  (step 8): a `Dockerfile` (node 22-slim, non-root, `loam serve --http`, store on a `/data`
  volume) and the `loam` CLI. **Hosted persistence is a driver, not an image change**: the
  `StoreBackend` seam (step 2) is satisfied by any async append/`deltasSince`/close, so a libSQL
  driver (`@libsql/client` against a Turso URL) drops in beside `SqliteBackend` with no gateway,
  server, or CLI change — the same file format, hosted and replicated. (Not vendored here: it
  adds a dependency for a path that needs a live Turso account to exercise; the seam is the
  deliverable, the driver is a one-file addition when a deploy needs it.)
- **Federation** — rhizomatic's `Peer`/`syncBoth` over the authed HTTP surface + a "subscribe to
  instance X's published lens" declaration. `deltasSince` is one primitive at every scale.
- **Trust is data (decided 2026-07-09; LANDED as step 13).** What a store admits at federation is
  CONFIGURATION, and configuration — like everything else — is a derived view over deltas that
  are always updating. An operator-authored **trust policy** lives in the store under
  `loam.trust`: a mode (`open` — the aggregator welcoming the whole network; `roster` — named
  authors/peers; `closed`) plus optional shape requirements (deltas must satisfy a predicate —
  "conforms to the standard"). Every pull re-resolves the policy from the live store and builds
  its `admit` function from the RESULT — change the roster with a delta, and the next pulse
  behaves differently, no restart, no config file. (The same dynamic set reaching INSIDE
  eval-time negation masks awaits reflective predicates —
  [rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2); admission is the
  application-layer half we can have today.)
- **Divergent dialects are normalized, never mutated (decided 2026-07-09; LANDED as step 14).**
  There are no global standards; a peer's deltas may express the same ideas in another shape.
  The wrong moves are rejection (union is union) and mutation (nothing is ever edited). The
  right move is MORE DELTAS: a **translation** is data — an operator-blessed spec pairing a
  recognizer (a predicate over foreign deltas) with an emit template (step 12's claim shapes,
  holes bound from the recognized delta's pointers) — executed by a generic translator running
  as a runner binding. Each emitted delta is canonical in the local dialect, signed by the
  translator identity, and CITES its source delta by id (a `translates` pointer — the §9
  provenance discipline). The foreign originals persist untouched beside their normalizations;
  the local standard views light up; a better translation later is just another pass over the
  same immortal sources.

**Provenance.** Landed — [#10](https://github.com/bombadil-labs/loam/pull/10) (CLI + deploy: the `loam` command, Dockerfile), [#11](https://github.com/bombadil-labs/loam/pull/11) (federation: union at the substrate), [#18](https://github.com/bombadil-labs/loam/pull/18) (trust is data), and [#19](https://github.com/bombadil-labs/loam/pull/19) (normalization/translation). Lives in `src/cli/` (`bin.ts`, `cli.ts`, `config.ts`), the `StoreBackend` seam (`src/store/backend.ts`, `src/store/sqlite.ts`), `src/federation/` (`offer.ts`, `pull.ts`, `wire.ts`, `translate.ts`), and `src/gateway/trust.ts` (`loam:trust`). Key decision: federation is union at the substrate, not a governed mutation — `gateway.federate` deliberately skips `authorize`, so whether a peer's facts shape a local view is a read-time trust choice, never a write denial.

## 9. Constraints & invariants

- **Append-only, everything** — including materializations: a snapshot is never mutated; recompute
  yields a new snapshot (new id, new timestamp). Nothing is edited; the store only learns.
- **Content-addressed identity** — the same delta/snapshot is the same everywhere; merge is union;
  two resolutions over the same deltas converge to the same hash.
- **Object-capability always** — no ambient authority in the gateway, functions, or federation.
- **rhizomatic is frozen** — the one live candidate for a substrate change is a resolution reduction
  `Policy`/`Order`/`MergeFn` cannot express (unlikely; confirm in the spike). Any real need is a
  PR + conversation with Myk, never an edit from here.
- **Vocabulary reconciles to rhizomatic** — `HyperSchema`, `HView`, `View`, `Schema`, `Policy`,
  `DerivedFn`, `BindingSpec`. Metaphor lives in the product name (Loam), never in the load-bearing nouns.
- **If Loam ever ingests a legacy EAV store** (e.g. Chorus's current one): the honest path is an
  opt-in streaming transform that **appends** typed deltas, signs as the migrator, cites the source
  deltas (provenance), and never re-signs as the original authors.

**Provenance.** Foundational — no single landing PR; these are the invariants every step (0–14) is tested against, not a feature any one of them introduced. Append-only, content-addressed identity is enforced in `src/store/canon.ts` and every `StoreBackend` driver (`src/store/*.ts`); object-capability discipline lives in the gateway's `authorize` seam (`src/gateway/`). The rhizomatic-frozen and vocabulary-reconciliation rules are process, not code — held by CLAUDE.md and this SPEC. Full narrative in the [Journal](JOURNAL.md).

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

**Provenance.** Foundational / reference-only — no landing PR. Decided (Myk, 2026-07-09): [chorus](https://github.com/bombadil-labs/chorus) is read as a design guide only — its seams, its edge cases, its lessons — never as a dependency or a source of copied code; Loam's plumbing is written clean, against Loam's own tests, and no EAV residue rides in. This section is a map for future readers, not a build record.

## 11. Erasure — degrees of forgetting

GDPR Art. 17 and plain conscience both demand that a store can truly forget. The architecture
makes this cheaper than it sounds: **Loam's immutability is per-fact, not global** — the ground
is a set, not a chain, so no delta's identity depends on another's existence. Erasing one fact
costs one fact plus whatever cited it; nothing structural breaks. The design principle
throughout: **the store remembers THAT it forgot — who asked, when, and which id — never
what.** Content addressing lets a store refuse a delta forever while retaining zero bytes of
its content.

- **The tombstone.** An erasure is a signed claim at `loam:erasure` (context `loam.erasure`)
  naming the delta id and its author (`spoken-by`, the compliance record). **Authority is the
  INSTANCE OPERATOR's alone** (decided 2026-07-10): erasure is destructive, and the substrate
  cannot stop anyone from *minting* a removal-order, so the store must be certain never to
  *accept* one its operator did not sign. Not the record's author, not a grantee, not a peer —
  a data subject asks, and the operator, as the controller, executes. Every door (append AND
  federation) runs `eraseDefect` and refuses a tombstone the operator did not sign, so an
  unauthorized removal-order is never even stored; the readers then bind only the operator's.
  Tombstones are append-only forever — the erasure log is itself the compliance record — and a
  tombstone cannot itself be erased. An ungoverned store (no operator) honors no erasure.
- **The purge.** A new, loud seam operation — `StoreBackend.purge(ids)` — a NAMED exception to
  grow-only, exactly as mirror-lag is a named exception to every-failure-rejects. Purge must
  reach every tier: the sqlite row, the mirror, the archive's fan file. **`heal()` must consult
  tombstones and never resurrect a purged id** (the crash in reverse — this interaction is where
  the bugs will hide; test it first).
- **The door remembers the hole.** Admission (federate AND append) composes the tombstone set:
  a tombstoned id is refused re-entry forever — a hash-set check, cheap. Union normally lets
  anything return; the tombstone is how forgetting sticks against the store's own gossip.
- **The manifest.** Before purging, compute the blast radius — which registered
  materializations reference the id, which deltas cite it as provenance — and show it. Cascade
  to derived emissions (translations of the erased fact) is a per-store policy; GDPR usually
  wants cascade.
- **Federated forgetting is per-instance.** A tombstone is one operator's order over one
  store's ground; a peer refuses a foreign operator's removal-order at the door. So erasure
  does NOT auto-propagate — each store's operator independently decides to honor a request (a
  forged or malicious order can never cascade a deletion across the network). A request may
  travel as ordinary data (an "erase me" claim a controller acts on), which is GDPR Art. 17(2)
  — "inform downstream controllers" — done as data; compliance is TESTABLE per store: ask that
  store for the id and see what returns. No recall of pre-request copies; precision and
  auditability, not magic.
- **Degrees — all built from purge + tombstone + reassert; NEVER in-place mutation.** The id
  hashes the claims (author included) and the signature binds them; an edited delta fails
  recomputation and is refused as corruption by every driver. That rigidity is load-bearing:
  erasure authority must never be forgery authority.
  1. **Full erasure** — purge + tombstone. Gone; the hole is signed.
  2. **Anonymous reassertion** — the operator re-speaks the content in the store's own voice,
     then purges the original. **No on-record link between old and new** — content addressing
     is a confirmation oracle (hash the preserved content + timestamp + each candidate author
     against the old id; the roster is a small brute-force space). Author-derived lens weight
     (byAuthorRank, trust masks) degrades BY DESIGN — "anonymize but keep my earned ranking"
     is trust laundering.
  3. **Sealed authorship** — the reasserted delta carries one pointer:
     `hash(salt ‖ author)`. Anonymous today; reveal the preimage to reclaim your words
     whenever you choose. Reversible anonymity, no new cryptography.
  4. **Partial redaction** — reassert with specific pointer VALUES replaced by a redaction
     marker; the fact survives, the sensitive field does not.
- **The replacement is the operator's to append.** Anonymous reassertion (rung 2) is the
  operator re-speaking the content in the store's own voice — a normal append the operator
  signs, not an auto-propagating order (erasure is per-instance, above). The reassertion
  inherits the source timestamp, so it is content-addressed and idempotent (the translation
  trick): two operators who independently honor the same request converge on one anonymous copy
  without coordinating.
- **Honest boundary.** This is rigorous severance/pseudonymization; true anonymity is a
  property of the content itself (timestamps correlate, style fingerprints). Rung 4 is the
  tool for content-side scrubbing; no substrate can do it for you.

**Provenance.** Landed — [#34](https://github.com/bombadil-labs/loam/pull/34) (the erase seam), [#36](https://github.com/bombadil-labs/loam/pull/36) (the law slice: authority → manifest → tombstone → purge), [#38](https://github.com/bombadil-labs/loam/pull/38) (operator-only gating + hardening). Lives in `src/gateway/erase.ts` (`Gateway.erase`, `eraseDefect`) and the tombstone readers (`readTombstones`, honored at both the append and federation doors). Key decision (Myk, 2026-07-10): erasure is the instance operator's alone — a data subject asks, the operator executes — and the signed tombstone refuses the exact bytes' return by id, so the store remembers THAT it forgot without keeping what.

## 12. The open door — public reads & the browser client

The aggregator dream needs a store a stranger's browser can simply read.

- **Anonymous read as data.** An operator-signed claim (context `loam.public`) names which
  registered schemas a mount serves WITHOUT a token — query + subscribe only; every write path
  stays gated. Consistent with trust-is-data: the open door is a delta, revocable by one
  negation, live on the next request. Serve adds CORS for public mounts.
- **The browser client.** A subpath export (`@bombadil/loam/client`), zero node-only deps:
  keygen in the page, claims signed locally, writes through `POST /append` (non-custodial —
  the token authenticates transport; the delta's own verified author is the authority, which
  is why this endpoint already exists), GraphQL query + SSE subscribe wrappers. **Spike done
  (2026-07-10, GREEN):** rhizomatic's signing and hashing are pure JS (`@noble/curves`,
  `@noble/hashes`) — browser-safe, no rhizomatic change needed. The one care point: bundle the
  crypto primitives without pulling rhizomatic's `node:http` peer transport (import
  `signClaims`/`makeDelta`/`authorForSeed`, not `Peer`/`servePeer`).
- **The notary pattern (optional, cheap).** An operator claim carrying the store's frontier
  hash may be anchored to any external notary (a chain, a newspaper, RFC 3161). The chain
  becomes a timestamp service for the vault; the world stays in Loam.

**Provenance.** Landed — [#43](https://github.com/bombadil-labs/loam/pull/43) (public reads as data, and the browser client; SPEC §12 landed whole). Lives in `src/gateway/public.ts` (`loam:public` declarations, `publicDefect` refused at both the append and federation doors) and `src/client/index.ts` (`@bombadil/loam/client`, non-custodial: keygen in-page, local signing, fetch-based SSE). Key decision: the anonymous GraphQL schema carries no Mutation type at all, so a tokenless write is a validation impossibility rather than a policed string; per-door budgets (`maxPublicWatches`, `maxPublicStreams`) confine a stranger's resource cost to the stranger's door.

## 13. Boundaries & posture — what Loam refuses to be

Red-teamed 2026-07-10; these are the honest edges, stated proudly. Strong paradigms host
their own opposition.

- **No scarcity.** Pure union cannot express "exactly one, and Alice owns it" — no
  double-spend answer, no inventory invariants, by design. Where ordering is genuinely the
  point, a store may be the ORDERING AUTHORITY for its own narrow context (operator-signed
  sequence claims): centralize exactly there, nowhere else. We did not beat CAP; we chose AP
  and made peace.
- **No write-time invariants.** "Balance never negative" is a lens-level judgment; two readers
  may disagree about whether your invariant held. Loam is for facts and testimony, not state
  machines.
- **No causal order.** Timestamps are testimony, gameable by construction; trust-ordered
  lenses (chain orders, rosters) are the mitigation, not a logical clock. We chose union over
  happens-before.
- **No network-wide recall.** Erasure (§11) is precise and auditable, never magic.
- **Power migrates to defaults.** The reader decides everything — so in practice, whoever
  ships the default lens, the winning registry, the schema-writing steward holds real power.
  The only honest defense: the default layer stays inspectable data with one-delta switching
  costs. Vigilance gets cheaper, never unnecessary.
- **Patterns that answer the standard objections:**
  - _Deprecation-by-rebirth_ (generational compaction): mark the old store read-only, query
    out what matters, seed a new store with those SAME deltas — ids and signatures intact, so
    compaction never launders provenance — and keep the old store as the cold audit trail.
  - _Reassertion-as-endorsement_: re-signing identical content in your own voice is
    endorsement with skin in it; convergent reassertion is a trust signal lenses can consume.
    Deltas never belonged to stores; a dead store orphans nothing.
  - _Coordination is an optimization, not a prerequisite_: a schema registry is just a store
    whose crop is vocabulary — it federates, it has trust rosters, competitors coexist, the
    reader picks. Failed coordination costs one translation delta, written after the fact,
    with provenance.

**Provenance.** Foundational — a posture record, not a build. Drafted 2026-07-10 in the same red-team night session that also spawned §11 (erasure, [#34](https://github.com/bombadil-labs/loam/pull/34)/[#36](https://github.com/bombadil-labs/loam/pull/36)) and §12 (the open door, [#43](https://github.com/bombadil-labs/loam/pull/43)), whose landings are this section's evidence rather than its own PR. These are boundaries stated proudly and held, not code shipped. Full narrative in the [Journal](JOURNAL.md).

## 14. Write semantics — mutation is the dual of resolution

**Planned — designed, not yet built; blocked on an open question.** The full design — assert and
retract as the only two primitives, each policy kind inducing (or declining) its own write
discipline, clearing-as-absence rather than a null value — lives in [TODO.md](TODO.md) until it
lands, at which point its PR migrates it here with a Provenance footer. The open question holding
it: when a field's policy admits OTHERS' claims, does "clear" mean retract-your-own or lens-scoped
suppression of every admitted contributor — and who may negate another's delta? Resolve with Myk
before implementation.

## 15. The browser peer — a full store in the page

§12 gave the page a CLIENT — keys minted and claims signed in the browser, a served store's door
on the other end. This section gives the page the STORE. A complete Loam — gateway, genesis,
law, lenses, erasure, trust, federation — boots in a tab, persists in localStorage, and needs no
server anywhere. It is not a lite mode and there is no fork: §8 already made "where the deltas
sleep" a driver's business, so the browser peer is the same `Gateway` on a different driver. It
is born governed, answers GraphQL, honors tombstones, resolves its trust policy live, and can
pull the network. What it cannot be is a place the network calls — stated proudly below.

- **The surface — `@bombadil/loam/browser`, a curated barrel.** The root barrel (`src/index.ts`)
  re-exports `serve`, sqlite, the archive, and the CLI, so a browser entry must CHOOSE, not
  filter. It exports: the whole `Gateway` (boot / query / subscribe / append / federate /
  publishRegistration / erase), `assembleGenesis` + `operatorMarkerClaims`, `MemoryBackend` +
  **`LocalStorageBackend`** + the `StoreBackend` type, the claim constructors (`grantClaims`,
  `membershipClaims`, `revocationClaims`, `trustClaims`, `publicClaims`, `eraseClaims`,
  `registrationClaims`, `translationClaims`), the readers (`readRegistrations`,
  `readTrustPolicy`, `readTombstones`, `holdsGrant`), federation (`pullFrom`, `toWire` /
  `fromWire`), the `Runner` (an animate tab is a deploy choice too, §6), `mintSeed` /
  `authorForSeed` — and the substrate primitives the surface is SPOKEN in: `parseTerm`,
  `parseSchema`, `signClaims` (learned building it: without these a page could hold a schema
  but never say one — the claim constructors return unsigned claims, and `assembleGenesis` /
  `publishRegistration` take terms and schemas the page must be able to parse from JSON).
  Deliberately absent: `serve` (there is no port), `SqliteBackend` /
  `ArchiveBackend` / `MirrorBackend` (there is no fs), the CLI. Shipped exactly as `./client`
  is — a second esbuild entry (`src/browser/index.ts` → `dist/browser/index.js`), platform
  browser, the same `node:http` stub alias, one self-contained ESM file — pinned by the same
  discipline: zero `node:` specifiers, and the bundle must BOOT (genesis → register → claim →
  query, all inside the artifact). `graphql` rides along (pure JS); the bundle is store-sized,
  not client-sized — said plainly, not hidden.

- **`LocalStorageBackend` — one key per delta.** Key `loam:<store>:<id>`, value the delta's
  canonical wire JSON. Chosen over a single blob because the seam chose it first: per-delta keys
  make append O(batch) not O(store), make purge a `removeItem`, and make two handles on one
  origin converge to the union by construction — a blob is last-writer-wins, which is data loss
  wearing simplicity's clothes. (And in devtools the store reads as what it is: content-addressed
  facts, one per row, the id in the key — the pedagogy is free.) Write-through, no snapshot tier:
  localStorage is synchronous, so durability is the same instant as acceptance. Reads recompute
  every id and verify every signature — a row edited in devtools is corruption, refused, exactly
  as a tampered sqlite row is. Quota is this disk's edge: a `QuotaExceededError` mid-batch removes
  the keys the batch already wrote, then rejects the whole batch — atomic, as the seam demands —
  and the gateway latches its existing degradation ("this gateway can no longer persist"): reads
  keep answering, writes refuse loudly, and the remedy is export (below) or a bigger driver.
  IndexedDB is a later drop-in behind the same seam — capacity is a driver's property, never a
  semantic change.

- **The seed lives at its own key** (`loam:<store>:seed`), never under the delta prefix — so no
  export of deltas can carry key material by accident, structurally. Custody in the same register
  as §5's server-seed note: the key is page-resident, and anything that can run script on the
  origin — XSS, a hostile extension, a shared machine — can sign as this store's operator. A
  browser store's law is exactly as trustworthy as the page holding its pen. For a tutorial store
  that is fine, and said so; for anything more, keep the operator seed in the user's own custody
  and let the page be a granted author (§7), or a §12 client of a served store.

- **One writing tab.** localStorage is shared per-origin, and per-delta keys keep the STORAGE
  convergent (union by id — the same guarantee two sqlite handles keep), but a gateway reads its
  backend once at boot and holds no live view of another writer (§8's stated posture). So: one
  writing gateway per store; a second tab sees the union at its next boot; cross-tab liveness is
  federation's job, not a driver's improvisation with storage events.

- **Federation posture, honestly.** A browser store can PULL — `pullFrom` in a tab is an
  aggregator with a URL bar (CORS on public mounts already serves this) — and can PUSH — sign
  locally, `POST /append` at a served peer, the author-standing rule unchanged. It cannot BE
  PULLED: a browser cannot listen, so no peer can ask it `deltasSince`. A browser store is a leaf
  or an aggregator, never a hub. The compensations are already in the architecture: push what
  matters to a served peer (which CAN be pulled — the relay pattern), or export. Two stores in
  ONE page need no HTTP at all — federation is a direct `local.federate(other.offeredDeltas())`
  call; the HTTP pull was only ever the transport. Deltas never belonged to stores (§13); a tab
  closed forever orphans nothing anyone copied.

- **Erasure reaches the page.** Tombstone → `purge` → `removeItem`: the bytes leave the origin's
  storage, and the door refuses the id's return, same law as everywhere (§11). Per-instance as
  ever — erasing here says nothing about copies already pushed or exported. And the browser's own
  "clear site data" is an unceremonious full erasure — deltas, tombstones, and seed alike — which
  is exactly why export exists.

- **Continuity — the store walks out of the browser.** An export is a frozen federation offer:
  `{ deltas: WireDelta[] }`, byte-identical to a `GET /federate` body, ids and signatures intact —
  so migration never launders provenance (§13's rebirth pattern, verbatim). Landing it is one
  command, one door, two sources: **`loam pull <url|file>`** — a live peer or a frozen offer, both
  through `Gateway.federate` (trust-admission; no standing needed; tombstones still bar the door).
  Then the fork, and the operator decides it:
  - **Same operator** — `loam init --seed <hex>` with the browser's seed, then `loam pull
    export.json`. Genesis is pure, so the CLI store IS the browser store — the operator marker is
    the same delta by content address — and every registration, grant, trust claim, and tombstone
    in the export is operator-authored here too, so THE LAW BINDS on arrival. A store born in a
    tab, served from a laptop; nothing re-signed, nothing lost.
  - **Foreign operator** — the deltas cross (union is union) and the testimony is all there; the
    law stays inert, exactly as §5/§7/§14 promise: foreign registrations reshape nothing, foreign
    grants gate nothing, foreign tombstones erase nothing. Re-register your own lenses over the
    imported ground, translate its dialect if it differs (§8), reassert what you endorse (§13).
    Data federates; authority never does.

- **Boundaries, in the §13 register:** no listener — we did not smuggle WebRTC into a footnote;
  ~5 MB and one origin — quota and same-origin policy are this deployment's walls, and the seam is
  the door out; key custody is page custody; timestamps come from a clock the user owns
  (testimony, §13 — only more so); erasure-in-a-tab erases one replica.

**Provenance.** Landed — [#51](https://github.com/bombadil-labs/loam/pull/51) (the browser store: `LocalStorageBackend` + the `@bombadil/loam/browser` barrel), [#52](https://github.com/bombadil-labs/loam/pull/52) (aftermath hardening), [#53](https://github.com/bombadil-labs/loam/pull/53) (continuity: `loam pull`, export). Lives in `src/browser/index.ts` and `src/store/local-storage.ts`. Learning that stuck: a raw NUL byte in `gateway/erase.ts`'s commitment preimage had made the file grep-invisible, hiding a `node:crypto` import that blocked the whole gateway from bundling — the byte became its escape sequence, and the fix is the reason the law bundles clean today.

## 16. The interactive tutorial — learn Loam by growing one

The browser peer (§15) makes a real store cheap to hand a stranger, so the tutorial hands them
one and gets out of the way. It ships as a GitHub Pages static site: no signup, no server, no
install until the last step. The learner boots a live governed store in the page and performs
real tasks against it; every lesson's completion is checked by a REAL READ of their store (a
predicate over a query or the ground), never a quiz answer. The right-hand pane — **View |
Ground | GraphQL** — teaches §4's gather/resolve split by simply existing: the same store shown
as its resolved answer, its raw signed deltas, and a live console, side by side.

**It stands alone.** A stranger arriving at the URL has never seen Loam, has run nothing locally,
and knows none of this document. Every concept is taught from zero; the cast and narrative are
the tutorial's own (Alice, Bob, a self-explanatory adversary); no lesson leans on another the
learner skipped, and nothing is installed until the finale. The acceptance bar is that the
writing is apprehensible cold — not only that the code runs. (Internally: the arc reprises
patterns the village (`demos/village`) already proves, so the mechanics are exercised and sound;
the village is never named or assumed on the site.)

**Two stores, because federation is the point.** The learner owns a **media log** (films and
books; a watch is an event with a date, a rating, and GUESTS). A second, bundled store — **the
circle** (Alice, Bob, and friends, pre-signed under their own operator) — describes people. A
guest on a watch is a bare id (`person:alice`) that means nothing in the media store alone; it
lights up with a name and relationships only once the learner federates the circle. "Alice was
just an id until you pulled the store that knows her" is federation taught in one gesture, and it
falls out of the domain rather than being staged.

- **The domain, sketched.** `media` (learner is operator): `Film` (`title` — a `pick` that becomes
  a trust-`chain` in the adversary lesson; `rating` — a `pick`, clearable to absence; `tags` — an
  `all`, added mid-tutorial; `timesWatched` — a `merge count`; `lastWatched` — a `merge max`;
  `watches` — an `expand` into the watch events); `Book` (`pagesRead` — a `merge sum`; `finished`
  — `absentAs false`); `Watch` (a multi-pointer claim template filing into the film's history, the
  timeline, and each guest's card at once). `circle` (bundled, foreign): `Person` with `name` and
  `friends` (an `expand`). The learner may file a private `note` about a guest in their OWN store —
  the target the erasure lesson later removes.

- **The arc — four acts, eleven lessons.** Sovereignty: (1) mint a seed and boot a store — you are
  the operator, no account asked; (2) a fact is a signed delta that lands before any schema exists
  — the inspector shows `id = hash(claims)` and shatters it on a one-byte edit; (3) register a
  schema and the orphaned fact lights up as a View — nothing migrated, a lens was ground and the
  ground answered. The living record: (4) writes are claims — one multi-pointer watch files into a
  film and every guest at once; (5) retraction resolves to absence and aggregates cannot be
  set — clearing a rating empties the key, and a "set timesWatched" is shown for what it is
  today: one more counted claim, the count ticking up by one (when §14's write semantics land,
  this beat upgrades to a refusal with a reason — the lesson teaches whichever truth is
  shipped); (6)
  evolution is append — add `tags` live under a watching subscription that never disconnects.
  Other people: (7) trust and the adversary — a bundled forged claim wins under `pick byTimestamp`
  and loses under a trust `chain`, the forgery still in the ground, `_hviewHex` equal and `_hex`
  divergent; (8) erasure (§11) — a guest asks you to forget a private note; you walk manifest →
  purge → signed tombstone, and the door refuses the id's return; (9) federation — pull the circle,
  and your guests gain names and friendships while the circle's own law stays inert; (10) the open
  door (§12) — a tokenless "stranger at the window", refused all along, reads your public
  films-watched lens the moment you declare it, and only that. The door out: (11) the finale —
  export, `npm i -g @bombadil/loam`, `loam init --seed` + `loam pull`, `loam serve`, and the page
  fetches your localhost store and matches `_hex` hash-for-hash: not a copy, the same store, now
  durable and yours to federate.

- **The finale carries the seed, on purpose.** The export is `{ version, operator, seed, deltas }`
  and the seed rides in the file — because this is disposable tutorial data and the point is to SEE
  the store make the transit intact, the local store proving itself the same store by content
  address (§15's same-operator path). The site says plainly what §15 says: real data keeps its seed
  in the user's own custody; this convenience is the tutorial's alone. If a browser cannot reach
  `http://127.0.0.1` from an https page (Chromium's Private Network Access may refuse), the learner
  pastes the local `_hex` by hand and watches it match — carrying the hash across by hand is, if
  anything, the better lesson.

- **Progress is the store; the checks are real.** There is no progress database to drift: on every
  visit the page reboots the store from localStorage and re-verifies each lesson from the ground
  itself. The only way to "cheat" a check is to append the very deltas the lesson teaches, through
  the console — which is the curriculum entered by a side door, and the copy celebrates it. It is a
  tutorial, not an exam: a green mark never lies about the store's contents, and that is all it
  promises.

- **Architecture.** The site lives in this repo under `demos/tutorial/` (so it imports the same-commit
  browser bundle — version skew is impossible, and CI runs the whole arc as a test), built by
  esbuild like the client bundle and deployed by a `pages.yml` GitHub Actions workflow
  (`upload-pages-artifact` → `deploy-pages`; nothing built is committed, but the bundled packets —
  the circle, the adversary — are data and ARE committed, regenerated byte-identically from fixed
  seeds and timestamps). Zero framework: the store is the state and the UI is a subscriber, so a
  framework would plant a second source of truth precisely where the product's thesis is that there
  is one. The anti-rot guarantee is a test — `test/site/arc.test.ts` boots a store headless, drives
  each lesson through the same functions the UI calls, and asserts every check green in order,
  including the export → `init --seed` → `pull` → `_hex`-match round trip, so the finale's
  hash-for-hash claim is pinned in CI forever.

- **Dependencies on §15 (called out so the sprints sequence right):** the `dist/browser` bundle
  must expose the in-process anonymous read surface (`queryPublic` / `subscribePublic` /
  `NothingPublic` — already in the gateway) for lesson 10, and the `loam pull` verb for lesson 11.

**Provenance.** Landed as the MVP — [#54](https://github.com/bombadil-labs/loam/pull/54) (the eleven-lesson arc as data and functions), [#55](https://github.com/bombadil-labs/loam/pull/55) (the zero-framework theater: View / Ground / GraphQL), [#56](https://github.com/bombadil-labs/loam/pull/56) (the Pages workflow, the cold-reader copy pass). Lives in `demos/tutorial/`, anti-rot pinned by `test/site/arc.test.ts`. Superseded by the sixteen-lesson v2 arc (§19); kept here as the MVP's record, including the review catch that a vacuously-green finale check became a signed homecoming claim the check reads back.

## 17. Surfaces are materializations

GraphQL was never the surface. It was the FIRST surface. A registration — `(HyperSchema,
Schema)`, a gather and a resolution discipline, filed as deltas — is interface-agnostic truth,
and every interface a store answers through is a MATERIALIZATION of that truth, derived from
it the way a view is derived from the ground. §8 made "where the deltas sleep" a driver's
business; this section makes "how the answers are spoken" a generator's business. The
registration is the source; adding an interface never touches it; N interfaces over one store
answer the same ground, and two doors that disagree about lawful data are a bug by definition,
not a version skew to manage.

- **The seam — a surface generator.** What `gql.ts` consumes today (the gateway's `Registered`
  set: schema, policy, roots, mutations, generation) becomes a published seam, exactly as
  `StoreBackend` is one: every generator is an interchangeable witness to the registrations,
  and `buildGqlSchema` becomes the first implementation rather than the only consumer. A
  generator derives a DOOR — a queryable/writable projection — and doors share one law: the
  same tokens, the same public declarations, the same capability refusals, the same
  tombstones. A surface may never invent authority, widen admission, or answer with data
  another surface would lawfully refuse. The contract test is agreement: one ground, one
  registration, every door — the same view, `_hex` for `_hex`.

- **REST / OpenAPI — the proving second.** A principle with one implementation is a comment.
  `buildOpenApi(registered)` derives a real OpenAPI 3.1 document, served at
  `/:mount/openapi.json`, and a dynamic router mounts beside GraphQL:
  `GET /:mount/rest/<schema>/<entity>` answers the resolved view (the same view, the same
  `_hex`), `POST` writes through the same door discipline (authorize, admission, tombstones —
  the two doors must not disagree; that is the review focus, not a feature). The OpenAPI
  document regenerates when registrations evolve, exactly as the GraphQL schema does — the
  spec is a function of the store. An agent that speaks OpenAPI can use a Loam store without
  ever hearing the word GraphQL; that is the point.

- **Generated clients — designed, not yet queued.** `loam types` emits a typed client library
  (TypeScript first; the language is a generator parameter) from the same registrations —
  in-memory against an embedded store, or fronting GraphQL/REST; either way the types are
  derived, never hand-kept. Codegen is its own project and ships as its own step; what this
  section fixes is only that it is a GENERATOR, downstream of the same seam.

- **The horizon — compiled surfaces, capability projections.** Nothing above requires a
  server, or even a runtime that holds a store. A registration could COMPILE: firmware for a
  sensor that carries only the claim grammar, a signing key, and the schema's write-shapes —
  a WRITE-ONLY surface whose "persistence" is emitting signed deltas onto an output channel;
  a monitor built from the READ-ONLY projection, resolving views and nothing else; an
  orchestrator holding the full read/write door. Three artifacts, one registration snapshot,
  compiled together — interoperable BY CONSTRUCTION, because the registration's content
  address is the compatibility contract: if the sensor, the monitor, and the orchestrator
  name the same registration hash, they cannot disagree about what a claim means. This is
  stated as possible, not designed as an instance — the seams are ours to place, and the
  delta grammar is small enough (signed canonical CBOR) that "surface" can mean anything from
  a GraphQL endpoint to a few kilobytes on a microcontroller. When an instance is wanted, it
  is a generator, not a fork.

- **Every published door is versioned, and publishing is append-only (Myk, 2026-07-11).** A
  version's TRUE NAME is the registration delta's content address — two peers naming the same
  registration hash cannot disagree about what that version means. Monotonic `vN` is a
  derived, human-friendly alias: the Nth surviving registration for that schema name, counted
  in ground order. Evolution MINTS a version; it never unseats one — a door once published
  stays answerable, by construction rather than by discipline (the gateway already keeps
  superseded generations materialized; this law makes them citizens, not leftovers). And
  because a registration is a claim, WITHDRAWING a shipped-broken version needs no new
  machinery: the operator strikes the registration delta (lawful negation, the same
  instrument as everywhere) — the version stops being served, the ground remembers that it
  existed and that it was withdrawn, and nothing is erased. Concretely: the REST door is born
  versioned (`/rest/v<N>/…`, and addressable by registration hash; the OpenAPI document names
  the versions it describes); version-pinned access to GraphQL's older generations is
  additive and QUEUED, not silently in Sprint A's scope. Two boundaries the build's review
  fixed (2026-07-11): the PUBLIC projection serves only the LATEST version of each declared
  name — a declaration was made about the door that existed when it was signed, and history
  is not anonymous (the withdrawn-vs-never-existed distinction, 410 vs 404, is likewise the
  full door's alone; an anonymous hash probe learns nothing). And the REST door serves lenses
  REGISTERED AS DATA: a process-lifetime `register()` call files no registration delta, has
  no true name, and therefore no version — its door is GraphQL.

- **Boundaries, in the §13 register:** a surface generator derives doors, never law — it may
  narrow a projection (write-only, read-only, one schema of many) but never widen one; a
  projection that omits a capability is a smaller world, not a bypass; and the anonymous
  surface discipline (§12) applies per-door — a lens is public because the operator declared
  it, whatever language the asking arrives in.

**Provenance.** Landed — [#59](https://github.com/bombadil-labs/loam/pull/59) (versioning: append-only publishing, the registration hash as true name), [#60](https://github.com/bombadil-labs/loam/pull/60) (the seam: `SurfaceHooks` / `SurfaceGenerator`, GraphQL as first witness), [#61](https://github.com/bombadil-labs/loam/pull/61) (the REST/OpenAPI door), [#62](https://github.com/bombadil-labs/loam/pull/62) (contract-flake hardening), closed by [#63](https://github.com/bombadil-labs/loam/pull/63) (the phase19 two-doors proof). Lives in `src/surface/surface.ts`, `src/surface/rest.ts`, and `src/gateway/registration.ts`. Key finding folded back in: the anonymous `@hash` probe was a registration-existence oracle across the whole ground, so the PUBLIC door now serves only the latest version per declared name — history is not anonymous.

## 18. Glossary

- **Delta** — the signed, content-addressed atom (rhizomatic).
- **Hyperschema** — recursive gather definition; `HyperSchema { name, alg, body: Term }`.
- **Hyperview** — arborescent tree of bucketed scoped deltas; `HView`; live or pinned.
- **Schema** — the resolution program; `resolveView(Schema, HView) → View`; `Schema = { props:
  Map<string, Policy>, default }`.
- **Policy** — the per-property reduction rule within a Schema (`pick` / `all` / `merge` /
  `conflicts` / `absentAs`).
- **View** — resolved output: **Snapshot** (static, content-addressed = a commit) or **Subscription**
  (dynamic, live = a branch).
- **Snapshot** — a pinned, content-addressed resolution product (View or Hyperview).
- **DerivedFn / BindingSpec / DerivationHost** — a function / its application (bound to a
  materialization, with purity + budget + emit) / the execution engine (rhizomatic).
- **Runner** — a peer client playing the execution role; passive vs animate.
- **Capability** — a signed delta granting a reference; the unit of all authority.
- **Genesis** — the bootstrap deltas every store is born from (`HYPER_SCHEMA_SCHEMA` + accounts + …).
- **Assert / Retract** — the two universal write primitives (§14): append a contributing delta /
  negate your own contributing deltas (→ absence). `set` / `add` / `remove` / `clear` are these,
  parameterized by a field's policy.
- **Write semantics** — the mutation discipline a policy kind induces; declared per-field in the
  registration, Loam-level, dual to resolution (§14).
- **Browser peer** — a full `Gateway` on a `LocalStorageBackend`, bundled for the page as
  `@bombadil/loam/browser` (§15); pull- and push-capable, never a hub (a browser cannot listen).
- **Continuity / export** — a frozen `/federate` offer (`{ deltas }`, ids + signatures intact);
  `loam pull <url|file>` lands it, and a same-operator import (carrying the seed) makes the local
  store the same store, its law binding on arrival (§15).
- **Surface / materialization** — a derived door over the registrations (§17): GraphQL, REST/
  OpenAPI, a generated client, a compiled capability projection. Doors share one law and must
  agree — one ground, one registration, the same view through every door.

**Provenance.** Foundational / reference — not a build step, no landing PR; it grows with the SPEC as each section lands its vocabulary.

## 19. Tutorial v2 — needs before doctrine

The MVP (§16) proved the machinery: a real store in the page, checks that read the ground,
an arc that cannot rot ahead of the library. Walking it proved something else: the lessons
taught Loam's doctrine in the order the SPEC states it, and a learner builds a cognitive
model in the order their NEEDS arise. v2 keeps §16's foundations — progress is the store,
every check a real read, the finale's hash-for-hash homecoming — and rebuilds the arc and the
instruments on four principles from the walkthrough:

- **Needs before doctrine.** Open where a person opens ("track the films you watch"), and let
  the doctrine beats — data-first, a schema is a lens — arrive as EARNED REVEALS at the
  moment the learner has a need only that truth explains. The reveal lands harder than the
  cold open ever could.
- **Instruments, not exhibits.** The panes are tools the learner drives, not displays the
  lessons decorate. Every lesson ends with something new that the instruments can explore
  off-script, and going off-script is the intended behavior.
- **Explicit write paths.** Every act is labeled with how it reached the ground: the DOOR (a
  GraphQL/REST mutation, compiled to a claim), the PEN (a raw signed claim), the WIRE
  (federated), or DERIVED (a runner's emission). The learner always knows which pen wrote.
- **Total coverage.** By the finale the learner has touched every meaningful feature the
  library ships. The arc below carries the audit; a feature without a lesson is a gap, not
  an elective.

**The instruments.**

- **Ground** — newest first; a delta renderer with kind badges (constitution, registration,
  fact, negation, tombstone, trust, grant, public-declaration, foreign, derived), one-line
  summaries, expand-to-wire-JSON, the operator delta annotated for what it is. Arrivals
  highlight. Everything renders as text, never markup — the hostile-claim lesson is exactly
  why.
- **GraphQL** — a real editor (CodeMirror + cm6-graphql): autocomplete, docs, and lint driven
  by the LIVE schema via introspection against the in-page gateway, re-derived on every
  registration and on the ask-as-the-stranger toggle (the anonymous schema is a different,
  smaller schema — the instrument itself proves §12). Discovery is the interface: after the
  screenings lesson, typing `film {` OFFERS the watch history. Queries pin to the View pane.
- **View** — a query-fed browser, no hardcoded cards. Seeded with the **Schemas meta-view**
  (registrations read as data: name, generations, schema summary, roots), so registering Film
  visibly ADDS FILM TO A VIEW before "schemas are data" is ever said. Select a schema → its
  roots → the live resolved view (a subscription, and the pane says so). Lessons contribute
  saved queries; so does the learner. After §17: the registration's OTHER door (the OpenAPI
  document) is visible beside the GraphQL hints — one truth, two materializations, live.

**The arc — five acts, sixteen lessons.** (Titles are working; the copy is the craft.)

- **Act I — a store of your own.** (1) You are the operator: genesis, seed custody, the
  constitution annotated in the Ground. (2) Track your films: motivate → define → register →
  the GraphQL pane LIGHTS UP with hints and the Schemas view gains Film — and with §17
  shipped, the OpenAPI document materializes beside it: two doors from one registration.
  (3) Write through the door: mutations; one act seen three ways (View updates live, Ground
  grows a badged delta, the copy says plainly the mutation COMPILED to a signed claim).
  (4) Screenings are entities: a second schema, a film⇄screening reference, `expand` — the
  film's view nests its history.
- **Act II — the ground truth.** (5) The secret — it was claims all along: the next screening
  written with the PEN, one multi-pointer claim that also names a guest (`person:alice`, a
  role no schema knows); the old lens shows the screening BUT LEAVES ALICE OUT — a lens
  drops what it doesn't gather; the inspector shatters an id on a one-byte edit. (6) Evolve
  the lens, keep every past: add `guests`, re-register — a NEW query shows Alice; the OLD
  subscription keeps streaming Alice-less, because a subscription is executed against the
  generation that opened it and is a PINNED LENS CHOICE — nothing you were watching breaks;
  you adopt the new shape by asking with it; then the pre-guests schema re-registered as
  `FilmClassic`: two lenses, one ground, both live — nothing was mutated, ever. (7) Taking
  it back, and what silence means: negation → absence; merge sum and absentAs on the book;
  the aggregate that cannot be set (upgrades to §14's refusal when §14 ships).
- **Act III — other people.** (8) A co-author: the roommate's seed minted in-page, their
  write REFUSED, standing granted with one claim, their screening landing under THEIR
  signature, then revoked — the full grant lifecycle. (9) The adversary, and whose word
  wins: the forged title arrives on the wire; pick-latest falls; a trust chain (your word
  first) defends; and a `conflicts` lens SURFACES the dispute instead of resolving it — the
  forgery preserved, visible, impotent. (10) The door itself is policy: a roster declaration,
  and the second forgery bounces at federate-time — admission trust and read-time trust,
  distinguished. (11) The right to be forgotten: manifest → tombstone → purge; the bytes
  leave the origin; the door holds; the degrees of forgetting named, not exercised.
- **Act IV — the wider world.** (12) Alice was just an id: pull the circle; names and
  friendships light up; the circle's own law arrives AND binds nothing. (13) Another tongue:
  a stranger's log in an alien dialect, rendered into your vocabulary by one signed
  translation spec, provenance visible in the view. (14) An animate store: one derived
  function blessed, a Runner attached in the tab, a derived summary landing signed by the
  runner and durable after it detaches — an animate tab is a deploy choice (§6).
- **Act V — the door out.** (15) The stranger at the window: one public declaration; the
  anonymous surface is a SMALLER WORLD through every door — the editor's hints shrink, the
  OpenAPI document shrinks, a never-declared lens is invisible even to introspection.
  (16) The same store, now on your machine: export (the seed rides, said plainly, tutorial
  data only) → `npm i -g @bombadil/loam` → `loam init --seed` + `loam pull` + `loam serve` →
  the page matches `_hex` hash for hash and records the homecoming IN the ground.

**The audit.** genesis/operator ①; registrations-as-data ②; two doors from one registration
②⑮ (§17); mutations ③; subscriptions-as-pinned-lenses ③⑥; expand/refs ④⑫; raw multi-pointer
claims ⑤; content addressing ⑤⑯; evolution + concurrent generations ⑥; negation/absence,
merge, absentAs ⑦; grants + revocation ⑧; chain/byAuthorRank + conflicts ⑨; trust
roster/admission ⑩; erasure ⑪; federation/law-inert ⑫; translation ⑬; Runner/derived ⑭;
public surfaces ⑮; continuity/CLI ⑯. Explicitly out until built: §14 write semantics (named
in ⑦), as-of replay, server-side drivers (named in ⑯'s copy).

**Acceptance bars, normative** (the MVP's review findings, promoted to law): every check is
EARNED (false before its lesson runs), DURABLE (monotone in the ground — a later lesson can
never un-green an earlier one), and SIDE-EFFECT-FREE (safe to re-verify on every boot);
the copy is apprehensible cold; the arc test drives the page's own functions through all
sixteen in order, the revisit, and the finale round trip — including the lesson-6 pin that a
superseded generation's subscription keeps its shape.

**Provenance.** Landed — [#64](https://github.com/bombadil-labs/loam/pull/64) (v2a instruments: Ground/GraphQL/View), [#65](https://github.com/bombadil-labs/loam/pull/65) (reset/unpin), [#66](https://github.com/bombadil-labs/loam/pull/66) (v2b: the sixteen-lesson arc), [#67](https://github.com/bombadil-labs/loam/pull/67) (localStorage namespace-collision hotfix), [#68](https://github.com/bombadil-labs/loam/pull/68) (v2c), [#69](https://github.com/bombadil-labs/loam/pull/69) (lesson-button fix), [#70](https://github.com/bombadil-labs/loam/pull/70) (step-through + in-order gating). Lives in `demos/tutorial/lessons.mjs`, `demos/tutorial/app.mjs`, `demos/tutorial/instruments.mjs`, tested end-to-end by `test/site/arc.test.ts`. Standing design split (PR #70): step progress within a lesson is ephemeral and content-address-idempotent, while the durable gate is always the ground-derived green — the split that keeps in-order gating honest across reloads without polluting the ground with UI state.

## 20. Migration — old deltas in, new deltas out

A store is grow-only and content-addressed, which makes a breaking change to the on-wire format a
genuine problem: a signed delta CANNOT be rewritten in place (the id is its content; the signature
is its author's). When a format change alters the bytes or roles of a delta that older stores
already hold — as rhizomatic 0.3.0's realignment did to schema-definition deltas
(`rhizomatic.schema.*` → `rhizomatic.hyperschema.*`, §2) — those stores open but lose the surface
those deltas backed. So **every breaking on-wire change ships a migration** (standing rule): a step
that reads the old deltas and streams correctly-formed ones out.

**A migration never rewrites; it supersedes.** For each delta a step changes it does two grow-only
things, both signed by the operator running the migration:

1. **Re-sign** the delta into the new form, at its original timestamp — a faithful re-expression,
   not a new fact. (Only the operator's OWN definitions: a seed can re-sign only what it authored,
   and a foreign definition is inert under the new format anyway — its own operator migrates it.)
2. **Negate** the old delta with a negation that also points `supersededBy` at the replacement and
   carries a `reason`. The record reads as a linked chain of supersessions — every retirement
   explained, nothing destroyed.

Because the re-expression is deterministic (same input → same content address) and the output is
deduplicated by id, **re-migrating is a no-op**: the tool is idempotent, and running it against an
already-current store adds nothing.

**Version detection is by SHAPE** — a step `applies` when the old shape it migrates is present —
and steps run in declared order, so a store several versions back is carried forward one step at a
time. This works because a delta's version already lives in its bytes: the vocabulary a structural
delta speaks (`rhizomatic.hyperschema.*` vs the old `rhizomatic.schema.*`) IS its format, so no
per-delta version stamp is needed (one would only pollute the content address with metadata the
bytes already carry). The load-bearing discipline: **every breaking change must give its changed
deltas a shape unambiguously distinct from all prior versions** — then shape-detection cannot
misfire. Almost no delta kinds ever change across a version (a `subject/value` data claim is
byte-identical), so the set a migration must recognize is small and self-labelling. Shape-detection
is the mechanism, not a stopgap: even a per-store version marker could only ever be a fast-path in a
federating store — a lagging peer can deliver an old-shape delta the day after you stamped a version
— so the scan stays the backstop regardless, and the marker isn't worth its maintenance. The chain
composes, so "many versions back" costs only more steps.

The surface: a library `migrate(deltas, { seed }) → { deltas, report }` over the `MIGRATIONS` chain,
and a CLI `loam migrate <offer> [--out <file>]` that re-expresses a frozen offer (a store's export or
a saved `GET /federate` body) in the current format, run against the home whose seed authored the
definitions.

**Provenance.** Landed — the rhizomatic 0.3.0 overhaul PR (the first breaking on-wire change, and so
the first migration). Lives in `src/migrate/migrate.ts` (`migrate`, `MIGRATIONS`, the
`hyperschema-roles` step) and the `loam migrate` command (`src/cli/cli.ts`); tested by
`test/migrate/migrate.test.ts` and `test/cli/migrate.test.ts`. Key decision (Myk, 2026-07-12):
supersede, don't rewrite — re-sign the new form and negate the old with a forward link and a reason,
so a content-addressed, grow-only store can change formats without losing its history or its soul.
