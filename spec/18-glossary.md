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
- **Lens** — the load-bearing word, and deliberately **prose, not a type**: a lens is the whole
  reading-side assembly — one choice of program at each rung, plus the binding's stance — that turns
  shared ground into a View. The four exported types (`HyperSchema`, `HView`, `Schema`, `View`) form a
  square with two altitudes; a lens is a *path through it*, not any one corner.

  ```
    living:   HyperSchema ──× ground──▶ HyperView ──× Schema──▶ View
                  │ reifies                            │ reifies
    frozen:   VersionedHyperSchema  (pencil)        VersionedSchema  (name@hash)
  ```

  Read the top row left to right: a **HyperSchema** (the gather program — which deltas, bucketed how)
  applied to the **ground** yields a **HyperView** (the gathered evidence, every voice present); a
  **Schema** (the resolution program — `{props: Map<field, Policy>, default}`, which claims win and
  what fields mean) applied to that HyperView yields the **View** (the resolved answer). Each
  generating arrow takes a *second input*: nothing generates from a definition alone
  (`HyperSchema × ground → HyperView`; `Schema × HyperView → View`). The bottom row is the frozen
  altitude: a definition reifies to a content-addressed snapshot. **VersionedSchema** (`name@hash`) is
  built (§17); **VersionedHyperSchema** is the named-deferred rung — drawn in pencil, built when a pin
  needs the gather itself frozen (§21).

  A lens is thus **five rungs**: (1) the gather body, (2) its pin, (3) the resolution lineage, (4) its
  pin, (5) the binding's stance (roots, writable; a resolver folds into rung 4, §22.4). The **living**
  lens evolves and is what the latest door serves; a **pinned** lens reads through frozen rungs forever
  (§17, §23). §26's `asOf` pins the *ground* — orthogonal to both. Forking at *any* rung yields a
  different lens: §21.7's coexistence is the rung-3 case (two Schemas over one gather), and a lens's
  identity is a tuple of content addresses, one per rung — the system already mints every one.

  It stays prose because naming it as a type would tempt a fork of the vocabulary into near-synonyms;
  when you mean the Schema, write `Schema` (the standing rule in `CLAUDE.md` cites exactly this). See
  §4 (resolution), §17 (versioning), §21 (schema identity), §22 (resolvers), §26 (as-of).
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
