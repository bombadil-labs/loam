## 2026-07-15 — §24.3 promote-outputs: the first container operation

The quarantine can run and discard; promotion is the door OUT — and §27 reframed it as the first CONTAINER
operation (merge-load with kept provenance). `Gateway.promote(source, deltaId)` adopts a delta a quarantine
produced by RE-SIGNING its content as the operator's own claim into the primary, with a separate
`loam.adoption` record (`src/gateway/adopt.ts`) carrying the trail (adopted-from / source-delta / produced-by
/ adopted-by / at). Because the value crosses by re-assertion — authored fresh, not federated — the pool can
be dropped wholesale and the adopted value survives in the operator's voice, its origin kept forever. That
kept-forever provenance is exactly what makes fork and pull-request native (§27): a fork is your deltas on
top of theirs; a PR is offering them back; and the maintainer, on adopting, keeps a cryptographic trail to
who made it and where.

The rails caught a real modeling bug in the first cut, and the fix is the section's own idiom. I first put
the provenance pointers ON the re-signed content delta (as the §24.3 draft literally said). But the content
delta files under the entity it's about (FERN/message), so that field's gather picked up ALL the delta's
non-filing pointers — the value AND the provenance — and `candidateValue` returned a compound object instead
of the string. The fix: land TWO deltas, the clean re-signed content and a SEPARATE adoption record citing
it — exactly §11's tombstone-is-separate-from-content discipline, now applied to adoption. Learning: any
delta that carries both "the thing" and "metadata about the thing" will pollute the thing's own resolution
if they share a filing; provenance belongs on a companion record that points back, never smeared onto the
content. (spec/24 §24.3's claim shape was corrected to say this.)

Reference closure is enforced (§27): a promotion whose delta-ref pointer would dangle in the primary is
refused — adopt the closure or refuse, never half a thing. `Gateway.adoptions()` reads the trail live: the
read side of promotion and the seed of §27's "review what's in a container" interface.

`npm run check` green — 612 tests (test/gateway/promotion.test.ts 4: adopt a stranger's pool fact + resolve
it under the operator; the readable provenance trail; survives dropping the pool; reference-closure refuses a
dangling promotion). Additive → no §20 migration. Scope: promote-OUTPUTS only; promote-LAW (§24.4) and
endorse-import are their own follow-on tickets, as is the fork/PR village demo. New capability/provenance
surface → Myk's merge (P6).
