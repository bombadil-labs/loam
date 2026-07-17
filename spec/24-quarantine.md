## 24. The quarantine — a place where untrusted law may bind

Foreign law is inert by default. A remote-authored schema, resolver, or renderer federates in as data
and binds nothing (§8/§12/§15 — "data federates; authority never does"); a governed store honors only
its operator's law (§7). That floor is safe, and it is also BLIND. The only way to find out what a
stranger's lens actually computes over your ground is to bless it — at which point it is already law,
already binding, already yours. There is no dry run. You judge the book by its cover and then sign it.

The quarantine closes that gap. It is a place where untrusted, remote-authored schemas, resolvers, and
renderers actually RUN — bind a HyperSchema, resolve a View, materialize a door, paint pixels — over
your REAL ground, while everything they produce is sequestered from the primary pool. Mount a stranger's
whole app against your live data, watch what it computes, keep the outputs you like, and throw the rest
away by dropping a store. Blessing stops being a boolean flipped in the dark and becomes a promotion out
of a visible staging area: trust as a pipeline, not a coin flip. The shape that wants to exist is
**one-way glass** — the quarantine reads the primary's ground (and honors its erasures), writes only into
its own pool, and nothing crosses back into canonical authorship without a deliberate act. That act is
PROMOTION, and it comes in two strengths.

This is a **design-stage section**: it fixes the shapes and answers the eight design questions so a build
can begin from a settled contract, and it BUILDS none of it yet. Questions Myk has decided are marked
DECIDED; the genuinely open ones carry a reasoned RECOMMENDATION for his review, not settled law. The
section rides §23's decided ground verbatim — the host contract (§23.2), the snapshot doctrine (§22.3,
§23.1), the two trust axes (§23.9), and the sandboxed-renderer pen (§23.3) — and is the place where
§23.9's "separate pool, not a mark" posture lands as a running thing.

### 24.1 The separate store — proving the posture (question 1, DECIDED — Myk, 2026-07-12)

The posture is settled: the quarantine is a **separate store, federating one-way inbound** — not a mark
on canonical deltas. The design stage's job is to PROVE it rather than debate it, and the proof stands on
three legs, each already-built machinery pointed at a new purpose.

**It is a real store.** A quarantine is an ordinary Loam store (`StoreBackend`, §8) — its own backend,
its own ground, its own doors — governed by the SAME operator as the primary it shadows (it is the
operator's staging area, inside the operator's own walls). Stores are cheap; standing one up costs a
backend, not an architecture.

**The glass is one-way inbound federation.** The primary → quarantine edge is ordinary federation
(§8's `Peer`/`syncBoth`), with only the pull-into-quarantine leg wired: the quarantine pulls the
primary's deltas; the primary is never configured to pull the quarantine back. Because federation is
UNION at the substrate — `gateway.federate` deliberately skips `authorize`, and whether a peer's facts
shape a local view is a read-time trust choice (§8) — the quarantine holds a faithful, live replica of
the primary's ground with no new sync machinery. The one-way-ness is not a new primitive; it is a
deployment fact: the reverse leg simply is not wired. "Writes never flow back" is achieved by NOT
offering the quarantine as a peer, not by a policy every reader must remember.

**Discard is dropping the store.** Reject the stranger's app and you drop the quarantine backend;
everything the quarantined law authored vanishes with it — no negation-by-negation cleanup, no residue in
canonical history (§23.3). This is the leg a mark can never stand on: **you cannot discard a mark.** A
"sandboxed" flag on canonical deltas would demand that every reader, every door, every federating peer,
forever, honor it — and one reader that ignores the flag leaks the quarantine into canonical use, while
erasing a mark-quarantined set means negating it delta-by-delta, leaving residue in the history you meant
to keep clean. A separate pool makes isolation STRUCTURAL (a different store, not a convention) and
discard ATOMIC (drop it). And it costs nothing you wanted: §23.9's opt-in interop gives you exactly the
read access the mark promised — any primary-side query MAY opt in to including an active quarantine in its
own scope, reading across primary ∪ quarantine deliberately, for that query — so you can watch what the
stranger's app computes against your real ground without ever merging it. The separate store delivers
everything the mark offered (dry-run against live ground) plus the two things the mark could never give
(structural isolation and clean discard). The proof holds; if a build finds it failing, that is news to
bring back.

### 24.2 The one-way glass, precisely (question 2, RECOMMENDATION)

"Reads but never writes back" needs pinning against a grow-only union substrate, and there are two
distinct freshness questions hiding in it. RECOMMENDATION for Myk's review:

**The GROUND is live-followed; the LAW is a frozen snapshot.** These are different objects and take
opposite answers. The thing on PROBATION — the schema, resolver, or renderer under test — is a fixed,
content-addressed, author-attested snapshot (§22.3): the signature attests exactly the bytes that run,
one hash, no signed-vs-executed gap (§23.1). Quarantine judges a snapshot; promotion promotes a snapshot;
that half is frozen by doctrine. But the GROUND the snapshot reads is the primary's live ground,
tracked by the one-way inbound edge — live-follow, NOT a point-in-time freeze. Live-follow is the
recommendation for two reasons. First, a frozen ground goes stale: a dry-run against last week's data
answers a question nobody asked. Second, and non-negotiably, a frozen ground would not receive the
operator's ERASURES — and a quarantine that cannot forget is an erasure-evasion vector (§24.8). The snapshot
doctrine freezes what RUNS, never what it READS; the quarantine is a faithful dry-run precisely because
the ground goes on moving — and forgetting — underneath it, exactly as it would if the law were blessed.

**Why a moving ground is safe: reproducibility is from pinning the LAW, not freezing the DATA (Myk,
2026-07-15).** This is the substrate's own physics, and the same principle §17/§21/§23 already lean on — a
pin freezes the READING (the content-addressed schema + renderer), and a reading is a pure, re-runnable
function of ground. The ground is a grow-only CRDT: its merge is commutative, associative, and idempotent,
so `resolve(pinned-law, ground)` re-derives the same view coherently no matter how the ground grew — or
forgot — underneath it. A shifting floor under a pinned lens is therefore not a hazard to design around; it
is LOCAL-FIRST-LIVE, the same re-resolution any blessed Loam view performs when its answer moves. So the
quarantine invents no freshness rule of its own — it inherits the arc's: pin the reading, let the ground
live. (Reproducing a SPECIFIC past observation for audit — "what did it show me when I chose to promote?" —
is the one thing a frozen ground would buy, and §26 as-of reads plus the view's content-addressed `_hex`
already provide it, without freezing the sandbox.)

**"Never writes back" is the merge, not the read.** The quarantine's own ground is the union of the
inbound-federated replica of the primary AND the quarantined code's own outputs — writes signed by a
per-renderer/per-lens granted author into THIS pool (§23.3's sandbox-pool pen). Those writes land here
and only here; they cross into canonical authorship only through a deliberate promotion (§24.3/§24.4).
What stays one-way is the MERGE, not the visibility: §23.9's opt-in interop means a primary-side query
may look THROUGH the glass on purpose (include the quarantine in its scope), but nothing crosses the glass
into canonical history without an explicit act. The glass is transparent by opt-in and impermeable by
default.

**Honesty — what the quarantined code may SEE is all-or-nothing, and the recommendation accepts that.**
Loam has NO read-side capability slices today: the mount is the read boundary (§7 — "one mount = one
store = one isolated world"), and there is no machinery to hand running code a narrowed read of a store's
ground. So a quarantined lens sees ALL of whatever ground reached the quarantine — there is no per-field,
per-lens read confinement to invent honestly here, and this section will not reference machinery that
does not exist. The RECOMMENDATION is to ACCEPT all-or-nothing for v1 rather than build a read-side
capability system, for two reasons: (1) the quarantine is the operator's own staging area, so exposing
the operator's own ground to code running under the operator's own walls leaks nothing OUTWARD — the
one-way glass guarantees no output escapes; and (2) a genuine read-side slice is a large independent
design (a read-side dual of §7's write capabilities) that belongs to its own ticket, not smuggled in
here. The narrowing knob that DOES exist is at the federation EDGE: the operator chooses WHAT to seed the
quarantine with. Inbound federation is selective (a §8 trust policy — roster, shape predicate — filters
what the quarantine admits), so the operator can stand up a quarantine over a HAND-PICKED subset of the
primary's ground rather than the whole store. The honest granularity is therefore "which deltas you let
INTO the quarantine at all," pre-filtered at the edge with existing machinery — not "which deltas a given
piece of code may see once they are in." A future read-side capability slice can narrow the second; v1
narrows the first and says so. (Slice 1 BUILT this knob as `QuarantineOptions.admit` — a per-delta
predicate on the inbound edge, `src/gateway/quarantine-pool.ts`; §24.10 reconciles it with §27.6's
membership-is-a-query and names the rhizomatic 0.6.0 set-algebra that generalizes it.)

**The dependency tree — why "drop" stays consequence-free (DECIDED, Myk, 2026-07-15).** The property that
makes the quarantine trustworthy is structural, not vigilance-based: the dependency graph is a ONE-WAY
TREE. The primary is the root; each quarantine is a LEAF that reads DOWN from the primary (and from its own
writes), never UP into the primary. Cutting a leaf is provably consequence-free — the primary never
involuntarily depends on a leaf, so dropping a quarantine cannot move a canonical view. "Cross-quarantine"
then splits into two, and only one is dangerous:

- **Operator read-scoping at query time is SAFE, and kept.** The operator may run a read scoped over
  `primary ⊎ quarantine-A ⊎ quarantine-B` — an EPHEMERAL lens assembled per query, holding no stored edge.
  Drop B and the next chosen scope simply omits it; nothing dangles, because nothing in the primary or in A
  was STORED pointing at B. This is the "cosmos you operate within" — a read-time lens you compose, not a
  wiring the quarantines carry. Primary coherence is never involuntarily coupled to any quarantine.
- **A quarantine's own LAW persistently depending on ANOTHER quarantine is FORBIDDEN in v1.** If a
  quarantined app STORED deltas that point at a peer pool's entities, that pool's own views would depend on
  the peer being alive — turning the one-way tree into a graph and breaking "drop is consequence-free." v1
  keeps the tree one-way: no quarantine holds a persistent stored dependency on another. (The richer
  "long-running quarantines whose apps wire into each other" is a NAMED FUTURE DIRECTION with its own
  drop-cascade semantics — not foreclosed, just not v1.)

The invariant a machine can ENFORCE: every quarantine reads DOWN (the primary + its own writes), never
SIDEWAYS as a stored dependency; the only "sideways" allowed is the operator's ephemeral read-scope, which
is safe precisely because it is a query, not an edge.

### 24.3 Promotion, two strengths — the outputs (question 3, RECOMMENDATION)

Promotion is the one deliberate act that crosses the glass. It has two strengths, and this subsection
pins the harder one — adopting OUTPUTS while the code stays sequestered ("I like what it said, not what
it is"). RECOMMENDATION for Myk's review.

On append-only ground, promotion cannot MOVE a delta: a delta lives in the quarantine store, its id is
its content, its signature is its author's, and nothing is ever edited (§11, §20). Promoting an output
therefore RE-SIGNS or ENDORSES it — never relocates it — and this is close kin to §20's migration
re-signing, with one difference that matters. Two flavors, and v1 recommends the first as the clean
default:

- **Adopt-as-mine (re-sign) — the recommended default.** The operator re-speaks the quarantined output's
  content as the operator's OWN claim into the primary, authored and signed by the operator, carrying a
  provenance pointer set that records where it came from. This is the §8-translation / §11-anonymous-
  reassertion shape (a canonical delta signed by the local authority that CITES its source by id), now
  pointed at the quarantine. Because the value crosses by being RE-ASSERTED (the bytes are authored
  fresh, not federated), the quarantine pool can then be dropped wholesale and the adopted value survives
  in the operator's voice — promotion composes with clean discard. **The claim shape (pinned):** an
  operator-signed claim asserting the adopted content, plus a reserved provenance pointer set under
  context `loam.adoption`:
  - `adopted-from` — the quarantine pool's store id + the source delta's id (what was adopted),
  - `produced-by` — the content address of the quarantined law that computed it + the granted-author
    identity it wrote under (WHAT made the output),
  - `adopted-by` — the operator identity performing the promotion (WHO blessed it),
  - `at` — the promotion timestamp (WHEN).

  This is a normal claim carrying provenance pointers, exactly the discipline §8's `translates` pointer
  and §22's `rdb.derived.*` already use — no new delta kind, one reserved pointer role. It is HALF of
  §20's re-sign-and-negate: the re-sign into the new home, with NO negation of the source (the quarantine
  is discarded wholesale, §23.3, so there is nothing to negate delta-by-delta).

- **Adopt-as-theirs-with-my-blessing (endorse-import) — the richer option.** When the operator wants to
  PRESERVE the original author's attribution rather than absorb it, the deliberate crossing is a selective
  federation of that ONE hand-picked delta from quarantine → primary (its bytes cross, its id and
  signature preserved — content-addressing makes the import lossless), plus an operator grant/trust act
  (§7/§8) so the primary's GOVERNED reader honors that foreign author's delta. Provenance is then native:
  the delta still says who authored it, and the operator's grant says "I bind this one." This is the exact
  dual of §23.9's opt-in interop — the sanctioned reverse crossing — and it reuses §8 federation + §7
  granting with no new machinery. It is the richer choice because it plants a foreign author's delta in
  canonical history (a larger trust commitment), so it is offered, not defaulted.

RECOMMENDATION: build re-sign (`loam.adoption`) as v1's promote-outputs, because it needs no new grant in
primary and it composes with clean discard; describe endorse-import as the attribution-preserving option
for a later slice. In both, the tell from §22.2 holds: a resolver output the operator wants to REMEMBER
was never really a resolver value — it wanted to be a claim, and promotion is where an interpretation
becomes one (the §22 read/write dual, arriving).

**Promotion enforces REFERENCE CLOSURE (Myk, 2026-07-15).** A promoted delta must resolve in its new home:
its pointers may target only entities/deltas that ALREADY live in the primary, or that are promoted with it
in the same closure. A delta whose reference would DANGLE in the primary (it pointed at something that
exists only in the quarantine pool) is refused, or the operator adopts the closure that makes it whole. Two
things force this. First, a pool's read view unions in UNBLESSED foreign deltas (§24.2), so promotion must
always be "adopt THESE specific outputs," never "the pool looked coherent, take it all" — the coherence you
saw may have leaned on deltas you are not adopting. Second, it is the same reference discipline any
cross-store adoption needs on append-only ground: you cannot promote half of a thing and leave the other
half behind the glass. This is the primary-side guard that keeps the one-way tree (§24.2) intact through
the one door that crosses it — promotion adds nothing to canonical history that canonical history cannot
resolve on its own.

### 24.4 Promotion of law is registration (question 4, RECOMMENDATION)

Promoting the LAW — blessing the schema, resolver, or renderer itself into the primary so it binds like
anything operator-registered — should reuse the ORDINARY publish path, with no special quarantine
machinery. Since rhizomatic 0.5.0 this is clean: a Schema is a first-class publishable entity
(`SCHEMA_SCHEMA` + `publishSchemaClaims`/`loadSchema`, §21), so promoting a quarantined schema out is
publishing its claims into the primary as the operator's own registration — the same act the operator
uses for their own lenses. A quarantined resolver graduates as the operator's §22 binding (its
content-addressed ESM re-published under the operator's authorship); a quarantined renderer graduates as
the operator's §23 renderer binding. In every case the quarantine was the PROBATION and the ordinary
publish is the graduation — blessing is a promotion out of a visible staging area, never a boolean
flipped in the dark, and §6's two-authority discipline still holds: blessing the code and granting its
pen are different keys (§23.3).

RECOMMENDATION: promotion-of-law reuses `publishSchemaClaims` / the §22 binding publish / the §23 renderer
binding publish verbatim, and **the quarantine record survives as provenance on the blessed thing** — the
operator's registration carries a `loam.adoption`-style pointer back to the quarantine run (the pool id,
the trial, who promoted, when), so "this law was vetted in quarantine before it bound" is on the record,
auditable like any provenance. The graduation is an ordinary publish that remembers its probation.

### 24.5 Resource discipline — the wild end running for real (question 5, RECOMMENDATION)

Quarantined code is §22's purity ladder's WILD END running for real. The rungs v1 refused for the
operator's own resolvers — (c) store-querying, (d) effectful, (e) synthetic — are exactly what a
stranger's app wants to exercise, and the quarantine is where you LET them run to see what they do,
sequestered. That freedom needs a budget, and the hard constraint is that **the quarantine's budget must
not degrade the primary store's doors.** RECOMMENDATION for Myk's review.

**Confinement rides §23.9's worker sandbox, and here it is REQUIRED, not accepted.** §23 v1 runs an
operator's OWN bundle in a Node `worker_threads` Worker with a hard timeout and memory `resourceLimits`
(§23.9) — bounding HANG, CRASH, and MEMORY, but honestly NOT fs/net: a worker can still reach `node:fs`
or the network, and §23 accepted that for operator-authored code in a governed store. The quarantine
cannot accept it: this is foreign code, and §6 names ocap confinement (`isolated` bodies in a SES /
Worker / wasm compartment) as REQUIRED for federated code. So the quarantine is the place where the
deferred full-ocap hardening (no-fs/no-net — SES-in-worker or isolated-vm, §23.9's named further work)
becomes a prerequisite, not a nicety. **Flag, stated plainly:** until that ocap layer ships, a quarantine
that admits rung (d) effectful code bounds resource-exhaustion (the worker caps hang/crash/memory) but
does NOT bound ambient-authority reach — it is trusting the code not to touch fs/net. The quarantine's
FULL promise (run a stranger's effectful app safely) depends on the ocap slice; v1 can ship the pool and
the glass with worker-only confinement and be honest that effectful confinement awaits it.

**A separate store gets a separate budget.** Because the quarantine is its own store (§24.1), it runs on
its OWN resource envelope — its own worker pool, its own compute-timeout and memory ceilings, its own
outbound-effect budget (§6's lifetime trigger count / divergence guard, sized to the probation) — wholly
separate from the primary doors' budgets (§12's `maxPublicWatches` / per-door caps). A quarantined
infinite loop times out in the quarantine's worker; the primary door never notices. RECOMMENDATION: a
quarantine declares an explicit resource envelope at creation — compute timeout, memory bound, outbound-
effect budget, and the highest purity rung it admits (a–e, §22.1) — enforced by the §23.9 worker sandbox
running in the quarantine's own pool. The declared rung ceiling is what a reader trusts: a quarantine
that admits rung (d) is saying, in the open, "effectful code runs here, its values are not facts about
the ground, and its cost is bounded to this pool."

### 24.6 The quarantine-first workflow (question 6, DECIDED — Myk, 2026-07-12)

Settled: **quarantine-first is the POSTURE for all federated law**, with inert-by-default (§8/§12/§15) as
its degenerate no-quarantine case. Everything remote-authored lands in quarantine first, runs there, and
blessing is ALWAYS a promotion out of it (§24.3/§24.4) — trust as a pipeline with a visible staging area,
not a flag toggled in the dark. The default flips only when the quarantine actually ships; both remain
expressible forever (a store with no quarantine configured is exactly today's inert-by-default floor, and
that never stops being valid). The lever from §23 holds at the screen: a foreign renderer mounts nothing
until blessed, and now "blessed" has a shape — it graduated from probation.

### 24.7 The renderer in probation (question 7, RECOMMENDATION)

A quarantined renderer is the vivid case, and §23 already built most of the path. §23.3 decided that a
sandboxed renderer writes under a per-renderer granted author into the SANDBOX POOL (a separate store the
operator can drop), never canonical — and §24.1 supplies that pool. What §24 adds is the FRAME.
RECOMMENDATION: the stock React host (§23.2), when it mounts a quarantined renderer, must (1) inject
handles scoped to the quarantine pool — writes land IN the quarantine (§23.3's pen-into-pool) and the app
reads them back (the pool's read view is `primary-ground ⊎ its-own-writes`, §24.2), so a probationary app
is genuinely RUNNING, statefully: the operator watches it DO things, not paint a frozen preview, (2) render
a VISIBLY-SEQUESTERED frame — chrome that says, without ambiguity, "this is probation; its writes are LIVE
HERE and quarantined from your store — promotion is the only crossing" (NOT "its writes go nowhere," which
would be a lie: they go into the pool, and that is the whole point of a dry-run) — the trust UI of §23.9
arriving at §24, so a user is never fooled into thinking a probationary face is load-bearing OR into
thinking it is inert, and (3) offer the promotion controls at the frame's edge (bless the law, §24.4; adopt
an output, §24.3). This is §23's "push deltas, get software" run behind glass: a stranger's whole app
renders against your real ground, its every write LIVE in the pool and sequestered from canonical, and the
promotion controls are the only door out. No new renderer
machinery — §23.3 built the pen-into-sandbox-pool path and §23.9 built the confinement; §24 supplies the
pool, the glass, and the visible frame around them.

### 24.8 Erasure must reach the quarantine (question 8, HARD REQUIREMENT)

This is §11's law arriving at §24, and it is not optional. The quarantine holds a live replica of the
primary's ground (§24.1). If tombstone + purge (§11) do not propagate INTO it, the quarantine becomes an
erasure-EVASION vector: a data subject exercises Art. 17, the operator erases the delta in the primary —
and the forgotten bytes live on in the staging area, inside the operator's own walls. The one-way glass
must therefore carry the operator's TOMBSTONES IN, even though nothing flows back OUT. State it as law:
**an erasure in the primary must forget the byte in every active quarantine over that ground, byte-for-
byte, with no path back.**

The mechanism composes existing §11 machinery, and the composition is exact because the quarantine is the
SAME operator's store — so the operator's tombstone is authoritative there (no cross-operator refusal,
§11's per-instance rule is satisfied within one operator's walls):

1. **The tombstone federates in.** A §11 tombstone is an ordinary operator-signed claim at `loam.erasure`;
   the live-follow inbound edge (§24.2) carries it into the quarantine like any delta, and the quarantine's
   federation door admits it (its operator's own order). "The door remembers the hole" (§11) now holds in
   the quarantine: the tombstoned id is refused re-entry forever, so a later federation pulse cannot
   resurrect it — forgetting STICKS against the quarantine's own union.
2. **The purge fans out to the quarantine pool.** Tombstoning refuses the id; PURGE removes the bytes, and
   §11 already requires purge to reach "every tier — the sqlite row, the mirror, the archive's fan file."
   A quarantine pool is another replica of the ground, so the erase operation's fan-out must ENUMERATE
   active quarantine pools and purge the byte there too. **Flag (a build requirement, not new doctrine):**
   §11's purge fan-out and its blast-radius manifest must learn about active quarantine pools — they
   register as replicas of the ground the erase reaches. This is an extension of §11's existing every-tier
   fan-out, surfaced here so it is built, not discovered. **And the enumeration must survive a restart
   (premortem finding, 2026-07-16):** slice 1's fan-out reaches pools ATTACHED IN-PROCESS via
   `openQuarantine`; a pool on a DURABLE backend that outlives the primary's process and is never
   re-attached is a replica no fan-out reaches — the forgotten byte survives in its backend file. The
   build rule: a durable quarantine must be REGISTERED (a record the primary reads at boot, re-attaching
   the pool to the fan-out) or it may not be durable; an unregistered durable pool is an erasure-evasion
   channel and the erase operation must refuse to report completeness it cannot deliver. (In-memory pools
   die with the process and carry no such risk — which is why slice 1's default backend is in-memory.)
3. **`heal()` in the quarantine consults tombstones** and never resurrects a purged id (§11's crash-in-
   reverse discipline), exactly as in the primary.

**The test that pins it (design-time, precise):**

- **Setup.** A primary store P holding a delta `d`. A quarantine store Q live-following P over a one-way
  inbound federation edge. Pulse federation; assert `d` is resolvable in Q (Q holds the replica).
- **Act.** The operator erases `d` in P — §11 tombstone `d` at `loam.erasure` + purge `d`'s bytes from P.
- **Assert (four, together):**
  1. **The tombstone propagates IN** — after the next pulse, Q's tombstone set contains `d`'s id.
  2. **The byte is GONE from Q** — Q's backend holds zero bytes of `d`'s content (purge fanned out to Q's
     pool), and resolving `d` in Q returns nothing.
  3. **Re-entry is refused** — a subsequent federation pulse OR a direct re-append of `d` into Q is
     refused by Q's door (the tombstone makes forgetting stick); Q cannot resurrect the forgotten byte.
  4. **No evasion by any read scope** — there is no path, not even the §23.9 opt-in interop that includes
     Q in a primary-side query's scope, under which `d`'s content resurfaces from Q.

The test's whole point: erase in the primary ⇒ forgotten in the quarantine too, byte-for-byte, no door
back. A quarantine that fails any of the four is an erasure-evasion channel inside the operator's own
walls, and §11 forbids it.

**The fan-out re-derives its own reach (corrected, [#120](https://github.com/bombadil-labs/loam/pull/120)).**
Audit 2 found slice 1's fan-out TRUSTING three conditions it should have RE-DERIVED, and the corrected
contract is now law, built and railed:

- **The tombstone crosses the glass regardless of the pool's TRUST policy.** Trust (§8) is admission
  configuration — whose data do I want; erasure (§11) is law, and the pool is the operator's OWN replica
  (§24.1). A `closed` pool is still inside the operator's walls, so the fan-out delivers the tombstone
  past the pool's own door with an explicit admit. Authorization is untouched and checked FIRST: a forged
  or foreign tombstone is refused loudly, without purging — the correction removed a trust filter, never
  a check.
- **The tombstone crosses regardless of the SEEDING filter.** A §24.2 `admit` narrows what a pool SEES,
  never what it must FORGET: the seeding edge passes the operator's tombstones through unconditionally,
  so a pool seeded past a pre-attachment erasure inherits the holes along with the ground, and a lagging
  peer's re-send of the purged bytes is refused at its door.
- **The fan-out is TRANSITIVE.** A pool of a pool is still the operator's replica; `eraseReplica` recurses
  into its own attached pools (cycle-guarded), so P → Q → R forgets at every depth.
- **Failure is LOUD.** After authorization and the admit override, the only way a lawful tombstone does
  not land is the pool's store itself failing — and that THROWS, making `erase` reject, so the operator
  learns the erasure did not complete. Never a silent success.

### 24.9 What v1 builds, and what it only describes

This section describes the whole; the build slice that follows it is deliberately narrow, and the
recommendation for that slice:

- **BUILD:** the separate-store quarantine over a one-way inbound federation edge (§24.1); the live-follow
  glass with selective-edge seeding (§24.2); the §11 erasure propagation IN — tombstone-follows + purge-
  fan-out + the erasure test of §24.8 (this is the non-negotiable law, built first); promote-outputs by
  re-sign (`loam.adoption`, §24.3) and promote-law by ordinary publish carrying the quarantine provenance
  (§24.4); the quarantine resource envelope over the §23.9 worker sandbox in its own pool (§24.5); and the
  quarantined-renderer sequestered frame (§24.7), riding §23.3's pen-into-pool.
- **DESCRIBE, defer to their own slices:** endorse-import promotion (§24.3's attribution-preserving
  option); the full no-fs/no-net ocap confinement the effectful rungs require (§24.5's flag — SES-in-
  worker or isolated-vm, the §23.9 named hardening); and a genuine read-side capability slice that would
  narrow the all-or-nothing read (§24.2's honesty note) — a read-side dual of §7, its own design.

**Boundaries, in the §13 register.** The quarantine widens nothing a door may lawfully answer: a foreign
lens runs behind glass, its outputs sequestered, and it binds canonical law only through a deliberate
promotion the operator authors (§7 — authority never rides in on data). The glass is one-way in the MERGE,
transparent by opt-in in the READ (§23.9): you may look through on purpose, you never merge by accident.
And erasure reaches through the glass unconditionally (§24.8) — the quarantine is a staging area, never a
hiding place. "Run a stranger's whole app against your real ground" never means "let a stranger's app
touch your real ground": the pool catches every write, discard is erase-by-construction, and promotion is
the only door out.

### 24.10 The quarantine is a container — reconciling with §27 (added 2026-07-16, accepted with [#115](https://github.com/bombadil-labs/loam/pull/115))

§27 (design-stage, merged after this section's first draft) named the primitive underneath this whole
section: a quarantine is a **container** — a referenceable, content-addressable pool of deltas — with its
knobs set to the posture UNTRUSTED · one-way-seeded · live · droppable. The quarantine pool of slice 1
(#109) is that primitive's first and only built instance. The two framings must not drift, so this
subsection reconciles them explicitly, clause by clause:

- **The separate-store proof is BOUNDED by §27, not weakened.** §24.1's "you cannot discard a mark" is an
  argument about UNTRUSTED FOREIGN law, and §27.1 says exactly that: among your OWN deltas, exclusion may
  be a flippable property (a claim about the container entity); only across a trust boundary must it be a
  wall (a separate store — the only thing that gives discard-with-zero-trace and erasure-evasion
  resistance). A quarantine is *definitionally* the untrusted case, so it always sits at the wall end of
  §27.1's spectrum: a separate store, never a mark, never a property. The proof holds within its domain,
  and §27 names the domain. Nothing in §24.1 moves.
- **Seeding is a membership query, and slice 1 built its degenerate form.** §27.6 decided that a
  container's contents are a delta-query — a rhizomatic `Term → dset`, static or live, local or remote.
  The quarantine's inbound edge is the LIVE, REMOTE-over-federation case, and slice 1's
  `QuarantineOptions.admit` (a per-delta predicate filtering the pulse) is that query's degenerate form.
  **Landed** ([#132](https://github.com/bombadil-labs/loam/pull/132), ticket T15): the first-class
  membership `select`/`watch` surface serves, and the quarantine's edge filter takes a membership
  `Term` (`QuarantineOptions.membership` — give it OR `admit`, never both) — the same knob,
  generalized, no new mechanism, re-evaluated on every pulse, with the T16 law intact (a scope
  narrows what a pool SEES, never what it must FORGET: operator tombstones pass unconditionally). Composition of what a
  quarantine sees is then the container set-algebra: rhizomatic 0.6.0's `difference`/`intersect` (adoption
  queued as T14) complete the `∪`/`∩`/`∖` operators, so a quarantine can be seeded over "these containers
  minus those" with nestable exclusions. **Boundary flag (0.6.0, stated precisely):** `difference` and
  `intersect` are **Term-layer operators only** — they compose delta-sets at the scope level; they are NOT
  usable *inside* `inView` predicates, whose depth-1 stratification is unchanged. Scoping what a
  quarantine admits is Term-level algebra at the EDGE, exactly where §24.2 already put the narrowing knob;
  this section invents no predicate-level machinery and no parallel mechanism.
- **Promotion is the container operation, named twice.** §24.3's promote-outputs (re-sign with
  `loam.adoption` provenance) IS §27.3's **adoption-merge** — the trust-boundary crossing, built as the
  primitive's first cross-container operation (PR #111). §27.3's *scope-merge* (flip the exclusion
  property, no re-sign) NEVER applies to a quarantine's foreign outputs: they are across a trust boundary
  by definition, so they cross only by re-authoring. And §27.3's reference-load *is what a quarantine is*;
  merge-loading a quarantine wholesale is exactly what §24.3's reference-closure rule already forbids —
  promotion is always "adopt THESE specific outputs," never "take the pool."
- **The tree rule is one rule.** §24.2's one-way dependency tree (DECIDED, Myk 2026-07-15) and §27.4's
  "live containers stay a tree; frozen module-versions can be a pinned DAG" are the same law seen from
  both sides. A quarantine is live by definition, so it lives under the tree clause forever. The DAG
  clause never reaches it: freezing a quarantine's contents into a content-addressed module version
  (§27.2) mints a NEW, immutable thing that may be pinned in a DAG — but that thing is a module version,
  no longer a quarantine. Probation ends where freezing begins; the LAW under test was always frozen
  (§22.3's snapshot doctrine), the POOL never is.
- **Normative split, so neither section drifts.** §24 stays normative for the quarantine POLICY — the
  glass, promotion, resource discipline, the erasure law. §27 is normative for the PRIMITIVE — membership,
  identity, the merges, the algebra. When §27.7's `Container` lifting lands, `openQuarantine` becomes the
  quarantine PRESET of the container constructor, with no semantic change to anything this section fixes.

**Provenance.** **Design ACCEPTED — landed [#115](https://github.com/bombadil-labs/loam/pull/115)
(Myk's P6, merged 2026-07-16).** Drafted Claude 2026-07-15 as the decision memo fixing the shapes and
answering the eight design questions; the merge is the acceptance. What is BUILT within it is what the
notes below say (slice 1 #109, promote-outputs #111, the T16 fan-out correction #120) — the later slices
(resource envelope, sequestered renderer frame, promote-LAW, membership select/watch) are queued as their
own tickets. Questions 1 (separate-store posture) and 6 (quarantine-first workflow) are DECIDED by
Myk (2026-07-12) and proved here; questions 3, 4, 5, 7 carry reasoned RECOMMENDATIONS for his review;
question 2 (the one-way glass) is now largely DECIDED (Myk, 2026-07-15): writes land LIVE in the pool and
the app reads them back (read view = `primary-ground ⊎ pool-writes`), reproducibility comes from pinning
the LAW not freezing the DATA (CRDT + deterministic resolution), the dependency graph stays a ONE-WAY TREE
(operator ephemeral read-scope across quarantines is allowed; a quarantine's LAW persistently depending on
another is forbidden in v1), and promotion enforces reference closure — with the all-or-nothing read
granularity the one residual RECOMMENDATION; question 8 (erasure must reach the quarantine) is a HARD
REQUIREMENT with a pinning test — §11's law arriving at §24, not an optional nicety. (The 2026-07-15
decisions were worked out with Myk in chat; the "writes go nowhere" framing of an earlier draft was
corrected here — writes go into the pool, which is the entire point of a dry-run.) Realizes ADLC ticket **T5**. Depends on §23
(the host contract, the snapshot doctrine, the two trust axes, and the sandboxed-renderer pen — all
merged) and, through it, on §21 (a Schema is a first-class publishable entity — `SCHEMA_SCHEMA` /
`publishSchemaClaims`, which makes promote-of-law clean) and §22 (the purity ladder whose wild end this
lets run for real).

**SLICE 1 BUILT** [#109](https://github.com/bombadil-labs/loam/pull/109) (realizes ticket T13) — the
non-negotiable foundation of §24.9. `Gateway.openQuarantine` (`src/gateway/quarantine-pool.ts` +
`gateway.ts`) stands up a QUARANTINE POOL: a second gateway over its OWN backend, seeded ONE-WAY from the
primary by federation (`federate(offeredDeltas())` — inbound only, so a pool write can never reach the
primary), sharing the primary's operator so the operator's law binds and — the point — the operator's
erasure stays authoritative there. The ground live-follows (`reseed` re-pulses the edge). §24.8's law is
built and tested first: `Gateway.erase` now FANS the erasure OUT to every attached pool (`eraseReplica`
lands the operator's tombstone and purges the byte — gated on the tombstone actually landing, so a forged
tombstone can never drive a purge), so §11 reaches through the one-way glass and the pool can never hide a
forgotten byte. Drop is consequence-free (`drop` detaches from the fan-out + discards the store). Tests
`test/gateway/quarantine.test.ts` (6: separate-store/drop, one-way glass, live-follow, the four-part §24.8
erasure at the byte level, purge-reaches-every-pool, and the forged-tombstone-cannot-purge guard); village
act `demos/village/phase-quarantine.mjs` (A PLACE WHERE UNTRUSTED LAW MAY BIND, 4/4). **Deferred to their
own slices** (§24.9 DESCRIBE): promotion (promote-outputs `loam.adoption` re-sign + promote-law via the
ordinary publish path); the per-quarantine resource envelope over the §23.9 worker; the sequestered
renderer frame; the full no-fs/no-net ocap; and a read-side capability slice. **Residual, noted:** the
erasure fan-out is best-effort-and-loud — a pool whose `eraseReplica` throws makes `erase` REJECT (the
operator learns the erasure did not fully complete) rather than silently evade; a future slice can make it
transactional. New capability/federation/erasure surface → Myk's merge (P6).

**T5 full-design pass (Claude, 2026-07-16)** — the decision-memo PR closing ticket T5's design stage.
Added §24.10 (the explicit §27 reconciliation: the separate-store proof bounded to the untrusted domain,
seeding as a membership query with `admit` as its built degenerate form, the 0.6.0 Term-layer boundary
flagged, promote-outputs identified with §27.3's adoption-merge, the one tree rule, and the §24/§27
normative split); amended §24.2's honesty note to cite the built `admit` knob; and strengthened the §24.8
rail with a composed-scope, byte-for-byte assertion (`test/gateway/quarantine.test.ts` — the widest scope
any §23.9 opt-in interop read could assemble, primary ⊎ pool, holds zero bytes of a purged delta; to be
re-pointed at the first-class scope surface when it lands). §24.3 promote-outputs is BUILT and landed as
[#111](https://github.com/bombadil-labs/loam/pull/111) (merged 2026-07-16, the same day's P6 as the
design pass #115 — this section's DRAFT status ended with those merges); questions 1 and 6 are his
decisions proved, 2 largely his decisions with one residual recommendation (all-or-nothing read
granularity), 3/4/5/7 reasoned recommendations he accepted at the merge, 8 a hard requirement pinned
green against slice 1.

**PROMOTE-OUTPUTS BUILT** [#111](https://github.com/bombadil-labs/loam/pull/111) (the first §24.9
follow-on slice; retires ticket T5 alongside the design pass #115) — promotion's first strength (§24.3), and the FIRST
cross-container operation of §27 (merge-load with kept provenance, the thing that makes fork/pull-request
native). `Gateway.promote(source, deltaId, opts?)` adopts a delta a quarantine produced by RE-SIGNING its
content as the operator's OWN claim into the primary, plus a separate `loam.adoption` RECORD
(`src/gateway/adopt.ts`) citing it with the trail: adopted-from, source-delta, produced-by (the
granted-author it wrote under), adopted-by, at. The re-assertion **inherits the source timestamp** (§11
rung 2's translation trick), so promotion is content-addressed and IDEMPOTENT — promote twice, converge on
one adopted delta and one record — and **erasure holds**: an adopted delta the operator later erased
re-mints the SAME id on any re-promotion attempt, which its tombstone refuses. The value crosses by
re-assertion (never federation), so the pool can be dropped wholesale and the adopted value survives in the
operator's voice. `Gateway.adoptions()` reads the trail (the raw material of §27's "review what's in
here"). Reference CLOSURE is enforced and the trail is the bridge: a citation of an already-adopted pool
delta is REWRITTEN to its adopted counterpart (so chains promote in dependency order and no pool id ever
enters the primary's ground); a citation satisfying neither is refused (§27). And promote-outputs adopts
FACTS, never LAW: a delta declaring a reserved vocabulary (`loam.*` / `rhizomatic.*` contexts, `loam:`
entities) or carrying a negation is refused — operator authorship is force, and law crosses only by
§24.4's own ceremony (`promotionRefusal`, `src/gateway/adopt.ts`), which also keeps the adoption trail
unforgeable through its own door. A build-time correction worth recording: the provenance must ride a
SEPARATE record delta, not the content delta — co-mingling made the content's own gather pick the
provenance up as part of the value, resolving a `pick` field to a compound object; the fix is §11's
tombstone-is-separate discipline applied to adoption. Named residual (Myk, §24.4's design): whether a
DOMAIN negation (a quarantined app retracting a domain fact) may ever cross by adoption, and whether the
free-text `from` label should harden to the pool's store identity. Additive → no §20 migration. Tests
`test/gateway/promotion.test.ts` (11: adopt + resolve under the operator, the provenance trail,
survives-drop, reference-closure-refused, chain-rewrite, idempotence + inherited timestamp,
erased-stays-dead, and the three law refusals — grant-shaped, forged-adoption, negation). **Follow-on
slices:** promote-LAW (bless a schema/renderer via the ordinary publish path, §24.4) and endorse-import
(attribution-preserving federation) are their own tickets; the fork/PR village demo is a fast follow-on.
New capability/provenance surface → Myk's merge (P6).

**T16 FAN-OUT CORRECTION** [#120](https://github.com/bombadil-labs/loam/pull/120) (realizes ticket T16;
audit 2's HIGH + two MED, 2026-07-16) — the §24.8 fan-out now RE-DERIVES ITS OWN REACH (the corrected
contract stated in §24.8 above). One mistake, three faces, all in `eraseReplica` / `openQuarantine`
(`src/gateway/gateway.ts`): the tombstone now crosses past the pool's trust policy (an explicit admit —
authorization via `eraseDefect` checked first, explicitly, refusing loudly without purging), past the
seeding `admit` filter (tombstones pass the edge unconditionally), and TRANSITIVELY into nested pools
(cycle-guarded recursion), and a lawful tombstone that still cannot land makes `erase` THROW instead of
silently succeeding. Rails `test/gateway/erasure-fanout.test.ts` (5: closed-trust byte-at-rest, loud
failure against an honestly-failing backend, transitive P→Q→R byte-at-rest, pre-attachment-erasure
inheritance through a filtered seed, the narrowing knob unbroken) — the three finding rails each failed on
the pre-fix code; slice 1's forged-tombstone rail survives with its byte assertion verbatim, extended to
assert the refusal is loud. No migration (no delta changes shape). Erasure surface → Myk's merge (P6).
