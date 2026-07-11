# Current work

_The live checklist. Empty means nothing is queued — the resume protocol (see `CLAUDE.md`) is
then to ask Myk what to build next, and open it here at cycle stage 1._

**Nothing in flight (2026-07-10).** The v1 build (steps 0–9) and the Reader's Republic demo arc
(Units 1–3c + demo item 7, "grow an app live") are complete and merged — the JOURNAL is their
record, and `_testing/README.md`'s ledger maps each demo beat to its machinery. The demo script
and pitch spine live in that ledger and in SPEC §13.

**Designed, not yet built (candidate sprints):**

- **Write semantics — policy-informed mutation (SPEC §14).** Make writing the dual of reading:
  each `PropPolicy` kind declares how it is written and cleared (assert / retract), clearing =
  retraction → absence (no `null` value, no substrate change), `merge` rejects "set the
  aggregate," derived is read-only, default is immutable. Fixes the silent null-drop bug. Pure
  Loam except the deferred first-class-null-value question (a rhizomatic `Primitive` change).
- **As-of replay** — a timestamp mask on the gather → scrub the village's history like a replay.
  Substrate-ready (rhizomatic's `match { field: "timestamp" }`); query-only; demo-visible.
- **Hosted `StoreBackend` (libSQL/Turso)** — a URL she can visit after the call, not localhost.
- **Renderer-generation for grown stores** — grow a *view* for a novel schema, not just data.

Next sprint: Myk's pick from the above (or something new).
