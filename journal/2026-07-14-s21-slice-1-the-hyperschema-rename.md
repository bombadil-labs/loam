## 2026-07-14 — §21 slice 1: the hyperschema rename + the immutable-default flip land

First of three §21 slices (#92), and it also realizes T1 (§14 wave B). Two coupled breaking changes
rode ONE §20 migration: the hyperschema-definition entity moved off the shared `schema:` prefix to
`hyperschema:<Name>` (shape-distinguishable, aligning Loam's ids with 0.5.0's `loadHyperSchema` and
freeing `schema:` for slice 2's Schema entities), and `assertWritable` flipped to deny-by-default —
silence in a registration now means "you may not," not "everything." The migration re-signs each
definition/registration delta into the new form (renamed ids + an explicit `writable` list = all the
schema's fields, read from the delta's own inline Schema so old registrations stay fully writable) and
negates the old with `supersededBy` + a reason — supersede, never rewrite; signing-oracle-guarded;
idempotent; composes after the 0.3 step. The flip's coherence was carried to the doors too (gql/rest
no longer advertise a per-prop write they'd refuse). 531 tests green; village phases 17/20 and the
tutorial packet adapted to keep green.

Note for the demonstration ledger: the village and tutorial were UPDATED (writable lists, the rename)
but not yet EXTENDED — there is no new act showing deny-by-default or the `hyperschema:` identity in
action. Deliberate: slice 1 is plumbing; the demonstrable §21 story (coexisting lenses, name@hash
versioning) lands with slices 2–3, and the village grows to tell that whole story at once then.

Verification before merge (Myk merged): the migration read line-by-line for re-sign/negate/oracle-
guard/writable-preservation; two scares checked and cleared — registrations are operator-authored (so
the operator-only migration covers them), and circle.json is drift-gated (gen-packets --check, green).
