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
- **`read`** — every reading door (entity/GraphQL, byte, public, and **as-of**). The data is already
  effectively gone; the bytes are a formality.

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

**And the post-cut resubmission is INTENDED.** Admission today refuses a delta whose own id is dead
(`ingest.ts`, `dead.has(d.id)`) and does not inspect pointers, so a citation refused during the window
can be resubmitted after the cut and lands as a dangling reference. That is correct and must stay:
`eraseImpl`'s `citations` manifest exists precisely because surviving deltas legitimately cite erased
ids (negations, provenance links), so a permanent pointer-level refusal would break negation and
provenance both. Cite-closure is a WINDOW property about the orphan set at cut time, never a promise of
referential integrity a grow-only union cannot make anyway.

**Egress closure pre-represents the post-cut world, and the review must see it.** Withholding a member
makes the offered set equal to what the peer would get after the cut — which is the point. One
consequence is real and gets an affordance rather than a footnote: if a member is a NEGATION, cutting it
REVIVES its target (§11's own consequence). So the slate report lists the **resurfacing** set — the
targets of slated negations — at review time. This is a genuine new value of the two-phase shape: the
operator sees which claims will come back to life *before* the cut, which no single-act erasure could
ever show them.

**Read closure never closes the operator's REVIEW read.** The operator is the controller and must be
able to examine what they are about to destroy; a read-closed slate that could not be reviewed would
defeat itself. So read-closure applies at the doors, and `containerScope` over the slate plus the slate
report remain the operator's, explicitly.

**Read closure is an operand-set narrowing, applied once, per door class.** The read resolves against
`snapshot ∖ readClosed`, and because the removal is of a delta together with its effect, the H1
direction is preserved (the forward closure `containerScope` already runs is the model). The byte door
serves the same uniform 404 it already serves for an erased source. **As-of is the site that would have
been missed**: §26 reconstructs the surviving ground at a moment T, and a moment before the slate would
happily serve the condemned delta — so the narrowing is applied AFTER the as-of reconstruction, and the
temporal door confesses a slate-suppression count in the same register `forgottenSince` already uses.

## 29.4 The window, the deadline, and the lapse computed AT THE DOOR

A slate carries a **required** `deadline`. A compliance clock runs from the request, and a default here
would be the worst of the options — a legal deadline chosen silently by a library.

**Nothing in Loam runs a timer, and the design must not pretend one exists.** So the lapse is a READ-TIME
verdict: the slate reader takes an explicit moment (`readSlates(reactor, operator, now)`), and a slate
whose `deadline` is past resolves with `read` added to its closure set. This fails SAFE — a store that
was down for a week wakes with read already closed — needs no scheduler, and gives the rails a
deterministic seam (an explicit `now`, never a wall-clock race; the flaky-test rule).

`requested-at` is the clock's start and is distinct from the delta's own timestamp, which records when
the operator got round to filing it. The gap between them is auditable, which is the point.

**`requested-by` may be a §11 SEAL rather than a name.** The graveyard is permanent, and a subject's
identity is often exactly what they asked to have forgotten, so §11's rung-3 tool is pointed at the
request record: `requested-by` is either a plain identifier or a `sealCommitment(salt, subject)` — the
operator reveals the preimage if they must ever prove who asked. No new cryptography, and the receipt
names which form was used so a reader is never guessing. **(Myk)** whether sealing should be the
recommended default for subject requests.

**Health reports the clock.** `health()` already answers whether every erasure promise has settled to
bytes; it gains open and lapsed slate counts, and reports `settling` while any slate is lapsed — debt
outstanding, converging, not broken. That is the instrument an operator watches to see a compliance
window running out, and it is a precondition for the receipt story being sellable.

## 29.5 The cut

**The pre-flight is ALL-OR-REFUSE; the per-member work is per-member with a fault report.** Atomicity is
claimed only where it is real. `blessAll`-style all-or-refuse is impossible honestly here: erasure is not
transactional across tiers, and a mirror going down mid-cut is a physical state, not a bug. So:

1. **Pre-flight, before any tombstone.** Refuse if the slate's membership does not resolve (a dangling
   `membershipAt` — H9, fail closed: if we cannot read which ids are condemned we cannot cut), if the
   §27.7 wall guard reports a fault (an unreachable wall could hold a member outside the sweep), or if
   the slate record does not resolve lawfully. Nothing half-done, no tombstone standing over an
   unreported gap — the discipline `eraseImpl` already keeps.
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

`cut()` returns a **CutReport**: per member the id, its tombstone id, `spoken-by`, and the byte verdict
per tier and pool reached; plus the tiers deliberately NOT reached (a detached wall, on the record as
`kept`), the affected set, the resurfacing set, the window, and the graveyard's id.

## 29.6 The graveyard

The record that survives the cut is the erasure EVENT, not a second copy of the per-id law.

**One delta at `loam.erasure.graveyard`**, citing: the slate entity, the slate record's id (the request
provenance — who asked, when, why, the deadline), the `version` address (the frozen condemned set), the
window (opened, cut at), the closure set in force, and the affected set. It holds content addresses, and
retaining a hash retains zero content — §11's own founding argument, reused.

**It CITES tombstones; it does not replace them.** `readTombstones` is load-bearing at every door and
must remain the single per-id law — two records of one fact is the exact failure pattern of 2026-07-21.
So the graveyard does not list the tombstones at all: **each tombstone minted by a cut carries a `slate`
pointer**, and "which tombstones belong to this graveyard" is a join. That keeps the graveyard one small
delta regardless of whether the cut had four members or forty thousand, and it buys the arithmetic the
receipt is made of:

> Every member of the frozen `version` has a surviving tombstone citing this slate.

That is checkable at any later date from durable ground alone, with no observation of the tiers and no
memory of the cut. It is the difference between a narrative and a proof.

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
live per-tier byte verdict, the tiers deliberately not swept, the graveyard id, and an explicit
**non-claim** section — peers are not reached, pre-request copies are not recalled, a restored backup can
resurface bytes and this document is re-issuable to prove present state.

**And a re-issued receipt must report FORGIVENESS.** Per-member verdicts read the LIVE tombstone state,
so a member whose tombstone was later struck shows as forgiven with its strike id. A document that
silently kept claiming a forgiven member was still forgotten would be the H7 shape in the one artifact
whose entire purpose is not being that.

**The needed-now / deferred line, drawn on one principle: the DATA can never be reconstructed later; the
DOCUMENT can wait.**

- **Now** — the slate record and the enforced-frozen membership; the property-posture refusal; the two-door
  cite predicate with its asymmetric disclosure; the deadline and the door-computed lapse; the cut's
  order, resumability, and pre-purge computation of the affected/resurfacing sets; the graveyard; the
  tombstone `slate` join; and a **structured CutReport carrying every field the receipt needs**.
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

The signed receipt document's format and surface (§29.7's deferred half); the store-level window maximum
(Q1, Myk's number); lifting the closure lattice into `loam.container`'s knob vector (waits for a second
consumer); transitive citation closure (refused on purpose, §29.3); cascade policy (already a §11
caller's choice); whether a slate takes a `parent` edge (allowed, unconstrained here); an outbound
notification transport (Loam has none, §29.9); and any change to how §11 erases a single delta outside a
slate — `erase(id)` keeps its exact behavior and refusal voice, and a slate is the staged form beside it,
never a replacement.

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
4. **Egress closure, asked of the peer.** With `egress` closed, a peer pulling via `offeredDeltas()`
   receives the offered set MINUS the members (object level: what the peer's store holds after the
   pull, not what a filter returned), and members return to the offer the moment the slate is struck. —
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
   serve it either; and `containerScope` over the slate plus the slate report still return the members to
   the operator. — `test/gateway/slate-doors.test.ts`
8. **The lapse is computed at the door, with no scheduler and no wall-clock race.** With `read` NOT in
   `closes` and a `deadline` in the past relative to an explicitly passed `now`, the read door declines
   the member; passed a `now` before the deadline, it serves. No delta is appended between the two
   probes. `health()` reports the slate as lapsed and the store as `settling`. —
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
    address, the request provenance, the window, the closures in force, and the affected set; every
    tombstone carries its `slate` pointer; and "every member of the frozen version has a surviving
    tombstone citing this slate" computes TRUE **from durable ground alone** — no probe, no CutReport.
    A walk that returns nothing must fail this rail. — `test/gateway/graveyard.test.ts`
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
16. **The CutReport carries every receipt field.** The rail enumerates the §29.7 receipt fields and
    asserts each is present in the `CutReport` or derivable from durable ground plus a live probe — no
    field requires information that existed only during the cut. — `test/gateway/slate-receipt.test.ts`
17. **The mint is new vocabulary only — no §20 step.** A pre-mint fixture store opens with identical
    delta ids and identical views; an existing tombstone carrying no `slate` pointer still binds at both
    doors and in `readTombstones`; and the vocabulary rail enumerates the two new contexts under the
    prefix discipline. — `test/gateway/slate.test.ts` and the frozen container-vocab rail, unmoved.

## Open for Myk

1. **The window maximum (Q1's number)** — a store-level cap, its default, and whether it is deploy
   config or ground data. Recommendation above: ship the required per-slate deadline now, defer the cap
   until a real DPO names a figure.
2. **Sealing `requested-by` by default** for subject requests (§29.4) — data minimization in a permanent
   record versus an audit trail a human can read without a preimage.
3. **Whether the signed receipt DOCUMENT ships in this ticket or its own** (§29.7). Recommendation: its
   own, with T64 obligated to produce every field it needs.
4. **The §11 amendment's wording** — the promise change is decided; the sentence that lands in
   `spec/11-erasure.md` is Myk's to approve with the merge.
