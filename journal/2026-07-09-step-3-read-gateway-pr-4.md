## 2026-07-09 — Step 3: Read gateway (PR #4)

The first genuinely novel code: a `Gateway` fronting one `StoreBackend` (boot-replay,
raw-stream write-through, `loadSchema` meta-resolved via `SCHEMA_SCHEMA`, per-root live
materializations) serving GraphQL **derived from (HyperSchema, Policy)** — the policy's props
name the fields, each `PropPolicy` kind names its GraphQL shape, and every view carries
`_entity` / `_hex` (the content-addressed snapshot) / `_view` (the whole resolved view). Reads
go through `resolveView` over the live materialization, falling back to batch eval for
unwatched roots. 61/61 green.

Learnings worth keeping:

- **Chorus reflected; Loam derives.** Chorus's `gql.ts` had to reflect its schema out of the
  data because its vocabulary was open. Loam's policy IS the field contract — reflection is
  unnecessary, and the GraphQL surface is a pure function of what's registered, not of what
  happens to be stored. (`_view` covers the dynamic remainder.)
- **Failure design is most of the gateway.** The single review agent confirmed the happy path
  and found seven failure-path defects: a permanently-rejected write queue that silently
  dropped later writes and wedged `close()`; `register()` latching a refused schema and
  corrupting every later call; `loadSchema` persisting deltas before proving they define a
  schema (append-only stores forgive nothing); `absentAs` typed by its inner policy when its
  constant is a bare primitive (graphql-js throws "Expected Iterable" exactly when the default
  should speak); silent GraphQL name shadowing. The pattern for all five fixes: **validate
  everything that can refuse before any state changes, latch the first persistence failure,
  refuse new work while degraded, and always release resources on close.**
- **Collision checks must live outside lazy thunks** — a check inside a GraphQL `fields`
  thunk fires at first use, not at build; `register()` must refuse at registration time.
