# §39 — A connection binds to a container

**Ticket.** T138. **Status.** Working spec, design-stage. Myk settled the model on 2026-07-28 and
chose the write path (39.3d, the inbox) on 2026-08-01. Section 39.6 records the one place the spec
changed after its first blessing. The landing PR is his merge.

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
connection key IS that actor seed. What this spec adds is the grant's TARGET and its LOCATION: today
a grant targets the store entity (`STORE_ENTITY` at `loam.grants`); a connection grant targets the
INBOX entity, and it is the inbox pool's genesis delta (39.3d). The two shapes are unambiguously
distinct (the §20 corollary is satisfied by the target alone), and `loam.grants` is already
recognised at the append door.

So the genesis delta says three things at once: this key exists (subject), it may write this inbox
(target), and the owner authorised it (author). Forensics reads the key → the connection AND the
inbox that holds the delta → the connection; the door reads the genesis grant → may this key write;
authority is the owner's signature.

### (c) Revocation: strike the grant

Revoking a connection strikes its grant. The door then refuses new writes signed by that key. Past
deltas keep their author — history does not rewrite, and the forensic value of (b) survives
revocation. Other connections are untouched: one-connection blast radius. Two-sided by construction,
and railed that way.

### (d) The write path: a per-connection inbox pool

**Settled by Myk 2026-08-01, superseding the membership-by-authorship recommendation this section
first carried.** The two answers agreed on everything but this section; the inbox was chosen because
it makes the two operations most dangerous to get wrong — revocation and erasure — structural
rather than computed.

A membership Term selects over the primary ground (`gw.select(term)`); a separate pool is not in
that ground, so a Term cannot reach it and "file a write into a Term-defined container" has no
mechanism. The inbox is that mechanism.

A container SPAWNS AN INBOX ON DEMAND — a fresh pool, one per connection. A connection's writes land
in its inbox. The inbox is a MEMBER of the container: reading the container gathers it, so the
connection reads back what it wrote and anyone reading the container sees it too.

The inbox is SELF-AUTHORIZING. Its GENESIS DELTA — the first delta in the pool — is the grant that
names the connection's key and permits it to write there. The door decides "may this key write into
this inbox?" by reading the inbox's own first delta, not root and not the parent. Authority and
writes live in one pool, and three properties fall out of that single fact:

- **Write enforcement is structural.** A connection write goes to its inbox and nowhere else.
  Nothing tests the write against a Term; "outside the bound container" cannot be expressed.
- **Revocation is a negation of the genesis grant.** Strike it and the door refuses further writes;
  the inbox and its past deltas remain, keeping their author. No membership recomputation, and none
  of the tension a current-grants membership read would have with keeping past writes readable.
- **A per-connection drop is a total forget.** Dropping the inbox erases the grant AND every delta
  the connection wrote, with nothing promoted out to leave a trace. Both a leaked credential's blast
  radius and an erasure's are exactly one inbox.

A separate-posture container needs none of this: writes physically enter its pool through the
connection's door, and the pool IS the membership — so a fully isolated connection binds to a fresh
empty separate container, which is at once its read scope and its write destination. The inbox
exists only for the shared/wide case, where the bound container has no pool of its own.

The costs, named rather than hidden: a pool per live connection; the parent container's gather now
composes its inbox pools alongside its Term selection (a change in Loam's `containerScopeImpl`, not
a Term, and not frozen rhizomatic); and erasing the parent must reach its inboxes — a WIDENING of
what gets purged, which is Myk's merge, its direction settled (2026-08-01) and its implementation PR
still owing the one-line statement of what can now be deleted.

**THREE OF THOSE COSTS ARE OPEN DECISIONS, NOT MECHANISMS — see §39.7.** An independent premortem
(2026-08-01) showed the inbox's three hardest seams are not "small Loam-side changes" but decisions
on the trust root and the erasure path, the two surfaces the standing rules guard most: (1) the
read-time negation closure runs PER GROUND, so a strike written into an inbox cannot suppress its
target in the primary ground — the exact "in the gathered set = in play" invariant, broken across
the new boundary; (2) the append door hardcodes `STORE_ENTITY`, so authorizing an inbox-scoped write
without also granting the key store-wide is a new door path that must bind write DESTINATION to
grant target — new trust-root code; (3) a per-connection pool that disconnects becomes an unattached
separate container, which faults `unreachableStoreReport` and deadlocks EVERY erasure on the store,
and throws in `membersOf` and crashes EVERY read of the container — so the disconnect lifecycle
(drop vs detach) is load-bearing and unspecified. §39.7 records all eight premortem findings and
their disposition; these three are held for Myk.

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
7. Binding spawns a per-connection INBOX pool whose GENESIS DELTA is the connection grant: the
   grant's subject is the connection key, its target is the inbox entity at `loam.grants`, its
   author is the owner. The store-targeting grant shape still validates unchanged beside it —
   both shapes in one store, neither confused for the other. Two connections to one container get
   two distinct inbox pools. Verified in `test/server/connection-container.test.ts`.
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
13. REVOCATION, two-sided: negating the inbox's genesis grant refuses the next write signed by that
    connection's key; a SECOND connection's write still lands; every delta the revoked connection
    wrote keeps its author and stays a member of the container. Verified in
    `test/server/connection-container.test.ts`.
14. WRITE ENFORCEMENT is structural: a connection write lands in its own inbox pool and no other
    ground. A key granted to inbox-1 cannot write into inbox-2 (its genesis grant does not target
    inbox-2), and a connection write never reaches the primary ground directly. Assert the delta's
    pool membership at the delta level. Verified in `test/server/connection-container.test.ts`.
15. The connection's seed never enters the ground. Scan the whole store after a full
    grant-write-revoke cycle; plant a leak first and prove the scan sees it (the H7 discipline: an
    instrument must fail before it is trusted). Verified in
    `test/server/connection-container.test.ts`.
16. No existing delta changes shape and no §20 migration is owed: a store created before this work
    reads identically after it. The connection grant reuses the `loam.grants` shape with an
    inbox-entity target (a value change on an existing shape); the inbox reuses the container
    declaration shape. Verified in `test/server/connection-container.test.ts` and by
    `grep -rn "39-connection" src/migrate` finding nothing.
17. A PER-CONNECTION DROP IS A TOTAL FORGET, two-sided: dropping one connection's inbox removes its
    genesis grant AND every delta that connection wrote from every ground; a named live bystander —
    a second connection's write, and the container's own direct members — survives, readable and
    unchanged. Assert at both levels: the connection's ids are gone from every ground (delta level)
    and a read of the container no longer resolves them (object level). No delta is promoted out of
    the inbox before the drop. Verified in `test/server/connection-container.test.ts`.

## 39.6 The two pre-blessing conditions, answered

**Conformance to Alice/Bob/Charlie:** the walkthrough IS the fixture plan. Criteria 1–8 are Alice
(narrow bindings, divergent containers, per-connection attribution). Criterion 11 is Bob (wide
binding, sub-container addressing). Criterion 12 is Charlie (root heap, no containers). Criteria
13, 14, 17 are the lifecycle all three share — revocation, write enforcement, total forget.

**Surprises: one, surfaced late and settled.** The write path (39.3d) was first drafted as
membership-by-authorship and pre-blessed on 2026-07-28. On 2026-08-01 Myk chose the inbox instead,
because it makes revocation and erasure structural rather than computed — the two operations the
erasure standing rule exists to protect. Everything else in this spec was unaffected. Two
verification findings remain conveniences rather than surprises: (1) the per-connection key
converges with phase 15's existing "actor seed per client" criterion — the arc already mints the
right object, this spec spawns it an inbox and binds it there; (2) `containerScope` already
implements membership-decides-reach, so the read half of the model is landed substrate. The one
new mechanism is the inbox: a container spawning per-connection pools and `containerScopeImpl`
composing them into the gather. That is Loam-side, verified feasible (pools spawn through
`openContainer`, and the gather already composes multiple grounds), and its cost — a pool per
connection, and erasure reaching inboxes — is named in 39.3d.

## 39.7 Premortem findings — three decisions settled, five folded

An independent premortem (2026-08-01, read-only, grounded in `container.ts`, `accounts.ts`,
`erase.ts`, and `SUBSTRATE-HAZARDS.md`) returned eight causes. Five were folded into the spec above;
three were DESIGN DECISIONS on the trust root and the erasure path. **Myk settled all three in chat
on 2026-08-01.** The build is unblocked.

**Settled by Myk (the three hard seams):**

- **H1 across the inbox boundary — SETTLED: closure is container-wide.** `containerScopeImpl` applied
  `withNegationClosure` PER GROUND, so a negation written through a connection could not suppress a
  target in the container's primary ground. Myk's ruling: the inbox is always in the container's
  membership, so a strike written there is always in the gathered set, so it holds — "in the gathered
  set = in play." IMPLEMENTATION: gather the container's admitted deltas across ALL its grounds
  (primary + every inbox), then run negation closure ONCE over that union — not per ground. The
  cross-ground strand rail is required and load-bearing: D1 admitted to the primary ground, D2
  (negating D1) admitted to an inbox, the container View must resolve WITHOUT D1. Criterion 9 is
  strengthened to place the strike across the boundary, not within one ground.

- **The append-door authorization path — SETTLED: the pool's own door, via the existing grant
  chain.** No change to root's `authorize`, and — refining the premortem's recommendation — no change
  to pool seeding either. A verified substrate fact (`container.ts`, `openContainerImpl`) is that a
  spawned pool is opened with the STORE's operator seed, so "the pool's operator is the owner" would
  need new seeding code AND an audit of every lifecycle-retraction signing site. It is not needed. The
  inbox pool keeps the store operator as its operator (existing machinery, every signing site stays
  valid), and authority is established by the grant chain `grantHeld` ALREADY resolves recursively
  (`accounts.ts`, verified 2026-08-01): (1) at PROVISIONING, the store operator authors an admin grant
  naming the OWNER in the inbox pool's own ground — effective because the store operator is the pool's
  operator; (2) at CONSENT, the OWNER authors the connection's write grant in that same ground —
  effective because the owner holds admin via (1); (3) the connection writes INTO the pool, and the
  pool's own `authorize` admits it because `grantHeld` walks connection-write → owner-admin → operator
  and resolves. The operator does ONE administrative act — provisioning the owner's authority over
  their own inbox, which 39.1 point 3 names as the operator's proper administrative capacity — and
  NEVER appears on the read/write data path. 39.1 point 3 holds: the owner authors the connection
  grant, the connection signs every write, the operator signs neither. Revocation (39.3c) strikes the
  owner-authored connection grant; the door refuses; the store operator is not involved.

- **The disconnect lifecycle (H9) — SETTLED: the inbox is durable; only an explicit drop removes
  it.** Myk's ruling, near-verbatim: a random disconnection must not permanently nuke the container;
  the binding is robust to connect/disconnect/connect; only an explicit drop drops it. IMPLEMENTATION:
  the inbox pool STAYS ATTACHED as a container member across a disconnect — it never becomes an
  unattached separate container, so `unreachableStoreReport` never faults and `membersOf` never
  throws (the premortem's deadlock and read-crash are structurally impossible, not merely handled).
  The inbox is keyed to the connection identity, so a reconnect with the same identity resumes the
  SAME inbox rather than spawning a second. Only an explicit REVOKE (strike the grant — writes
  refused, deltas kept) or DROP (erase the pool — total forget) changes the inbox's state. So the
  erasure default is: disconnect keeps everything; drop is the deliberate, explicit, two-sided act.

**Folded into the spec above (the five that were mine to answer):**

- **The connection grant's signer is the OWNER, via their §36 session (phase 8), not the operator.**
  At consent time the owner is signed in and their seed is in the home (`user.<name>.seed`, phase 3);
  the session carries it (phase 8). So 39.1 point 3 holds — the operator never signs the data path.
  As built (decision 2), the pool's operator stays the STORE operator, and the owner's connection
  grant is effective through the provisioned owner-admin chain that `grantHeld` resolves — NOT by
  making the owner the pool's operator (that would need new pool-seeding code).
- **The inbox grant is isolated BY GROUND, so it needs no distinct vocabulary.** The premortem worried
  that `lawfulStrikersJson` keys on `targetEntity === STORE_ENTITY`, so a store grant and an inbox
  grant differing only by an id value would be a fragile distinction. As built, that worry does not
  arise: the inbox grant reuses the ordinary `grantClaims(STORE_ENTITY, …)` shape but lives in the
  INBOX POOL's own ground (a separate reactor with its own genesis), never in the real store's ground.
  The real store's grant filters read the real store's reactor, which holds no inbox grants; each
  pool's door reads its own. Ground isolation gives what a vocabulary marker would have, without a new
  delta shape — so no §20 migration is owed (criterion 16 holds as stated).
- **"Total forget" is scoped to THIS STORE's grounds.** The inbox is a container member, so the
  container's read is federatable and renderable; a copy that left before the drop lives beyond the
  inbox's reach (H7). The spec claims total forget WITHIN this store's grounds and says so; reaching
  federated-out copies is erasure's existing cross-tier problem, not this phase's new promise.
- **The operator-level binding's blast radius is railed even though the guard is deferred.** 39.1
  point 5 defers a guard on binding to root; criterion adds that a root-bound connection's write
  still lands only in its inbox and cannot reach the root primary ground — so "no guard on binding"
  never silently means "no bound on writes."
- **The cross-write refusal is asserted at the door, not only at pool membership.** Criterion 14 is
  strengthened: a key granted to inbox-1 is REFUSED writing into inbox-2 and into the primary ground
  by the door, not merely observed absent from a pool.

## 39.8 Sequencing recommendation

The premortem shows the ISOLATED connection — bound to a separate container, reads and writes both in
its own pool — needs none of the three decisions except the disconnect lifecycle, and even that is
simplest there (a pre-existing container that persists across connections sidesteps the accumulation
problem). That path proves the whole OAuth → bound-MCP-connection flow end to end with almost no new
trust-root code. The INBOX (wide-read, narrow-write) is the harder tier. **All three seams are now
decided (39.7), so both tiers are buildable.** Recommended order holds: land the isolated-connection
path first as the testable milestone; build the inbox on top, since its three seams resolved to
existing-machinery changes rather than new trust-root code.

This spec was design-stage. Myk blessed the model on 2026-07-28, the write path on 2026-08-01, and
the three premortem seams on 2026-08-01 — all in chat. The design gate is passed. The build proceeds
on the standard bar (green + P5 + independent audit), and the landing writes `spec/39-*.md`.
