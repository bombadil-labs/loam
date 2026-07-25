# T64 — Two-phase erasure: a slate is a container, and the cut ends by dropping it

**Ticket.** T64. **Lands** `spec/29-slating-and-graveyards.md` (§29 — the next free number; §28 is the
last written and reserved numbers are load-bearing). **Amends** `spec/11-erasure.md`: the §11 promise
CHANGES from one instantaneous act to two phases with a visible intermediate state (decided by Myk in
chat, 2026-07-21 — "this complies better with everyone's needs and expectations"). Design-stage: this
spec carries the recommendations; **the decision and the merge are Myk's**, unconditionally, because it
changes what the system promises on the erasure surface.

Built on T32, which landed the container primitive (`spec/27` §27.1/§27.7, `src/gateway/container.ts`).

## The premise, checked before it is built on

The ticket's premise is that a slate IS a container and T32 gives two-phase erasure almost for free. It
is nearly right, and the two places it is not are the whole engineering content of this section.

**What T32 already gives, at no cost.** A property container is a query over shared ground with zero
copies (`posture: "property"`); its membership is a `Term → dset` carried inline or by content address;
`containerScope({containers:[c]})` and `Container.members()` review it with the forward negation closure
applied (H1) and FAIL CLOSED on any unresolvable dependency (H9); `Gateway.freeze(term)` mints an
order-free content address over a member set (`ModuleVersion`); the container table is re-resolved live
from the ground, so a knob change is a delta and never a restart; and only lawful operator-signed
declarations bind, so a federated stranger's slate moves nothing. Every one of those is a thing this
design would otherwise have had to invent.

**Correction 1 — the slogan needs one word of precision: `drop()` is the LAST ACT of the cut, never the
cut.** The ticket body already says this ("the container's destruction is the commit point"); the title
compresses it in a way an implementer could get badly wrong. A property container holds no bytes of its
own, so T32's `drop()` on one is *striking its declaration* — deliberately non-destructive, because
purging shared ground when a scope is dissolved would be catastrophic. So the cut is its own verb
(`cut(slate)`), and dropping the container is its final step.

**Correction 2 — and this one must be refused by construction: a slate is a PROPERTY container, and a
wall-posture slate is refused at the door.** A wall pays real byte copies. A wall-posture slate would
therefore hold a *second copy* of every condemned delta, and T32's `drop()` on a wall does purge +
byte-verify — so dropping it would report a byte-verified clean discard while every canonical original
still sat in the primary. That is hazard **H7** wearing a container: an operation reporting a success it
did not achieve, on the one surface where the report is a legal claim. A wall-posture slate is also
self-blocking (§27.7's guard refuses every `erase` while a declared wall is unattached, and the slate
would be that wall) and it is exactly the "slate becomes the hiding place" recursion §24.8 warns about —
a byte inside the operator's own walls that the fan-out does not reach. All three problems vanish at
`posture: "property"`, where the slate holds no bytes, cannot hide any, and is invisible to the
wall guard by construction. So the posture is not a preference; it is load-bearing, and the door says so.

**Correction 3 — "a closure is a set subtraction" is true of the SET and false of the machinery, and every
door pays a different price for it.** The tidy version of this design says each closure narrows an operand
set: resolve against `snapshot ∖ closed`. Read cold against the code, that sentence is only true where a
door actually holds an operand set, and the three closures fail it in three different ways. **`read`** has
five sites and the default one — a warm materialization for a registered root — is maintained incrementally
from ingest events and cannot be subtracted from at all; worse, the single choke point that would fix that
in one line (`selectImpl`) is shared with the membership machinery, so pushing the narrowing down there
makes a read-closed slate fail its own re-freeze check and become permanently uncuttable. **`egress`**
subtracts from a set that `withNegationClosure` deliberately ENLARGED, so a naive subtraction re-opens the
exact leak that closure exists to seal. **`cite`** matches pointers by shape, and one pointer in this store
is a delta reference encoded as a primitive string, so a shape-correct predicate is silently blind to the
one operation that re-speaks condemned content under a new id.

None of the three is a hard problem once named; all three are invisible from inside the slogan. So the
sections below say, per closure, WHERE the predicate lives, which sites call it, and — the part the slogan
cannot express — which sites must be left UNNARROWED on purpose.

## 29.1 A slate is two deltas, and neither is a new primitive

**A slate is a property container declaration PLUS one record that says it is a slate.** The container
carries the membership; the record carries everything erasure needs and containment does not — who
asked, when, the deadline, and which doors honour it.

- **`loam.container`** (unchanged, T32's mint): `container` → the slate entity, `trust: "curated"`,
  `posture: "property"`, `membershipAt` → the content address of a published Term, `version` → the
  ModuleVersion address over the frozen members. No new roles, no widened knob vector.
- **`loam.erasure.slate`** (NEW — one context): `slate` → the container entity (`loam.container`), plus
  `requested-by`, `requested-at`, `deadline`, repeated `closes`, and an optional `reason`.

**The join is a POINTER, never a name convention.** A container named `container:slate:…` is a comment;
nothing can verify it, and a prefix that code parses becomes law by accident (the H6 register — a name
is not a program). What makes a container a slate is a surviving lawful record pointing at it, so the
door predicate and the readers ask the record, and the naming convention stays advice.

**Why the closure lattice lives on the slate record and not in `loam.container`'s knob vector.** The
ticket observes that "which doors honour this membership" is probably what container policy IS in
general, and that is likely true — but T32 deliberately kept `seeding` and `boundary` off the at-rest
mint because "neither gets a role until a consumer fixes its shape," and today exactly one consumer
fixes this shape. Widening the general primitive for one preset is how a vocabulary acquires roles
nothing reads. When a second consumer arrives, the generalization is a lift with a migration path
already proven (T32 lifted the quarantine the same way). Recorded as the named next step, not built.

**The trust knob is `curated`, and the door enforces it with the posture.** The condemned deltas are the
operator's own ground; `untrusted` is refused with `property` anyway (§28.3). A slate record pointing at
a container that is not curated/property is refused, naming both.

## 29.2 Frozen by ENFORCEMENT, not by promise

The design's central claim is that the impact list is true because the set *cannot grow* after
identification — not because someone observed it carefully. A live membership Term would defeat this
completely: `author = X` keeps admitting deltas as they arrive, so the list drifts and under-reports
silently, which is the dry-run failure (H8) re-entering through the front door.

**So a slate's membership is an EXTENSIONAL id set, and the door proves it.** Identification evaluates
whatever Term the operator likes, once; `freeze()` mints its address; the frozen ids become a
`match{field: id, cmp: inSet}` Term (§27.6 lists this as expressible today); that Term is published by
`termClaims` and cited by `membershipAt`; and the ModuleVersion address goes in `version`.

The door then checks **agreement**: evaluate the Term at `membershipAt`, freeze the result, and refuse
unless it equals `version`. That check is what turns "frozen" from a convention into an invariant — a
declaration whose membership could still move is refused rather than trusted.

Two dividends fall out for free. The graveyard's frozen membership (which the ticket requires) is
already minted — it is the `version` address. And the door predicate needs **no scan**: the condemned
ids are literally the values in the published Term's JSON, so `readSlates` reads them out rather than
evaluating over the snapshot. A slated-id lookup is then a `Set.has` — the same cost class as the
`readTombstones` check that already runs at both doors (H8's affordance question, answered).

## 29.3 The lattice — which doors honour a slate

Reading is a kind of dependency, so the three closures are one axis at different depths. A slate names a
subset of:

- **`egress`** — the offer / federation-out door. The HOLDER set cannot grow. This is what makes the
  impact list true rather than hopeful.
- **`cite`** — the append door and the federation-in door. The DEPENDENT set cannot grow, so no new
  orphans exist at cut time.
- **`read`** — every reading door (entity/GraphQL, byte, public, **as-of**, a **pinned** older lens, and
  a **live subscription**). The data is already effectively gone; the bytes are a formality. This is the
  closure with the most sites and the least obvious ones, which is why it gets the longest treatment below.

**`closes` is REQUIRED with no silent default, and `none` is sayable.** This follows T32's posture
precedent exactly: the recommendation lives in the refusal, never in silent semantics. The refusal names
`egress,cite` as the recommendation — the minimum that makes both the impact list and the orphan set
true at cut time — and `read` as the tightening a lapsed deadline forces (§29.4). An honest
announcement-only slate says `closes: none` explicitly, and that is a legitimate legal posture: same
machinery, grace period instead of a near-erasure.

`closes` is latest-wins like every mutable knob, so tightening during the window is a delta. The
asymmetry is stated rather than discovered: **tightening is real, loosening cannot un-disclose.** A
re-widened slate has not recalled what a door already served.

**ONE predicate, and the doors differ only in DISCLOSURE.** The cite check has two admission sites, and
all seven findings of 2026-07-21 were one-rule-N-sites-one-drifts with the federation site as the one
that drifted. So a single `slateRefusal(slates, delta)` is called from `appendImpl` and `federateImpl`.
At the **append** door the refusal is informative and names the container: the only parties who can
trigger it are parties who could already read the target, so telling them IS the notice — the mechanism
and the warning are the same thing. At the **federation-in** door that reasoning fails (a peer pushing a
citation may have no read access to the target, and a distinguishable refusal would announce that
something exists and is leaving), so it takes the uniform-refusal discipline — which costs nothing,
because `federateImpl` already returns counts and no message.

**Cite is DIRECT only, deliberately.** A direct pointer check is a Set lookup at admission; transitive
closure is the unbounded scan H8 exists to warn about. A delta citing a delta that cites a member is
admitted, and the rail says so, so the line is a decision rather than an accident.

**But "direct" means NAMES A MEMBER, not `target.kind === "delta"`.** The natural shape for the predicate
is `eraseImpl`'s citations manifest, which filters `p.target.kind === "delta"` — and there is at least one
pointer in this store that is a delta reference in everything but encoding. The adoption record's link
back to what it promoted is `{role: "source-delta", target: {kind: "primitive", value: sourceDelta}}` — a
plain string. A cite predicate that only reads delta-refs therefore **admits a promotion during the
window**, and `promoteImpl` re-signs the source's pointers under the operator, so the ground gains a
fresh operator-authored copy of the condemned content, under a new id, outside the frozen `version`, on
the operator's own say-so, while the slate stands. The cut never touches it and no door ever closes on it.

So the predicate matches a pointer that names a member **either as a delta-ref or through an enumerated
primitive role that is a delta reference by convention**, and that list is CLOSED here, in the spec, so a
future role of the same shape is a spec change rather than a silent hole. Today the list is exactly one:
`source-delta` on `loam.adoption`. `translates` is already a delta-ref and needs nothing. Fixing this by
changing the adoption record's bytes would be a §20 migration for one role, and the predicate widening
buys the same window property for nothing — so the widening is the choice, and the record's odd encoding
is named in a rail so the next reader knows the list is load-bearing rather than decorative.

**A copy made BEFORE the slate is outside its reach, and the review is where that gets said.** Erasure is
by ID; a content-addressed store cannot chase content, and §11 has never promised to. A promotion or a
translation that landed before identification is a surviving operator-authored copy the cut leaves
standing, and no widening of any predicate changes that — it must be slated by its own id. The two-phase
shape is the one moment a review could surface it, and it already surfaces `resurfacing` and `affected`,
so the slate report gains a **`duplicates`** set: per member, the operator-authored records that link to
it by a link the store can follow (a `translates` or other delta-ref, plus the enumerated primitive
roles). It is an honest partial — it finds links, never content — and it says so where it is printed.

**And the post-cut resubmission is INTENDED.** Admission today refuses a delta whose own id is dead
(`ingest.ts`, `dead.has(d.id)`) and does not inspect pointers, so a citation refused during the window
can be resubmitted after the cut and lands as a dangling reference. That is correct and must stay:
`eraseImpl`'s `citations` manifest exists precisely because surviving deltas legitimately cite erased
ids (negations, provenance links), so a permanent pointer-level refusal would break negation and
provenance both. Cite-closure is a WINDOW property about the orphan set at cut time, never a promise of
referential integrity a grow-only union cannot make anyway.

**Egress closure's withheld set is NEGATION-CLOSED, and that is H1 read from the other side.**
`offeredDeltasImpl` returns the lens result plus `withNegationClosure` precisely because offering a
claim while withholding its retraction republishes something the operator struck (the T38 fix). Egress
closure subtracts from that same set — so a naive subtraction of a slated NEGATION leaves its target
offered and hands the peer a live reading of a retracted claim. The invariant `withNegationClosure`
maintains is *if I offer `d`, I offer everything that negates `d`*; its contrapositive is *if I withhold
`n`, and `n` negates `d`, I withhold `d`*. Those are one rule, and the withheld set must satisfy it.
**So the subtraction is `slated ∪ {targets of slated negations, transitively}`** — transitive for the
same reason the forward closure is (a struck strike revives, so carrying one link would leave a revived
claim wrongly offered), and terminating for the same reason (the set only grows, bounded by the
snapshot, and content addressing forbids a cycle).

This costs the tidy slogan that egress closure "pre-represents the post-cut world," and the trade is
worth naming. It does not: after the cut the target REVIVES and the peer would see it, whereas during
the window the peer sees neither. The operative promise was never mirror-imaging the future — it is
**the holder set cannot grow**, and over-withholding is the only direction that cannot disclose. The
decisive asymmetry is §29.8's: un-slating is FREE, so a naive subtraction would let an
announce-then-withdraw window permanently publish a revived claim to every peer that pulled, and
loosening cannot un-disclose. A revocable act must not have an irrevocable effect. So the offer
UNDER-represents the post-cut world for exactly the resurfacing set, the slate report says so beside
that set, and the peer converges at the cut rather than during the window.

**One subtraction, in `offeredDeltasImpl`, and the second caller inherits it.** `openWall`'s reseed
seeds a container from `gw.offeredDeltas()`, so a wall attached DURING the window would otherwise be
born holding a condemned delta — and, under a naive subtraction, holding a target without its strike
inside the operator's own replica. Putting the subtraction in `offeredDeltasImpl` closes both doors from
one site and is the right place on the merits: a wall that never receives a condemned delta is one
fewer copy for the cut to sweep, which is §24.8's recursion warning answered rather than restated. The
subtraction is deliberately NOT in `selectImpl` — see the read-closure discipline below for why that
matters.

**The resurfacing set is the affordance, not a footnote.** If a member is a NEGATION, cutting it REVIVES
its target (§11's own consequence). So the slate report lists the **resurfacing** set — the targets of
slated negations — at review time, and it is the same set the egress subtraction withholds. This is a
genuine new value of the two-phase shape: the operator sees which claims will come back to life *before*
the cut, which no single-act erasure could ever show them.

**Read closure never closes the operator's REVIEW read.** The operator is the controller and must be
able to examine what they are about to destroy; a read-closed slate that could not be reviewed would
defeat itself. So read-closure applies at the doors, and `containerScope` over the slate plus the slate
report remain the operator's, explicitly.

**Read closure is a GATHER-level narrowing, not a store-level one — and `read` gets the same
one-predicate-N-sites discipline `cite` gets, because it has more sites, not fewer.** The section above
spends its care on `cite`'s TWO admission sites. `read` has five, one of them the default path for every
registered root, and the naive reading of "resolve against `snapshot ∖ readClosed`" covers exactly the
sites nobody was going to forget. The narrowing lives in **one helper — `readGround(gw, now)`, returning
`snapshot ∖ readClosed` — and every gather that answers a READ door calls it.** The sites, named so a
sixth cannot arrive quietly:

- **`gatherImpl`'s cold branch** (`reactor.eval`) — the substitution is direct: evaluate the same body
  over `readGround` instead. This is the as-of path's own move ("same gather, a narrower ground").
- **`gatherImpl`'s WARM branch** — and this is the site that defeats the naive reading outright. It
  returns `reactor.materializedView(...)` BEFORE touching any snapshot. A materialization is maintained
  incrementally from ingest events; it is not an operand set anything can subtract from, so a read-closed
  member keeps being served through the default path for every registered root. **So a read-closing slate
  DEMOTES the warm path: while `readGround` differs from the snapshot, the gather ignores the
  materialization and takes the cold branch over the narrowed ground.** Correct by construction, one
  predicate, one place; the cost is that reads lose their warm path for the life of the slate, which is a
  bounded and visible price a compliance window can pay. A re-seat is NOT the fix and must not be
  mistaken for one: `reseat()` replays the backend into a fresh reactor, so the rebuilt materialization
  holds the members again.
- **`watchEntityImpl`'s `resolveCaptured`** — a stream resolves off its captured materialization, so
  every already-open subscription keeps pushing patches computed from a set nothing narrowed. Here the
  materialization keeps its real job and loses the other one: **the mat is the TRIGGER; `readGround` is
  the RESOLUTION.** A superset trigger is safe (a change to a read-closed member fires, the narrowed
  re-resolve yields the same hex, and the existing `node.hex === lastHex` check swallows it as silence
  rather than a no-op patch); a subset trigger would not be, which is what the file's "trigger and
  resolution must agree" note is about — it warns against a NARROWER trigger, not a wider one.
- **A stream open BEFORE the slate lands re-resolves, or it serves the member forever.** Nothing in the
  slate's own deltas touches the watched entity's materialization, so the sink never fires and the
  narrowing never takes effect. `reseat()` already solves precisely this one phase later — "a parked
  reader must not keep serving a view built on the pre-erase ground" — so a landing slate that closes
  `read` (or a `closes` tightening that adds it) ends live subscriptions the way an erase does. Readers
  wake with `done` and resubscribe into the narrowed gather. Already-delivered frames are not recalled;
  nothing can recall them, and §29.3's asymmetry already says so.
- **`resolvePinnedImpl`'s live branch** (`reactor.eval`) — an old lens over today's ground is still a
  read door. Same substitution.

**As-of is the site that would have been missed**: §26 reconstructs the surviving ground at a moment T,
and a moment before the slate would happily serve the condemned delta — so the narrowing is applied
AFTER the as-of reconstruction, and the temporal door confesses a slate-suppression count in the same
register `forgottenSince` already uses. The byte door rides the same re-resolved view (§23.7), so it
inherits the narrowing and serves the same uniform 404 it already serves for an erased source. Because
the removal is of a delta together with its effect, the H1 direction is preserved (the forward closure
`containerScope` already runs is the model).

**And the narrowing is REFUSED entry to the ground-reading primitives, by name.** The tempting single
choke point — `selectImpl` — is the one place it must never go, and the failure is not a leak but a
DEADLOCK. `containerScope` and `Container.members()` call `gw.select`; so does `Gateway.freeze`; so does
§29.2's own enforcement check. A read-closed slate evaluating its own membership Term over a narrowed
snapshot freezes to a different address than `version`, so the slate self-invalidates, and §29.5's
pre-flight then refuses the cut at exactly the moment the deadline passes: a stuck store, permanent
suppression, and no cut possible — the worst outcome this design can produce, arrived at through its
tidiest refactor. So: **`select`, `containerScope`, `Container.members`, `Gateway.freeze`, the §29.2
re-freeze, and the operator's review read all evaluate over the UNNARROWED ground, and that is stated
here as an invariant rather than left to the accident of where the code happens to sit.** Read closure is
a property of DOORS. The primitives that compute membership are not doors.

## 29.4 The window, the deadline, and the lapse computed AT THE DOOR

A slate carries a **required** `deadline`. A compliance clock runs from the request, and a default here
would be the worst of the options — a legal deadline chosen silently by a library.

**Nothing in Loam runs a timer, and the design must not pretend one exists.** So the lapse is a READ-TIME
verdict: the slate reader takes an explicit moment (`readSlates(reactor, operator, now)`), and a slate
whose `deadline` is past resolves with `read` added to its closure set. This fails SAFE — a store that
was down for a week wakes with read already closed — needs no scheduler, and gives the rails a
deterministic seam (an explicit `now`, never a wall-clock race; the flaky-test rule).

**The `now` is plumbed to every read door, and a door that omits it REFUSES rather than serving.** A
lapse computed at the door means every door that honours `read` needs the moment, and the failure mode of
an omitted parameter is the dangerous one: an optional `now` defaulting to anything at all serves the
member and looks healthy. So the moment is REQUIRED on the internal read seam — a door reached without it
is a programming error that fails closed and loudly, never a read that quietly ignores a lapsed deadline.
This is the same shape as `readGround`'s single site: one predicate, and the plumbing is what makes it
one.

**NAME THE CLOCK, because there are two.** `nextTimestamp()` is `max(Date.now(), last + 1)`, so
delta-time is monotonic and may run AHEAD of wall-clock under load. A deadline minted in one clock and
compared against the other is a bug that only appears on a busy store. So: **`deadline`, `requested-at`,
and the `now` a door is passed are WALL-CLOCK milliseconds** — one clock, the caller's, comparable — while
a delta's own `timestamp` is DELTA-TIME and is never compared against a deadline. `requested-at` is the
compliance clock's start and is distinct from the delta's timestamp, which records when the operator got
round to filing it; the gap between them is auditable, which is the point, and a reader of that gap is
told it may be inflated by delta-time drift rather than by an operator's delay.

**The seal's salt lives OUTSIDE the ground, or it is not a seal.** `sealCommitment(salt, subject)` is
revealable only if the salt survives; a salt stored in the store it protects is a legible preimage sitting
next to its own hash, and a salt nobody kept is a commitment that can never be honoured — a permanent
record naming nobody. So the salt is operator-held key material, kept where the operator keeps the signing
seed, and the receipt names WHICH form `requested-by` took so a reader is never guessing. If sealing ever
becomes the default (question 2 below), that salt becomes the entire audit trail of who asked, and its
custody stops being an implementation note.

**`requested-by` may be a §11 SEAL rather than a name.** The graveyard is permanent, and a subject's
identity is often exactly what they asked to have forgotten, so §11's rung-3 tool is pointed at the
request record: `requested-by` is either a plain identifier or a `sealCommitment(salt, subject)` — the
operator reveals the preimage if they must ever prove who asked. No new cryptography, and the receipt
names which form was used so a reader is never guessing. **(Myk)** whether sealing should be the
recommended default for subject requests.

**Health reports the clock in its OWN section, and a lapsed slate does NOT move `status`.** The tempting
version of this — report `settling` while any slate is lapsed, "debt outstanding, converging, not broken" —
would route a compliance clock through the exact field §11's byte debt uses. Those are different facts
with different remedies: `settling` means a promise already MADE has not reached the bytes yet, and the
operator's job is to wait or to repair a tier; a lapsed slate means a promise has not been KEPT, and the
operator's job is to cut. Conflating them teaches whoever watches `status` that `settling` sometimes just
means someone filed a slate, and that is how a field earns the right to be ignored — the same
overclaiming-instrument failure T49 paid for one layer down.

So `health()` gains a distinct **`slates`** section — `open`, `lapsed`, and the lapsed slates' ids — and
`status` keeps meaning exactly what it means today. An operator watching a compliance window watches
`health().slates`; an operator watching byte debt watches `health().erasure`. It also gains **`forgiven`**
(§29.8): ids in some graveyard's frozen `version` whose tombstone no longer survives, and how many of
those are PRESENT in the ground again. That count is lawful, not debt, so it does not move `status`
either — but without it a forgiven-and-returned id is invisible to every instrument the store has,
because striking a tombstone removes the id from `readTombstones` and therefore from `promised` entirely.

## 29.5 The cut

**The pre-flight is ALL-OR-REFUSE; the per-member work is per-member with a fault report.** Atomicity is
claimed only where it is real. `blessAll`-style all-or-refuse is impossible honestly here: erasure is not
transactional across tiers, and a mirror going down mid-cut is a physical state, not a bug. So:

1. **Pre-flight, before any tombstone — and the refusals are ENUMERATED, because an unenumerated one is
   what a cut discovers halfway through.** Refuse if the slate's membership does not resolve (a dangling
   `membershipAt` — H9, fail closed: if we cannot read which ids are condemned we cannot cut); if the
   slate record does not resolve lawfully; if the §27.7 wall guard reports a fault (an unreachable wall
   could hold a member outside the sweep); if a **`kept` wall may hold a member** (below); or if the
   **membership no longer re-freezes to `version`** and the disagreement is not fully accounted for
   (below). Nothing half-done, no tombstone standing over an unreported gap — the discipline `eraseImpl`
   already keeps.

   **Re-freeze agreement is a pre-flight refusal, and its ONE lawful exception is named rather than
   discovered.** §29.2's door check proves agreement at declaration time; the cut must prove it again,
   because the window is exactly where the ground moves. The move that matters is mundane: an operator
   `erase()`s one member by hand mid-window. The frozen ids are read out of the published Term's JSON
   (§29.2 — no scan), so the id set survives; but EVALUATING that Term now yields a smaller dset, so the
   re-freeze disagrees, and without this rule the cut walks into `eraseImpl`'s `nothing to erase` throw,
   which step 4 correctly treats as a fault — leaving a slate that STANDS, doors closed, deadline
   lapsing, `read` closing forever, and **no repair, because nothing can un-erase**. A permanently
   uncuttable slate is the same stuck store the read-closure discipline exists to avoid, reached from the
   other direction. Refusing without an exception does not help; it only detects the jam.

   So the exception: **a member missing from the re-evaluation is accounted for iff it carries a surviving
   lawful tombstone.** Those members are not faults and not re-erased — they land in the cut's
   **`prior-tombstone`** list, paired with the tombstone id that already covers them, and (if bytes are
   still outstanding on some tier) they still take step 3, where §11's anchor reuses that same tombstone.
   A member missing with NO tombstone is a fault: refuse and name the id. That is the fail-closed leg, and
   it should be unreachable today — which is exactly why it is written down.

   **A `kept` wall that may hold a member is a refusal, not a footnote — this is Correction 2's hole
   closed.** `unreachableWallReport` returns a wall as a FAULT only while it is neither attached nor
   covered; a wall with a surviving detach record lands in `kept` with `faults` empty. And the documented
   remedy for a blocked ordinary erase is `eraseImpl`'s own refusal text — "Attach the container(s), or
   detach() them onto the record, then re-run" — so **the sanctioned unblocking move converts a fault into
   a footnote**, and the cut then runs, reaches the attached pools only, and produces a per-member table
   of `holds: false` verdicts beside a `kept` list while two members sit legible on a shelf. That is H7 in
   the one artifact whose entire purpose is not being H7, and Correction 2 refuses wall-posture slates for
   precisely this reason before leaving the identical hole open for every other wall.

   The intersection is COMPUTABLE without attaching anything: the frozen id set is in hand, and the wall's
   at-rest membership Term is in the container table, so `select` over the primary's ground gives what the
   wall was seeded to admit. So: **a `kept` wall whose admit-set intersects the condemned set refuses the
   cut, naming the wall and the intersecting ids.** A `kept` wall with NO at-rest membership Term refuses
   too — an uncomputable intersection cannot be excluded, and H9's direction is to fail closed rather than
   to assume empty. Both refusals are repairable, which is the test N3 taught: attach the wall
   (`openContainer`) and re-run, or narrow the slate to exclude those ids (un-slating is free, §29.8).

   **And when the wall genuinely cannot be reached, incompleteness becomes a SIGNED DECLARATION rather
   than a discovered footnote.** A wall whose store is gone would otherwise jam a legitimate cut forever,
   so the slate record may carry repeated **`accepts-incomplete`** pointers naming the kept walls the
   operator knowingly cuts around. With one in force the cut proceeds, and everything downstream tells the
   truth: those members' per-tier verdicts read **UNPROVEN**, never `holds: false`; the wall is in `kept`;
   and the receipt's non-claim section names it. The operator can always cut. The operator cannot cut
   SILENTLY over a wall that may hold members — the difference between an incomplete erasure and a false
   claim of a complete one is a signature, and now it is one.
2. **The affected set and the resurfacing set are computed HERE, immediately before any purge.** After
   the purge the members are gone and every intersection reads empty — the ticket's frozen-membership
   lesson applying a second time, one layer up.
3. **Per member, the ordinary erase.** The cut mints no new fan-out: it calls §11's, so tombstone +
   purge + attached-pool/wall fan-out + the byte verdict (`holds`, never a purge count) all come from
   `eraseImpl` unchanged. Each tombstone carries one new optional `slate` pointer (§29.6).
4. **Any fault: throw, and the slate STANDS.** No graveyard lands, the declaration survives, and every
   closed door stays closed — so a partially-cut slate is still slated, still reviewable, and RESUMABLE.
   This is T32's `drop refused: … the pool remains ATTACHED` discipline: a thing that cannot prove it
   completed does not slip out of reach. A re-run mints no second tombstone (§11's anchor).
5. **The graveyard lands, THEN the declaration is struck.** Order is load-bearing: strike first and a
   crash loses the record, because the struck declaration no longer resolves the set. A crash between
   the two leaves a graveyard beside a standing slate whose members are all tombstoned — so the re-run
   finds nothing outstanding and simply strikes, landing exactly one graveyard. Idempotent by
   construction.

`cut()` returns a **CutReport**: per member the id, its tombstone id, `spoken-by`, the byte verdict per
tier and pool, and §11's **citations manifest** for that member (`eraseImpl` already computes and returns
it, so this is collection rather than machinery — and it is what tells a later reader which surviving
deltas dangle at the hole); plus `prior-tombstone`, the tiers deliberately NOT reached (a `kept` wall, and
the `accepts-incomplete` declaration that permitted it), the affected set, the resurfacing set, the
`duplicates` set, the window, and the graveyard's id.

**The per-tier byte verdict is a TRI-STATE, and `unproven` is not a synonym for `false`.** A tier that
refused, a tier that threw, and a `kept` wall are all "we did not prove these bytes are gone" — which is
the opposite of "we proved they are gone," and a boolean cannot hold the difference. `health()` already
carries `unproven` for exactly this reason (a backend whose probe throws makes the whole set unproven
rather than settled); the CutReport uses the same word for the same fact. Collapsing the third state into
`false` is how a report of work not done reads as a report of work completed.

## 29.6 The graveyard

The record that survives the cut is the erasure EVENT, not a second copy of the per-id law.

**One delta at `loam.erasure.graveyard`**, citing: the slate entity, the slate record's id (the request
provenance — who asked, when, why, the deadline), the `version` address (the frozen condemned set), the
window (opened, cut at), the closure set in force, the affected set, and the **`prior-tombstone`** pairs
(§29.5 — member id ↦ the tombstone that already covered it). It holds content addresses, and retaining a
hash retains zero content — §11's own founding argument, reused.

**It CITES tombstones; it does not replace them.** `readTombstones` is load-bearing at every door and
must remain the single per-id law — two records of one fact is the exact failure pattern of 2026-07-21.
So the graveyard does not list the tombstones at all: **each tombstone minted by a cut carries a `slate`
pointer**, and "which tombstones belong to this graveyard" is a join. That keeps the graveyard one small
delta regardless of whether the cut had four members or forty thousand, and it buys the arithmetic the
receipt is made of:

> Every member of the frozen `version` has a surviving tombstone, and that tombstone either cites this
> slate or is named for that member in the graveyard's `prior-tombstone` list.

That is checkable at any later date from durable ground alone, with no observation of the tiers and no
memory of the cut. It is the difference between a narrative and a proof.

**The clause after the comma is not a weakening; without it the proof is FALSE on cuts that succeeded.**
Two ordinary histories produce a member whose tombstone cannot cite this slate. An operator erases one
member by hand mid-window (§29.5's re-freeze exception). Or a cut faults, the operator repairs the tier,
and the re-run anchors on the tombstone the first attempt already minted — a tombstone minted before the
`slate` pointer had a value to carry, and content addressing forbids adding a pointer to an existing delta
(H4). In both, the simpler arithmetic computes FALSE on a cut that completed correctly, which is
indistinguishable from a cut that never finished — and a proof that cannot tell success from abandonment
proves nothing. The exception is therefore ENUMERATED in the graveyard rather than inferred at check time:
a checker reads a closed list of durable pairs, not a heuristic about which tombstones look old.

**A `forgiven` member does not falsify it either, because the arithmetic is about tombstones that
SURVIVE.** §29.8 makes forgiveness a tombstone strike, and a struck tombstone stops surviving — so the
first lawful forgiveness after a cut would flip this to FALSE, again indistinguishable from an incomplete
cut. So the sentence is read against the ground AT A NAMED MOMENT, and a member whose tombstone has been
struck is reported as **forgiven with its strike id**, not as a missing tombstone. The graveyard records an
event that happened; forgiveness is a later event, and the check reports both rather than subtracting one
from the other.

**No §20 migration step.** The `slate` role is added to NEWLY minted tombstones only; no delta any store
already holds changes bytes or roles, so §20 is not engaged (the same reasoning T32's mint recorded, and
it is proven the same way — a pre-mint fixture opens with identical ids and views). `eraseDefect` keeps
accepting a tombstone with no `slate` pointer forever, and validates the shape when one is present.

## 29.7 The receipt — what is needed NOW and what is deferred

A product review named a signed compliance receipt (erase + a byte-level sweep of every tier, signed) as
the sellable object of the GDPR story, and noted T64 as "a promise change to make when a real DPO asks."
Being honest about that line is part of this design.

**The receipt is an exported, operator-signed DOCUMENT, not a delta.** A receipt asserts something about
the WORLD AT A MOMENT ("no tier held these bytes at 12:03"), and a byte probe is not a function of the
ground — it is an observation of the tiers. Putting an observation into the ground is precisely the
dry-run mistake this whole design rejects: it goes stale, it cannot be re-derived, and a restored backup
would make a permanent delta into a permanent lie (H8 — an index of data location fails open). What
lands in the ground is the graveyard (durable, verifiable, re-derivable). What is exported is the
receipt: derived from the graveyard + the tombstones + the frozen version, plus a LIVE probe at the
moment of issue, **re-issuable at any time** — and re-issuing is exactly §11's testable-compliance
promise ("ask that store for the id and see what returns").

Its contents: the request provenance (with the `requested-by` form named), the window and the closures
in force, the frozen version address and member count, per member the tombstone id + `spoken-by` + the
live per-tier byte verdict, `prior-tombstone`, the tiers deliberately not swept, the graveyard id, and an
explicit **non-claim** section — peers are not reached, pre-request copies are not recalled, a copy
promoted or translated under a DIFFERENT id before the slate was never in the frozen set and still stands
(§29.3's `duplicates`), the surviving deltas that cite each erased id (§11's citations manifest — pointers
are not content), a `kept` wall the operator declared `accepts-incomplete` over, and the standing fact that
a restored backup can resurface bytes and this document is re-issuable to prove present state.

**Two kinds of field, and the receipt must not mix them.** A history field — the window, the frozen
version, the graveyable provenance, the tombstone ids, `prior-tombstone` — is a fact about what happened,
and the CutReport is a perfectly good source for it forever. A **per-tier byte verdict is an observation of
the tiers at 12:03** and may never be read from a CutReport later: a formatter that reprints last month's
snapshot as today's receipt is the whole dry-run mistake this design rejects, wearing a letterhead. So the
byte verdicts are marked in the CutReport as **non-authoritative for re-issue** and every re-issue
RE-PROBES. The rail for this is not a code inspection: resurface a byte after the cut and the re-derived
verdict must FLIP while the CutReport's copy does not.

**And a re-issued receipt reports three live facts per member, because "forgiven" alone is the wrong
sentence.** Per-member verdicts read the LIVE state: the tombstone (surviving, or struck with its strike
id), the per-tier byte verdict (re-probed, tri-state), and **whether the id is PRESENT in the ground
again** — one `get(id)` answers it. That third fact is the one the obvious design loses. Striking a
tombstone permits the id's return, and `federateImpl` then admits it from a peer because it is no longer
dead; a receipt that says only FORGIVEN is technically true and communicates the opposite of what happened,
because the reader wants to know whether the data is there. "Forgiven at `<strike id>`, and present again
as of `<issue time>`" is the sentence, and a document that could not say it would be the H7 shape in the
one artifact whose entire purpose is not being that.

**Nothing durable records that a receipt was ISSUED — and that gap has consequences. (Myk)** The graveyard
records the CUT, not the issuance, so after a restore-from-backup resurfaces bytes no process can know
which receipts exist to re-issue or invalidate. `healthImpl` WOULD notice the byte debt, but nothing
connects it to an issued document, and `/health` is operator-only — so the DPO's artifact and the store's
live verdict never meet. The recommendation is a **`loam.erasure.receipt` delta over the DOCUMENT's content
address**: a hash retains zero content (§11's founding argument, a third time), it is not an observation and
so cannot go stale, and it makes outstanding receipts ENUMERABLE — which is exactly what turns "a backup was
restored" into a list of parties owed a re-issue. Marked **(Myk)** because it adds a permanent record of a
compliance act, which is a promise change rather than a repair.

**The needed-now / deferred line, drawn on one principle: the DATA can never be reconstructed later; the
DOCUMENT can wait.**

- **Now** — the slate record and the enforced-frozen membership; the property-posture refusal; the two-door
  cite predicate with its asymmetric disclosure and its enumerated primitive roles; `readGround` and the
  named read sites; the negation-closed egress subtraction; the deadline, the plumbed `now`, and the
  door-computed lapse; the cut's enumerated pre-flight refusals, order, resumability, and pre-purge
  computation of the affected/resurfacing/`duplicates` sets; the graveyard with its `prior-tombstone`
  list; the tombstone `slate` join; and a **structured CutReport carrying every field the receipt needs**,
  with its byte verdicts tri-state and marked non-authoritative for re-issue.
- **Deferred** — the signed receipt document, its serialization, and its CLI/HTTP surface. If the cut's
  report is complete, the receipt is a formatter. If it is not, no later work can reconstruct it.

## 29.8 Forgiveness, both sides of the cut

- **Before the cut, un-slating is FREE.** Strike the container declaration: the table is re-resolved
  live, so every closed door reopens on the next read, and not one byte moved. Narrowing a slate is a
  re-declaration with a re-frozen membership (so `version` and `membershipAt` keep agreeing).
- **The request record stands unless it too is struck.** Someone asked; that is a fact, and §11 already
  holds that the store remembers who asked. Withdrawing the *slate* and withdrawing the *request* are
  two acts over two deltas, no new vocabulary.
- **After the cut, forgiveness is §11's tombstone-strike, per id, and it does NOT un-purge.** Striking a
  tombstone permits the id's return; it cannot restore bytes nobody holds. The graveyard survives a
  post-cut forgiveness untouched — it records an event that happened, not a standing assertion about the
  present — and the receipt's live verdicts are where the present is answered (§29.7).
- **A forgiven id can COME BACK, and the store must be able to see that it did.** The strike removes the id
  from `readTombstones`, so it leaves `health().erasure.promised` entirely and the store reads `ok` — and
  `federateImpl` will now admit the id from a peer, because it is no longer dead. That is all lawful and all
  invisible, which is the problem: the one durable list of ids the store ever promised to forget is the
  graveyard's frozen `version`, and it is the only place a forgiven-and-returned id can be found. Hence
  §29.4's `forgiven` count — read from the graveyards, not from the tombstones — and §29.7's present-again
  fact per member.

**Slates inside the operator's OWN replicas: the declaration crosses the edge, the enforcement does not,
and that is a decision.** Walls and pools share the operator's seed, so a slate's declaration, its record,
and its membership Term all cross the seeding edge as ordinary data and resolve inside a pool as lawful
operator-signed deltas. Nothing inside the pool enforces them, and nothing should: a pool is the operator's
dry-run surface, not a door served to anyone, so read closure inside it would suppress the very content the
operator opened the pool to examine — the same reasoning that keeps the operator's review read unnarrowed
(§29.3). What DOES cross is the byte question, and that is handled where it belongs: egress closure keeps
condemned deltas from being seeded into a wall in the first place (§29.3), the §27.7 guard and §29.5's
`kept`-wall refusal keep an unreachable one from being cut around silently, and §11's fan-out reaches every
attached pool. The rails test the primary's doors deliberately; a pool has none.

## 29.9 What we cannot do, said plainly

**We are not responsible for federation** (Myk, 2026-07-21). Erasure does not reach peers: they are not
the operator's replicas, a peer refuses a foreign operator's removal-order at the door, and this design
does not imply a reach it does not have. Egress closure stops FURTHER spread from this store during the
window; it recalls nothing already pulled. And there is **no notification transport in Loam**, so the
notice is a READ, not a push: the append door's informative refusal (for parties writing in) plus a
slate listing the operator may expose (for tenants reading). Consequently the graveyard records the
**AFFECTED SET** — the containers whose scope intersected the condemned set at cut time — and never
"who was notified," because the store cannot know a message was received. That is a deliberate
correction to the ticket's phrasing: it is the strongest claim the store can actually make.

## 29.10 The ticket's open questions, answered

- **Q1 — the window bound.** Per-slate `deadline`, REQUIRED, no default; a lapsed slate closes `read`
  computed at the door (§29.4). The **store-level maximum is DEFERRED**, and deliberately: it is the one
  number a model should not pick, and this is precisely the promise change to make when a real DPO names
  a figure. **(Myk)** — the maximum, and whether it is store config or ground data.
- **Q2 — notification content.** Identify the **container and the affected entity/lens, never the
  subject and never the reason**. A tenant learns what will change in their view without learning whose
  request caused it. Delivered as a read, per §29.9.
- **Q3 — its own vocabulary.** Yes: **`loam.erasure.slate`**, one new context, plus
  `loam.erasure.graveyard`. Reusing the quarantine-pool vocabulary would let a reader confuse a staging
  area (things coming IN to canon) with a slate (things going OUT) — the membership machinery is
  identical and the edges point in opposite directions. But the CONTAINER stays a plain T32 property
  container: the slate is a record ABOUT a container, so the general primitive is not widened for one
  preset, and a conventional name is explicitly not the mechanism (§29.1).

## What this does NOT decide

The signed receipt document's format and surface (§29.7's deferred half); whether ISSUANCE leaves a durable
trace (§29.7, Myk's call — the recommendation is a `loam.erasure.receipt` delta over the document's content
address); the store-level window maximum (Q1, Myk's number); lifting the closure lattice into
`loam.container`'s knob vector (waits for a second consumer); transitive citation closure (refused on
purpose, §29.3); the adoption record's primitive `source-delta` encoding (closed at the predicate, not at
the bytes — re-shaping it is a §20 migration for one role and is not attempted here); read closure INSIDE a
pool or wall (decided against, §29.8, with the reasoning rather than a gap); recovering a copy promoted or
translated before the slate (outside the frozen set by construction — surfaced at review, slated by its own
id, never chased by content); cascade policy (already a §11 caller's choice); whether a slate takes a
`parent` edge (allowed, unconstrained here); an outbound notification transport (Loam has none, §29.9); and
any change to how §11 erases a single delta outside a slate — `erase(id)` keeps its exact behavior and
refusal voice, and a slate is the staged form beside it, never a replacement.

## Acceptance criteria (each names its verification)

1. **A slate is a curated property container plus a record, and a wall-posture slate is REFUSED.** A
   slate record naming a `wall` (or `untrusted`) container refuses at the door, naming both knobs; the
   valid property slate resolves. Object level, the load-bearing half: with a slate standing, an ordinary
   `erase(unrelated)` still COMPLETES — a slate never trips §27.7's unreachable-wall guard, which a
   wall-posture slate would. — `test/gateway/slate.test.ts`
2. **Membership is frozen by enforcement, at both levels.** Delta level: a declaration whose
   `membershipAt` Term does not freeze to its `version` is refused. Object level: append a delta that
   satisfies the ORIGINAL identifying predicate after slating, and `containerScope({containers:[slate]})`
   returns the same member set — the slate did not grow. — `test/gateway/slate.test.ts`
3. **`closes` and `deadline` are required, `none` is sayable, and the refusal carries the
   recommendation.** A slate record with no `closes` refuses naming `egress,cite`; one with no `deadline`
   refuses; `closes: none` is accepted and closes nothing (every door still serves). —
   `test/gateway/slate.test.ts`
4. **Egress closure, asked of the peer, over a slated NEGATION — the leg that decides whether the
   subtraction is H1-consistent.** The slate's members include a negation whose target is NOT slated. With
   `egress` closed, a peer pulls via `offeredDeltas()` and the assertion is at the OBJECT level, on the
   peer's own store after the pull, through a Schema: the peer must NOT resolve the retracted claim as
   live. Both the negation and its target are absent from what the peer holds (the transitive leg too: a
   struck strike's chain is withheld whole), and every non-member is present — a rail that withheld
   everything would pass the first half and must fail this one. The same assertion runs on the
   **wall-reseed path**: `openWall` during the window seeds from `offeredDeltas()`, so the fresh
   container's store is read through a Schema and must not resolve the retracted claim either. Striking
   the slate returns members and withheld targets to the offer on the next pull. —
   `test/gateway/slate-doors.test.ts`
5. **Cite closure: ONE predicate, two doors, asymmetric disclosure.** A delta citing a member is refused
   at the append door with a message naming the container, and refused at the federation door with counts
   only — a `FederationReport` indistinguishable from any other rejection. Mutating away the shared
   predicate must break BOTH legs (the rail asserts both from the same slate). — `test/gateway/slate-doors.test.ts`
6. **Cite is direct only, on the record.** A delta citing a delta that cites a member is ADMITTED; and a
   citation refused during the window is admitted after the cut, landing as a dangling reference. Both
   are decisions, so both are asserted. — `test/gateway/slate-doors.test.ts`
7. **Read closure at every door, including as-of — and the operator's review still answers.** With
   `read` closed: the entity/GraphQL read, the byte door, and the public door all decline a member with
   the same uniform refusal an absent delta gets; an **as-of read at a moment BEFORE the slate** does not
   serve it either; a `resolvePinned` read under an older registration declines it too (an old lens over
   today's ground is still a read door); and `containerScope` over the slate plus the slate report still
   return the members to the operator. — `test/gateway/slate-doors.test.ts`
8. **The lapse is computed at the door, with no scheduler and no wall-clock race — and the clock is
   NAMED.** With `read` NOT in `closes` and a `deadline` in the past relative to an explicitly passed
   `now`, the read door declines the member; passed a `now` before the deadline, it serves. No delta is
   appended between the two probes. A read door reached with NO `now` REFUSES rather than serving — the
   fail-open direction is the one that matters, so the rail asserts a refusal and not a default. And the
   clocks do not cross: with `nextTimestamp()` driven far ahead of `Date.now()` (append in a tight loop,
   which is what `max(Date.now(), last + 1)` does), a slate whose `deadline` has NOT passed in wall-clock
   still serves — delta-time running ahead must not lapse a live deadline. `health().slates` reports the
   slate as lapsed, and `health().status` is UNCHANGED by it: a lapsed compliance clock is not byte debt,
   so a rail that accepted `settling` here would encode the conflation. —
   `test/gateway/slate-doors.test.ts`
9. **The pre-flight is all-or-refuse and leaves the ground byte-identical.** A cut over a slate with a
   dangling `membershipAt`, and a cut while the table names an unreachable wall, each refuse before ANY
   tombstone lands — asserted by comparing the ground delta-for-delta before and after the refusal. —
   `test/gateway/slate-cut.test.ts`
10. **The cut is per-member, faults are collected, and the slate STANDS on any fault — then resumes.**
    With one tier refusing to purge one member: `cut()` throws a report naming that member, NO graveyard
    delta exists, the declaration still resolves, the closed doors are still closed, and the successfully
    erased members are gone. Repair the tier, re-run: the cut completes and the store holds exactly one
    tombstone per member (no second tombstone). — `test/gateway/slate-cut.test.ts`
11. **Order and crash semantics: graveyard before strike, exactly one graveyard.** The graveyard's delta
    is in the ground while the declaration still resolves; interrupting between the two (the injected-hold
    idiom) and re-running yields exactly one graveyard and a struck declaration. —
    `test/gateway/slate-cut.test.ts`
12. **The graveyard is durable, joinable, and its completeness is arithmetic.** After a cut: every member
    is byte-gone on every tier and pool (`holds` false); the graveyard resolves carrying the `version`
    address, the request provenance, the window, the closures in force, the affected set, and an EMPTY
    `prior-tombstone` list (the clean case must say so explicitly, or criterion 19's exception could hide
    here); every tombstone carries its `slate` pointer; and §29.6's arithmetic — every member has a
    surviving tombstone that cites this slate or is named for it in `prior-tombstone` — computes TRUE
    **from durable ground alone**, no probe, no CutReport. A walk that returns nothing must fail this rail.
    — `test/gateway/graveyard.test.ts`
13. **The affected set was frozen pre-purge, provably.** The graveyard's affected set is non-empty while
    recomputing the same intersection AFTER the cut reads empty — the assertion that proves it was
    computed, not queried. — `test/gateway/graveyard.test.ts`
14. **Resurrection is visible at review and real at the cut.** A slate whose members include a negation
    reports the strike's target in its `resurfacing` set at review time; after the cut, that target
    resolves LIVE through a Schema (object level, at the door). — `test/gateway/slate-cut.test.ts`
15. **Forgiveness, both sides.** Before the cut: striking the declaration reopens every closed door on
    the next read, no member's bytes moved (`holds` still true), and the request record still resolves.
    After the cut: striking a member's tombstone permits the id's return but restores no bytes, the
    graveyard is untouched, and a re-derived receipt reports that member as FORGIVEN with its strike id
    rather than still-forgotten. — `test/gateway/slate.test.ts`
16. **The CutReport carries every receipt HISTORY field.** The rail enumerates the §29.7 receipt fields,
    partitions them into history and observation, and asserts every HISTORY field (the window, the frozen
    version and member count, the request provenance with its `requested-by` form, the tombstone ids,
    `spoken-by`, `prior-tombstone`, the citations manifest, `duplicates`, the affected and resurfacing
    sets, the graveyard id) is present in the `CutReport` or derivable from durable ground — no history
    field requires information that existed only during the cut. The partition itself is asserted: every
    per-tier byte verdict must be on the OBSERVATION side, and a rail that let one count as history would
    green-light exactly the formatter criterion 22 forbids. — `test/gateway/slate-receipt.test.ts`
17. **The mint is new vocabulary only — no §20 step.** A pre-mint fixture store opens with identical
    delta ids and identical views; an existing tombstone carrying no `slate` pointer still binds at both
    doors and in `readTombstones`; and the vocabulary rail enumerates the two new contexts under the
    prefix discipline. — `test/gateway/slate.test.ts` and the frozen container-vocab rail, unmoved.
18. **Read closure survives the WARM paths, and leaves the ground-reading primitives alone.** The fixture
    is warm before the slate lands, which is the whole rail: a registered root is read once so its
    materialization exists, AND a live subscription (`watchEntity` / the SSE surface) is OPEN and has
    received its initial frame carrying the member. THEN the slate lands with `read` closed. Assertions:
    the registered-root read no longer serves the member (a cold-fixture rail would pass here with the warm
    path leaking, so the fixture's warmth is asserted first — the materialization exists before the slate);
    the open stream stops carrying it (it ends and the resubscribe is narrowed, or its next frame omits it —
    whichever the design lands, the rail asserts the member never appears in a frame delivered after the
    slate); and a change to an unrelated member of the same entity still produces a patch, so the fix is
    not "streams stop working." In the same test, with `read` STILL closed: `containerScope({containers:
    [slate]})` and `Container.members()` return the full member set, `Gateway.freeze` over the membership
    Term still equals `version` (the re-freeze equality §29.2's door and §29.5's pre-flight both depend on),
    and the operator's slate report still lists every member. If any of those four narrows, the store
    deadlocks instead of leaking, so they are asserted as explicitly as the closure itself. —
    `test/gateway/slate-doors.test.ts`
19. **A member erased independently mid-window: the cut COMPLETES and the proof stays decidable.** A slate
    stands over four members; the operator `erase()`s one by hand; then `cut()`. It must not throw: the
    re-freeze disagreement is accounted for, the graveyard lands, and `prior-tombstone` names that member
    paired with the tombstone id that already covered it. Exactly one tombstone exists for that member (no
    second mint — assert the id equals the pre-cut tombstone's), §29.6's arithmetic computes TRUE from
    durable ground alone, and the other three members carry `slate` pointers. The fail-closed leg is the
    same rail's second half: a frozen id that resolves to nothing and has NO surviving tombstone refuses
    the cut, naming that id, before any tombstone lands (ground compared delta-for-delta across the
    refusal). — `test/gateway/slate-cut.test.ts`
20. **A detached wall that demonstrably holds a member is a REFUSAL, and cutting around it is signed.** A
    wall container is opened, seeded so its store provably holds one member (asserted by reading the
    wall's own store, not by trusting the seed), then `detach()`ed onto the record — so
    `unreachableWallReport` puts it in `kept` with `faults` empty, the state the documented remedy for a
    blocked `erase` produces. `cut()` REFUSES, naming the wall and the intersecting ids. A `kept` wall with
    no at-rest membership Term refuses too (uncomputable intersection, fail closed). With an
    `accepts-incomplete` pointer naming that wall on the slate record, the cut completes and every
    downstream artifact tells the truth: that member's per-tier verdict is **`unproven`**, not `holds:
    false` (asserted as an inequality against `false`, since collapsing the tri-state is the actual bug),
    the wall is in `kept` with the declaration that permitted it, the receipt's non-claim section names it,
    and the member's bytes are still readable in the wall's store — so the rail proves the report is honest
    about a copy that really is still there. — `test/gateway/slate-cut.test.ts`
21. **Content re-spoken under another id: the window is closed, the past is not, and the receipt says so.**
    With a slate standing over a member, `promote` of that member into canon is REFUSED — the leg that
    proves the cite predicate reads the adoption record's `source-delta` even though it is a PRIMITIVE
    string, not a delta-ref (the rail asserts the encoding explicitly, so the enumerated-role list cannot be
    narrowed by accident). A promotion made BEFORE the slate is not reached: after the cut the promoted copy
    still resolves LIVE through a Schema (object level), it is absent from the frozen `version`, and it
    appears in the slate report's `duplicates` at review time with the member it copies. The CutReport
    carries §11's citations manifest per member. — `test/gateway/slate-cut.test.ts`
22. **The receipt's byte verdicts are re-probed, never reprinted.** After a clean cut, a member's bytes are
    resurfaced on one tier (the restored-backup shape). A re-derived receipt's per-tier verdict for that
    member FLIPS to holding, while the CutReport's stored verdict does not change — and the rail asserts
    both, because only the disagreement proves the re-issue probed rather than formatted. A re-issue that
    read the CutReport would pass the second assertion and fail the first. — `test/gateway/slate-receipt.test.ts`
23. **Forgiveness, re-federated: the store can still see the id came back.** After a cut, a member's
    tombstone is struck (§29.8), and the id is then re-federated in from a peer — which `federateImpl`
    admits, because the id is no longer dead. Assertions: the id resolves LIVE through a Schema again
    (object level); `health().erasure` no longer counts it (that is the hole, and the rail states it) while
    `health().forgiven` DOES, sourced from the graveyard's frozen `version` rather than from
    `readTombstones`; and a re-derived receipt reports that member as forgiven with its strike id **AND
    present again as of the issue moment** — a receipt saying only "forgiven" must fail this rail. —
    `test/gateway/slate-receipt.test.ts`

## Open for Myk

1. **The window maximum (Q1's number)** — a store-level cap, its default, and whether it is deploy
   config or ground data. Recommendation above: ship the required per-slate deadline now, defer the cap
   until a real DPO names a figure.
2. **Sealing `requested-by` by default** for subject requests (§29.4) — data minimization in a permanent
   record versus an audit trail a human can read without a preimage. Sharpened by the premortem: the seal is
   only as durable as its SALT, which lives outside the ground as operator key material (§29.4), so making
   sealing the default makes salt custody the whole audit trail of who asked. Recommendation: offer it,
   document the custody, do not default to it until the custody story is as boring as the signing seed's.
3. **Whether the signed receipt DOCUMENT ships in this ticket or its own** (§29.7). Recommendation: its
   own, with T64 obligated to produce every field it needs.
4. **The §11 amendment's wording** — the promise change is decided; the sentence that lands in
   `spec/11-erasure.md` is Myk's to approve with the merge.
5. **Whether ISSUING a receipt leaves a durable trace** (§29.7, new from the premortem). Nothing today
   records that a receipt exists, so after a restored backup resurfaces bytes no process can enumerate the
   parties owed a re-issue — and `/health` is operator-only, so the DPO's document and the store's live
   verdict never meet. Recommendation: a `loam.erasure.receipt` delta over the DOCUMENT's content address —
   a hash retains nothing, it cannot go stale because it is not an observation, and it makes outstanding
   receipts enumerable. It is a (Myk) call because it adds a permanent record of a compliance act, which
   decides something rather than repairing it.
