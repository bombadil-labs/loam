# §39 — A connection binds to a container

**Ticket.** T138. **Status.** Working spec, design-stage. Myk settled the model in chat on
2026-07-28 and pre-blessed this spec on the same day, on two conditions: it conforms to his
Alice/Bob/Charlie walkthrough, and it surfaces no surprises. Section 39.6 answers both conditions
explicitly. The landing PR is his merge.

**One sentence.** An MCP connection binds to exactly one container; reads gather that container,
writes land in it as the owner, and each connection signs with its own key that is provably the
owner's.

## 39.1 The model

These are invariants, not options. Every criterion in 39.5 pins one of them.

1. **A connection binds to exactly one container.** The binding is the connection's whole world.
   Reads gather that container — everything in it, wherever it originated. Writes land in it.
2. **The binding is an upper bound, not a routing rule.** A connection bound wide addresses
   sub-containers through query semantics. A connection bound narrow cannot reach outside. Same
   mechanism; the owner chooses the width.
3. **The owner acts; the connection carries.** Every read and write through a connection is made by
   the container's owner, in their capacity as owner. The operator never appears on this path. It is
   an administrative capacity of the store, orthogonal to ownership.
4. **The degenerate case is not special.** A store with no user-made containers is a root container
   with a heap in it. One connection bound to it works with no extra machinery.
5. **An operator-level connection is not precluded.** The store's top level is just a container, so a
   connection could bind to it. This spec adds no guard. A guard, if wanted, is a later ticket.

## 39.2 Negation semantics — membership decides reach

Myk's ruling, near-verbatim: a negation is an ordinary delta. If D1 and D2 are both in the gathered
deltas for a HyperView, the Schema resolver knows D2 negates D1 and may apply that however its
Policy says — hide D1, mark it retracted, whatever. **It does not matter who wrote the negation. If
it is in the gathered set, it is in play.**

Consequences, each carried into a criterion:

- **Trust moves from read time to admission time.** Writing into a container, or accepting into it
  via federation, is the deliberate act. Once in, in play.
- **Per-container divergence falls out of membership alone.** D1 sits in `alice.folklore` and
  `alice.friends`. D2 (a negation of D1) is admitted to folklore only. The folklore read resolves
  without D1. The friends read still shows it.
- **The aggregator story needs no new machinery.** A public aggregator publishes v2 of an app with a
  negation of the v1 claim. You federate the update in. The negation binds because you admitted it,
  not because of who signed it.
- **Where H1 goes:** the bug class is a gather that includes D1 and drops an admitted D2. That is
  the strand this spec's rails must make impossible to miss, at both levels.

**Verified substrate fact (2026-07-28), not an assumption:** `containerScope`
(`src/gateway/container.ts`, `membersOf`) already reads this way. A shared container's members are
its membership Term's selection over the primary ground. A separate container's members are its own
pool's snapshot, wholesale. The H9 refusals (unattached pool, unresolvable membership address, no
membership) are already in place.

## 39.3 The four design decisions

### (a) Nesting: membership is explicit; nesting is addressing

A parent read gathers only what its own membership Term selects. A child container's members are not
auto-merged into the parent's gather. Children are ADDRESSABLE — `containerScope` already takes
explicit container names — so a wide-bound connection reaches them by naming them, which is exactly
Bob's story. Alice's divergence story REQUIRES this: if folklore's members auto-merged upward, her
folklore negation would bind in every wider read and "negated in one, preserved in another" would be
impossible. A container that wants a child's members can say so in its own Term; expressible, never
automatic.

### (b) The key: a per-connection actor seed, granted to the container

Myk chose per-connection keys, in his words: *"It's Alice (via MCP connection scoped to the folklore
container with id xyz)."* This spec rides the arc's existing mechanism rather than inventing one:
phase 15 already states "a grant mints a NEW actor seed per client, never the operator's." A
connection key IS that actor seed. What this spec adds is the grant's TARGET: today a grant targets
the store entity (`STORE_ENTITY` at `loam.grants`); a connection grant targets the CONTAINER entity
instead. The two shapes are unambiguously distinct (the §20 corollary is satisfied by the target
alone), and `loam.grants` is already recognised at the append door.

So the binding delta says three things at once: this key exists (subject), it is this container's
(target), and the owner authorised it (author). Forensics reads the key → the connection; the door
reads the target → the bound container; authority is the owner's signature.

### (c) Revocation: strike the grant

Revoking a connection strikes its grant. The door then refuses new writes signed by that key. Past
deltas keep their author — history does not rewrite, and the forensic value of (b) survives
revocation. Other connections are untouched: one-connection blast radius. Two-sided by construction,
and railed that way.

### (d) The write path: membership by authorship, self-maintaining

The question was where the door refuses an out-of-container write, given that a shared container's
membership is a Term that cannot be pre-tested against arbitrary content. The recommendation
dissolves the question: **a shared container's membership Term includes an `inView` clause over the
container's own grants — "deltas authored by any key granted to this container."** Then:

- A connection write is a member BY AUTHORSHIP, mechanically, the moment it lands. No filing step,
  no second delta, no Term edit per write.
- Granting a new connection extends membership automatically; revoking one stops future membership
  automatically. The Term never changes — the grants it reads do.
- This is the same one-level `inView`-over-grants shape `lawfulStrikersJson` already uses, so
  stratification bounds it identically and no new predicate machinery is owed.
- A separate-posture container needs none of this: writes physically enter its pool through the
  connection's door, and the pool IS the membership.

The door-level check remains, and it is one comparison: a connection-signed write must name its
bound container, and the door refuses a mismatch between the signing key's grant target and the
container being written. Verified before drafting: only `trust` and `posture` are immutable on a
container declaration, so containers whose Terms predate this pattern can re-declare membership.

## 39.4 What this spec does NOT do

- It does not touch `lawfulStrikersJson` or any root/governed-read mechanism. The first draft's
  finding about `adminsOnly=false` ignoring the verb stays true and stays out of scope: connections
  never enter that path.
- It does not build operator promotion of container claims. T33's promote-LAW exists to be reused
  when something needs it.
- It does not guard the operator-level binding (39.1 point 5).
- It does not design ejection (Charlie leaving with his container). That is T119's successor,
  deferred.

## 39.5 Acceptance criteria

Every criterion names its verification. The rail file is `test/server/connection-container.test.ts`
unless stated; it collides with no frozen rail and no arc phase's file (checked 2026-07-28 against
main's 95 frozen rails and the arc's 18). Rails are declared at P3, when these tests exist and are
red.

1. A connection bound to `alice.folklore` reads a delta that ORIGINATED elsewhere and was admitted
   to folklore. Provenance does not gate visibility; membership does. Verified in
   `test/server/connection-container.test.ts`.
2. A connection bound to `alice.folklore` cannot read a delta that sits only in `alice.friends`. The
   refusal is a scope answer, not an error leak: the response neither confirms nor denies the
   delta's existence. Verified in `test/server/connection-container.test.ts`.
3. A write through the folklore connection lands in folklore and resolves in the folklore read
   immediately. Assert at both levels: the delta is in `containerScope("alice.folklore")` AND a View
   through a Schema shows it. Verified in `test/server/connection-container.test.ts`.
4. A write through the folklore connection does NOT appear in the friends read, and a named live
   bystander in friends still resolves. Two-sided. Verified in
   `test/server/connection-container.test.ts`.
5. The write's author is the CONNECTION's key, not the owner's user key and not the store's seed.
   Assert the author equals the connection's public key exactly. Verified in
   `test/server/connection-container.test.ts`.
6. Two connections owned by the same user are distinguishable at the delta level: one write through
   each, two different authors, each equal to its own connection's key. Assert they DIFFER — not
   merely that both are non-empty. Verified in `test/server/connection-container.test.ts`.
7. The connection grant targets the CONTAINER entity at `loam.grants`, and the store-targeting grant
   shape still validates unchanged beside it. Both shapes in one store, both recognised, neither
   confused for the other. Verified in `test/server/connection-container.test.ts`.
8. NEGATION BY MEMBERSHIP, the divergence rail: D1 admitted to folklore and friends; D2 negating D1
   admitted to folklore only. The folklore View resolves without D1; the friends View still shows
   D1; a bystander claim in folklore survives. Assert at both levels in both containers — D2's
   membership at the delta level, D1's absence/presence at the View level. Verified in
   `test/server/connection-container.test.ts`.
9. THE STRAND RAIL, H1 relocated: a delta admitted to a shared container has its negation admitted
   the same way; the gather includes both; the View resolves without the negated claim. A gather
   that returns D1 without its admitted D2 is the failure this rail exists to catch. Verified in
   `test/server/connection-container.test.ts`.
10. The negation's AUTHOR is irrelevant at read time: D2 authored by a key that is neither the
    owner's nor any connection's binds in the folklore read once admitted, exactly as an
    owner-authored negation does. Verified in `test/server/connection-container.test.ts`.
11. A wide-bound connection (Bob's, at his user root) addresses a named sub-container through query
    semantics and reads its members. The same query through Alice's narrow-bound connection refuses.
    Verified in `test/server/connection-container.test.ts`.
12. A store with no user-made containers (Charlie's) serves a connection bound to its root container
    with no additional setup: one bind, reads and writes work. Verified in
    `test/server/connection-container.test.ts`.
13. REVOCATION, two-sided: after the folklore grant is struck, a write signed by that connection's
    key refuses; a SECOND connection's write still lands; every delta the revoked connection wrote
    keeps its author and stays readable. Verified in `test/server/connection-container.test.ts`.
14. The door refuses a connection-signed write whose named container does not match the signing
    key's grant target. The refusal names the mismatch class without echoing the container id of the
    grant. Verified in `test/server/connection-container.test.ts`.
15. The connection's seed never enters the ground. Scan the whole store after a full
    grant-write-revoke cycle; plant a leak first and prove the scan sees it (the H7 discipline: an
    instrument must fail before it is trusted). Verified in
    `test/server/connection-container.test.ts`.
16. No existing delta changes shape and no §20 migration is owed: a store created before this work
    reads identically after it. The new grant shape is additive and distinguishable by its target.
    Verified in `test/server/connection-container.test.ts`.
17. The membership Term's `inView`-over-grants clause is one level deep and stratification-bounded,
    same as `lawfulStrikersJson`; a grant filed by a NON-owner key does not extend membership.
    Verified in `test/server/connection-container.test.ts`.

## 39.6 The two pre-blessing conditions, answered

**Conformance to Alice/Bob/Charlie:** the walkthrough IS the fixture plan. Criteria 1–8 are Alice
(narrow bindings, divergent containers, per-connection attribution). Criterion 11 is Bob (wide
binding, sub-container addressing). Criterion 12 is Charlie (root heap, no containers). Criteria
13–15 are the lifecycle all three share.

**Surprises: none.** Two findings from verification, both conveniences rather than surprises:
(1) the per-connection key converges with phase 15's existing "actor seed per client" criterion — the
arc already mints the right object, this spec binds it to a container; (2) `containerScope` already
implements membership-decides-reach, so the read half of the model is landed substrate, not new
work. One item is flagged for the builder rather than decided here: containers declared before this
pattern may carry membership Terms without the grants clause; membership is re-declarable (verified:
only trust and posture are immutable), and criterion 16 pins that nothing existing breaks either
way.
