## 2026-07-12 — The migration policy: old deltas in, new deltas out (SPEC §20)

The 0.3.0 overhaul was the first BREAKING on-wire change — schema-definition deltas moved roles
(`rhizomatic.schema.*` → `rhizomatic.hyperschema.*`), so a 0.2-era store opens under 0.3 but its
schemas don't bind and the surface vanishes. Myk's standing rule, established here: every breaking
on-wire change ships a migration in the same PR. And it must respect what Loam is — a signed,
content-addressed, grow-only store can't have its deltas rewritten in place.

So the migration **supersedes** rather than rewrites. For each delta a step changes, both signed by
the operator running it: (1) re-sign the delta into the new form at its original timestamp (a
faithful re-expression); (2) negate the old delta with a negation that also points `supersededBy` at
the replacement and carries a `reason`. The store's history becomes a linked chain of supersessions —
every retirement explained, nothing destroyed. Version detection is by shape (a step `applies` when
its old shape is present), steps run in declared order, and the output dedups by content address, so
re-migrating is a no-op and a store several versions back is carried forward one step at a time.

Shipped as `migrate(deltas, {seed}) → {deltas, report}` over a `MIGRATIONS` chain (`src/migrate/`),
plus a `loam migrate <offer> [--out]` command, plus the first step (`hyperschema-roles`). Tests
fabricate a 0.2-era store (a native genesis with its definition downgraded to the old roles), prove
it has no surface under 0.3, migrate it, and prove the surface returns with the supersession on
record; idempotency and the CLI round trip are pinned too. 450 tests green.

Learnings: (1) rhizomatic keys negation strictly on `role === "negates"`, so a second delta-targeting
pointer under a different role (`supersededBy`) links the replacement WITHOUT negating it — exactly
what a supersession record needs. (2) Determinism buys idempotency for free: re-express at the
original timestamp and derive the negation's timestamp from the old delta, and re-running migrate
produces byte-identical deltas that dedup away. (3) Scope re-signing to the operator's OWN deltas — a
seed can only sign what it authored, and foreign definitions are inert under the new format anyway,
so their own operators migrate their own stores; sovereignty holds through a format change.
