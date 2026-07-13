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
