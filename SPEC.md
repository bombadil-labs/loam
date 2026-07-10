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
- **Self-hosting schema-schema** — `SCHEMA_SCHEMA: HyperSchema`, `loadSchema(dset, entity) →
HyperSchema` (deltas → schema), `publishSchemaClaims(schema, …) → Claims` (schema → deltas),
  `definitionRoles()`. Schemas are data; the metacircular seed is already written.
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
- **Reflective plumbing** — terms, policies, and predicates are serializable (`term-io` / `term-json`)
  → storable as data. Since 0.2.0: **`inView` reflective predicates** (a predicate satisfied
  when the candidate's author/id appears in a view extracted — by field or by ROLE — from a
  DSet-sort sub-term over the same delta-set; stratified depth-1, enforced at parse), and
  **`evalPred`** is exported (single-delta predicate evaluation — translation recognizers).

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

**Registration (decided 2026-07-09, step 10 — cutover from step 7's blob form).** A schema is
DEFINED by schema-schema deltas — rhizomatic's `publishSchemaClaims` shape (`rdb.schema.defines` /
`.name` / `.alg` / `.term`) filed at a schema entity, `schema:<Name>` by default. A REGISTRATION is
a separate delta under `loam.registration` holding only references: a pointer to the schema entity,
the policy as canonical JSON, and the roots. The GraphQL surface is generated: `readRegistrations`
meta-resolves each referenced entity via `loadSchema` over the store's surviving definitions —
so **evolution is append** (republish at the same entity; the running gateway rebinds — the
reactor has no deregister, so live materialization names are generation-qualified internally —
and a reopened store replays the latest shape) and **deprecation is negation** (a negated
definition leaves its registration unbound; the type drops from the surface). The schema's
identity is the **entity**, not the name. In a governed store only operator-authored definitions
and registrations bind — a federated foreign definition merges as a delta but reshapes nothing
(the same operator-rooting that keeps foreign grants inert). Policy carries no schema-schema and
needs none: it is the reader's lens, not the entity's shape, and travels as canonical JSON.
The register surface is `POST /:mount/register` (operator token), the `loam_register` MCP tool,
and `loam register <file>` — an HTTP endpoint rather than a GraphQL mutation because an empty
store has no GraphQL surface to mutate through; the endpoint IS the schema-schema mutation
mechanism, and GraphQL stays strictly derived-from-what-is-registered.

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
  `_hviewHex` while their `_hex` diverges exactly when their policies adjudicate differently.
- **Foreign dialects are transformed, not rejected**: deltas expressing the same ideas in other
  shapes merge as always; a runner binding reads them and emits canonical-shape deltas citing
  their sources (the §9 provenance discipline). Standard shape by guarantee for your own
  writers; translation for everyone else's.

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

## 11. Erasure — degrees of forgetting (designed 2026-07-10; LANDED: PRs #34 + #36)

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
- **The request carries its replacement.** An erasure request may embed the pre-signed
  replacement delta; every honoring store appends the IDENTICAL delta and union dedups the
  network onto one anonymous copy. Reassertions inherit the source timestamp (idempotence by
  content address, the translation trick).
- **Honest boundary.** This is rigorous severance/pseudonymization; true anonymity is a
  property of the content itself (timestamps correlate, style fingerprints). Rung 4 is the
  tool for content-side scrubbing; no substrate can do it for you.

## 12. The open door — public reads & the browser client (designed 2026-07-10; queued)

The aggregator dream needs a store a stranger's browser can simply read.

- **Anonymous read as data.** An operator-signed claim (context `loam.public`) names which
  registered schemas a mount serves WITHOUT a token — query + subscribe only; every write path
  stays gated. Consistent with trust-is-data: the open door is a delta, revocable by one
  negation, live on the next request. Serve adds CORS for public mounts.
- **The browser client.** A subpath export (`@bombadil/loam/client`), zero node-only deps:
  keygen in the page, claims signed locally, writes through `POST /append` (non-custodial —
  the token authenticates transport; the delta's own verified author is the authority, which
  is why this endpoint already exists), GraphQL query + SSE subscribe wrappers. **Spike first:**
  confirm rhizomatic's signing/hashing runs in a browser (isomorphic crypto); if not, that is
  a rhizomatic issue + conversation with Myk, not a Loam workaround.
- **The notary pattern (optional, cheap).** An operator claim carrying the store's frontier
  hash may be anchored to any external notary (a chain, a newspaper, RFC 3161). The chain
  becomes a timestamp service for the vault; the world stays in Loam.

## 13. Boundaries & posture — what Loam refuses to be (recorded 2026-07-10)

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

## 14. Glossary

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
