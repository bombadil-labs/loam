## 2026-07-15 — §24 quarantine, slice 1: a place where untrusted law may bind

The design landed (#108, signed off with Myk in chat, incl. the one-way-glass decisions worked out live);
this builds its non-negotiable foundation. A QUARANTINE POOL (`src/gateway/quarantine-pool.ts` +
`Gateway.openQuarantine`) is a second gateway over its OWN backend, seeded ONE-WAY from a primary by
federation. The pool shares the primary's operator seed — the ONE sanctioned shared-seed case (§8's
distinct-seed rule guards mutually-distrustful external peers; the quarantine is the operator's OWN staging
store, one trust domain with the primary), and it is precisely what makes the operator's erasure
authoritative there.

The whole build rode existing seams, which is why it was small (~one module + ~60 lines of gateway) rather
than a new subsystem: in-process federation is already `gateway.federate(primary.offeredDeltas())` (no HTTP,
no new transport); the federation door ALREADY refuses re-entry of a tombstoned id (§24.8 assertion (c) was
free); and the pool binds the seeded operator-schemas via the existing `replayRegistrations`/`preloadResolvers`
so it resolves a living lens, not raw deltas. The genuinely new machinery is exactly two things: a
quarantine-pool registry on the gateway, and the erasure FAN-OUT — `Gateway.erase` now iterates attached
pools and calls `eraseReplica`, which lands the operator's tombstone and purges the byte from the pool too.
So §11 reaches through the one-way glass: erase in the primary, and the forgotten byte is gone from every
pool, byte-for-byte (tested against the pool's own backend, not just its reactor). A quarantine that could
keep a purged byte would be an erasure-evasion channel inside the operator's own walls, and this forbids it.

The prosecute pass (capability-security, erasure-evasion the headline) caught a real defect in my own first
cut: `eraseReplica` purged `id` unconditionally, so a caller handing it a FORGED or foreign tombstone could
drive a purge even though `federate`'s `eraseDefect` gate rejected the tombstone — an unauthorized removal
path. The fix gates the purge on the operator's tombstone actually landing (`readTombstones(...).has(id)`);
a rejected tombstone now removes nothing. A rail proves it (a non-operator-signed tombstone leaves the byte
untouched). Learning: erasure is the operator's alone at the ORDER door (append/federate validate the
tombstone) — and any code path that PURGES must re-derive that authority from the recorded tombstone, never
trust its caller to have checked. The two-step (federate then purge) split the check from the act, and the
act had to re-check.

One-way is structural, not a mark: `openQuarantine` only wires the inbound `federate`; there is no outbound
call, so a pool write cannot reach the primary by construction. Drop is consequence-free: `drop` detaches
the pool from the fan-out set and closes its store; the primary is never touched. Both tested.

`npm run check` green — 608 tests (test/gateway/quarantine.test.ts 6: separate-store + drop-is-safe, one-way
glass, live-follow-on-pulse, the four-part §24.8 erasure at the byte level, purge-reaches-every-attached-pool,
and the forged-tombstone-cannot-purge guard). Village act demos/village/phase-quarantine.mjs (A PLACE WHERE
UNTRUSTED LAW MAY BIND, 4/4). Additive (no store opens a quarantine unless asked) → no §20 migration.
Deferred to their own slices (§24.9): promotion, the resource envelope, the sequestered renderer frame, the
full ocap, a read-side capability slice. Residual noted in spec/24: the fan-out is best-effort-and-loud (a
failing pool makes `erase` reject rather than silently evade). New capability/federation/erasure surface →
Myk's merge (P6).
