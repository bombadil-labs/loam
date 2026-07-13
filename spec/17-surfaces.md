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
