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
