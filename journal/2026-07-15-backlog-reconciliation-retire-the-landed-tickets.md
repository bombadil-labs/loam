## 2026-07-15 — backlog reconciliation: retire the landed tickets, name the remainder

Housekeeping the landing PRs skipped. `.adlc/tickets.json` still carried T2/T3/T4 as open although their v1
had already landed in SPEC.md — a stale queue that polluted `merge-forecast` (all three vetoed against
everything on shared-scope globs). Reconciled to what IS:
- **T3 (§22 rung a)** — retired. Landed #97 (custom resolvers, rung (a)); its whole v1 scope is in
  spec/22-resolvers.md. Done.
- **T4 (§23)** — retired. Design landed #98, the read-only v1 slice #99; and its named "later slices" were
  decomposed into T9–T12, all four now built and PR-opened this session. Nothing of T4 remains unrealized.
- **T2 (§21)** — kept, but re-scoped honestly: slice 2prime (Schema-as-entity + per-version VersionedSchema)
  LANDED #96, so T2 now tracks ONLY the DEFERRED, design-stage remainder — slice 2b coexistence (two lenses
  over one hyperschema; the serving-surface model is unspecified, a Myk design pass) and the future
  VersionedHyperSchema. Its body now says so up front, so no one mistakes it for build-ready.

The queue is now honest: **T2** (§21 coexistence, design-stage, deferred) and **T5** (§24 quarantine,
design-stage) — both design-stage, both Myk's call. The four build tickets (T9–T12) are removed by their own
landing PRs in the stack.
