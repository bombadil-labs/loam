# What rhizomatic already provides — the map (don't reinvent slime molds)

**Status:** findings from reading the **type surface** of `@bombadil/rhizomatic@0.1.0`
(`dist/*.d.ts`) on 2026-07-08. Surface is authoritative for shapes; **semantics must be confirmed
against rhizomatic's source/tests/spec** before relying on them. But the shapes are explicit enough
to settle the big question, and the big question has a big answer.

## The headline

**Loam is not "the typed, reactive database layer." Rhizomatic already _is_ that.** The object
model, resolution, the self-hosting schema-schema, and the function substrate — the parts the spec
treated as Loam's novel core — are all **exported by rhizomatic today.** What Loam genuinely adds is
a thinner, clearer band: **the GraphQL interface, durable/pluggable persistence, accounts &
capabilities, the gateway transport, cloud deployment, and the genesis assembly** — a *deployable
server + interface + ops* wrapped around rhizomatic's already-complete typed-reactive-computational
core. This re-draws the Loam/rhizomatic line dramatically in Loam's favor (much thinner) and is the
resolution of the §11 spike.

## Concept map (spec model → rhizomatic → status)

| Spec concept | In rhizomatic? | Export |
| --- | --- | --- |
| Delta / Claims / Pointer / CRDT set | **USE IT** | `types`, `DeltaSet`/`federate`/`fork`/`merge`, `sign` |
| **Hyperschema** (recursive gather definition) | **USE IT** | `HyperSchema {name, alg, body: Term}`, `SchemaRegistry`, `collectRefs` (recursion via `SchemaRefT`) |
| **Hyperview** (arborescent, bucketed, negation-aware, addressable) | **USE IT** | `HView {id, props: Map<string, HVEntry[]>}`, `HVEntry {delta, negated, expanded?: Map<number, HView>}`, `hviewCanonicalHex` |
| **Schema resolve + Policy** (shape + reduction) | **USE IT** | `resolveView(Policy, HView) → View`; `PropPolicy` = pick/all/merge/conflicts/absentAs; `Order` = byTimestamp/byAuthorRank/byPred/lexById; `MergeFn` = max/min/sum/count/and/or/concatSorted |
| **View — static (snapshot)** | **USE IT** | `View` + `viewCanonicalHex` (content-addressed resolved value) |
| **View — dynamic (subscription)** | **USE IT** | reactor `register`/`materializedView`(→`HView`)/`subscribe`(`MaterializationChange`) |
| **Snapshot (pinned Hyperview too)** | **USE IT** | `hviewCanonicalHex` |
| **Self-hosting schema-schema** | **USE IT** | `SCHEMA_SCHEMA: HyperSchema`, `loadSchema(dset, entity) → HyperSchema`, `publishSchemaClaims(schema…) → Claims`, `definitionRoles()` |
| **Selector** (static / dynamic sub-query) | **mostly** | `Term` + roots (to `eval`/`register`); `Pred`/`ValMatch`/`comparePrimitives` |
| **Function: definition** | **USE IT** | `DerivedFn = (view: HView, root) => Pointer[][]` |
| **Function: application** | **USE IT** | `BindingSpec {name, fnId, materialization, pure, budget, emit: append\|supersede\|{keyed}}` |
| **Function: execution + runner** | **USE IT** | `DerivationHost` (install/ingest/trigger/drain/emitSigned), `derivedClaims(spec, author, substantive, inputHex)` (keyed on input hex) |
| **Pure vs effectful; replay; budget; emit-mode** | **USE IT** | `BindingSpec.pure` / `.budget` / `.emit`; `verifyPureDerivation(...) → boolean` |
| **Federation** | **USE IT** | `Peer`, `syncBoth`, `SyncReport`, `offerFor`/`pullFromUrl`/`servePeer` |
| **Terms/policies/preds as data (reflective)** | **USE IT** | `term-io` / `term-json` (parse/serialize terms, policies, preds) |
| Relation signatures / aliasing | present | `relationSignature`, `aliasClosure`, `expandAliased` |
| **GraphQL interface** (query/mutate/subscribe as GQL over the above) | **ABSENT — Loam adds** | — (Chorus's `gql.ts` built a read-only version; Loam generalizes: mutations, hyperschema-sourced) |
| **Persistence tier** (pluggable StoreBackend, sqlite/jsonl/encrypted, registry, async, Turso) | **ABSENT — Loam adds** | rhizomatic is in-memory `DeltaSet` + `pack`/`unpack` only (extract from chorus) |
| **Accounts / capabilities** (as schemas + gateway enforcement + operator root) | **ABSENT — Loam adds** | build as schemas on rhizomatic + enforce in the gateway |
| **Gateway transport** (MCP + HTTP, mounts, token auth, `@union`) | **ABSENT — Loam adds** | extract from chorus `mcp-http.ts` |
| **Deployment / turnkey / passive-vs-animate / runtime variety** | **ABSENT — Loam adds** | cloud, CLI, and function runtimes beyond in-process `DerivedFn` (VMs, HTTP, human) |
| **Genesis assembly** | **partly** | `SCHEMA_SCHEMA` is provided; Loam bundles it + accounts + names + fn-schemas into a shippable genesis |

## What this means for the spec

Substantial revision — the spec over-claimed Loam's core. Concretely:

- **§3 Object model:** don't _define_ Delta / Hyperschema / Hyperview / View / Policy — **import them**
  (`HyperSchema`, `HView`, `resolveView`, `Policy`). Our "Schema (shape + reduction)" is rhizomatic's
  **`HyperSchema` (the Term/gather) + `Policy` (the reduction)** — two objects, same substance.
  Reconcile our vocabulary to theirs, and **disambiguate our "Schema" from rhizomatic's schema** (or
  adopt theirs).
- **§6 Self-hosting:** the four-meta-node analysis was over-built. Rhizomatic ships **one**
  `SCHEMA_SCHEMA` + `loadSchema`/`publishSchemaClaims`. Use those; the metacircular seed is already
  written.
- **§7 Function substrate:** don't build it — it's `DerivationHost` + `DerivedFn` + `BindingSpec` +
  `verifyPureDerivation`, with `pure`/`budget`/`emit` already modeling pure-vs-effectful, termination,
  and idempotent output. Loam's genuine additions here are **runtime variety** (functions beyond an
  in-process TS `DerivedFn` — HTTP, VM, human) and the **peer-client deployment** of the runner.
- **§11 Spike:** largely **answered.** "Can the evaluator + policies express the reductions?" — yes:
  `PropPolicy` (pick=latest, byAuthorRank=trusted-first, all=set-union, conflicts=contested,
  merge fns, absentAs) is the reduction library. The remaining spike is narrow: does anything Loam
  needs exceed `PropPolicy`/`Order`/`MergeFn`? (Probably not.)

## Caveats

- **Types, not implementation.** Confirm against rhizomatic's `.js`, tests, and spec before building:
  does `HView.expanded` do full arbitrary-depth arborescence? does `loadSchema` close the whole
  self-hosting cycle? does `DerivationHost` run effectful bindings or only pure? what exactly triggers
  a binding (which `materialization` change)?
- **Vocabulary.** Adopt rhizomatic's names where they exist (`HyperSchema`, `HView`, `View`, `Policy`,
  `DerivedFn`, `BindingSpec`) rather than paralleling them with ours — parallel names are how you end
  up with two colliding "schema" concepts.

## Recommendation

Fable's first move is to **read rhizomatic's source + tests** (the sibling repo
[bombadil-labs/rhizomatic](https://github.com/bombadil-labs/rhizomatic), or `node_modules` in a
checkout) to confirm the semantics above, then **build Loam as the wrapper** — GraphQL + persistence
+ accounts + gateway + deploy — around rhizomatic's core, and revise the spec to import that core
rather than re-specify it. Assume anything in the "USE IT" rows exists until proven otherwise.
