## 29. Two-phase erasure — slating, the cut, and the graveyard

§11 gave the operator the power to make a fact genuinely go, and made it honest about whether the bytes
left. It did not make it *announceable*. Erasure is the operator's alone, which is correct, but the
operator reaches across every tenant (§7) and container (§24/§27) boundary — so a removal could
invalidate data a tenant was relying on with no warning of any kind, and the tenant's first notice was
the absence.

The obvious fix is a dry-run that reports impact before you commit. It is wrong, and the reason
generalizes past this feature: **a dry-run list is an OBSERVATION of a world that keeps moving.** It
drifts between the look and the act, a notification built on it under-reports silently, and caching it
makes that worse rather than better. That is hazard H8 exactly — an index of data location fails OPEN.

So erasure becomes ONE operation in TWO PHASES, with a visible intermediate state (decided by Myk,
2026-07-21: *"this complies better with everyone's needs and expectations"*). You **identify**, which
SLATES the deltas; then you **cut**. The slate does not merely record which deltas are affected — it
CLOSES PROPAGATION over them, so the set **cannot grow** after identification. The impact list is then
true by ENFORCEMENT rather than by observation. That is the whole move, and everything below is its
consequences.

### 29.1 A slate is two deltas, and neither is a new primitive

A slate is a §27 container plus one record saying it is a slate. The container carries the membership;
the record carries everything erasure needs and containment does not — who asked, when, the deadline,
and which doors honour it.

- **`loam.container`**, unchanged (§27's mint): `trust: "curated"`, `posture: "shared"`, a membership by
  address, and a `version` over the frozen members. No new roles, no widened knob vector.
- **`loam.erasure.slate`**, new: the container it names, `requested-by` and the FORM that identifier took,
  `requested-at`, the `deadline`, repeated `closes`, an optional `reason`, and — see §29.5 — optional
  `accepts-incomplete` pointers.

**The join is a POINTER, never a name convention.** A container called `container:slate:…` is a comment;
nothing can verify it, and a prefix that code parses becomes law by accident. What makes a container a
slate is a surviving lawful record pointing at it, so the doors and the readers ask the record and the
naming stays advice.

**And the condemned set is pinned ON THE RECORD, by content address.** This is the load-bearing decision
of the whole section, and the reason is a hole that the tidy version leaves open. A container declaration
is LATEST-WINS on its membership address — only `trust` and `posture` are fixed to the earliest
declaration — so a set pinned only there can be RE-POINTED mid-window by one further operator-signed
declaration, at a wider Term, with a self-consistent `version`. Every door passes. The cut then destroys
the widened set, and the graveyard records the widened address, so every later receipt proves completeness
over the set that was CUT rather than the set that was IDENTIFIED. A record is content-addressed and
therefore immutable: what it pins cannot move, and re-identifying is a NEW record. The door then requires
the container to AGREE, and a container that disagrees is REPORTED rather than obeyed — the operator learns
their re-declaration bound nothing instead of believing it re-identified the set.

**A slate is a SHARED-posture container, and a separate-store one is refused at the door.** This is not a
preference. A separate-store container pays real byte copies, so a separate-store slate would hold a
SECOND copy of every condemned delta — and §27's `drop()` on one purges and byte-verifies, so dropping it
would report a byte-verified clean discard while every canonical original still sat in the primary. That is
hazard H7 wearing a container, on the one surface whose report is a legal claim. It is also self-blocking
(§27.7's guard refuses every `erase` while a declared separate store is unattached, and the slate would be
that store) and it is exactly the "the slate becomes the hiding place" recursion §24.8 warns about. All
three problems vanish at `shared`, where the slate holds no bytes and can hide none.

### 29.2 Frozen by ENFORCEMENT, not by promise

The claim that the impact list is true rests on the set being unable to grow, and a LIVE membership Term
would defeat it completely: `author = X` keeps admitting deltas as they arrive, so the list drifts and
under-reports — the dry-run failure re-entering through the front door.

So **a slate's membership is an EXTENSIONAL id set, and the door proves it.** Identification evaluates
whatever Term the operator likes, once; the result is frozen; the ids become a `match{field: id, cmp:
inSet}` Term; that Term is published and cited by address; and the §27.2 ModuleVersion address over the
frozen members goes in `version`. The door then checks AGREEMENT — evaluate the Term, freeze the result,
refuse unless it equals `version` — which is what turns "frozen" from a convention into an invariant.

A Term of any other shape is a REFUSAL, not an empty set, and the distinction matters more than it looks.
`author eq X` freezes to a perfectly honest address, so an agreement check alone would certify it while the
id set read empty: all three closures would withhold nothing, a review would tell the operator "nothing",
and no field anywhere would say something was wrong. A removal order that closes nothing and reports
nothing wrong is the worst available outcome, so the shape is a first-class verdict every reader handles.

Two dividends fall out. The graveyard's frozen membership is already minted — it is the `version` address.
And the door predicate needs **no scan**: the condemned ids are literally the values in the published
Term's JSON, so a slated-id lookup is a `Set.has`, the same cost class as the tombstone check that already
runs at both doors.

### 29.3 The lattice — which doors honour a slate

Reading is a kind of dependency, so the three closures are one axis at different depths. A slate names a
subset of:

- **`egress`** — the offer / federation-out door. The HOLDER set cannot grow. This is what makes the impact
  list true rather than hopeful.
- **`cite`** — the append door and the federation-in door. The DEPENDENT set cannot grow, so no new orphans
  exist at cut time.
- **`read`** — every reading door. The data is already effectively gone; the bytes are a formality.

**`closes` is REQUIRED with no silent default, and `none` is sayable.** The recommendation lives in the
refusal — `egress,cite` is the minimum that makes both the impact list and the orphan set true — never in
silent semantics. An honest announcement-only slate says `none` explicitly, and that is a legitimate legal
posture: same machinery, a grace period instead of a near-erasure. Tightening during the window is a delta;
the asymmetry is stated rather than discovered, because **tightening is real and loosening cannot
un-disclose.** A re-widened slate has not recalled what a door already served.

Now the part that the tidy formulation gets wrong. "A closure is a set subtraction" is true of the SET and
false of the machinery, and each door pays a different price:

**CITE is ONE predicate at TWO doors, differing only in DISCLOSURE.** Every one of the seven H1 findings
of 2026-07-21 was one-rule-N-sites-one-drifts, with the federation site as the one that drifted, so there
is a single predicate and both doors call it. At the **append** door the refusal is informative and names
the container: the only parties who can trigger it are parties who could already read the target, so
telling them IS the notice — the mechanism and the warning turn out to be the same thing. At the
**federation-in** door that reasoning fails (a peer pushing a citation may have no read access, and a
distinguishable refusal would announce that something exists and is leaving), so it takes the
uniform-refusal discipline, which costs nothing because that door already answers in counts.

Cite is **DIRECT only**, deliberately: a pointer check is a Set lookup, where transitive closure is the
unbounded scan H8 exists to warn about. But "direct" means NAMES A MEMBER, not "has a delta-shaped
pointer". One pointer in this store is a delta reference in everything but encoding — the adoption record's
link back to what a promotion copied is a plain string — and a predicate reading only delta-refs therefore
ADMITS a promotion during the window, which re-signs the source's pointers under the operator and lands a
fresh operator-authored copy of condemned content under a new id, outside the frozen set, that the cut
never touches. So the predicate also matches an ENUMERATED primitive role that is a delta reference by
convention, and that list is closed in the code beside this sentence: today it is exactly `source-delta`.

**And a NEGATION is not a citation.** Cite closure exists so the dependent set cannot grow; a strike adds
no dependent — it removes a claim, which is the one direction a suppression window has no reason to refuse.
Refusing one strands it: at the append door a caller's own `clear` over a field with one slated
contribution would retract none of their others, because a batch refuses whole; at the federation door the
refusal folds into the uniform count while union's idempotence means the peer never resends, so after
un-slating the claim reads LIVE here and RETRACTED at the peer, permanently. The exemption is per POINTER,
so a delta that negates a member and also cites it under some other role is still refused on that role.

**EGRESS subtracts from a set the negation closure deliberately ENLARGED.** `offeredDeltas` returns the
lens result plus everything that struck it, precisely because offering a claim while withholding its
retraction republishes something the operator struck. A naive subtraction of a slated NEGATION therefore
leaves its target offered and hands the peer a live reading of a retracted claim — H1 read from the other
side. The invariant is *if I offer `d`, I offer everything that negates `d`*; its contrapositive is *if I
withhold `n`, and `n` negates `d`, I withhold `d`*. Those are one rule, so the withheld set is **the
condemned ids plus the targets of condemned negations, transitively** — transitive because a struck strike
revives, and terminating because the set only grows and content addressing forbids a cycle.

This costs the slogan that egress closure "pre-represents the post-cut world," and the trade is worth
naming: it does not, because after the cut the target REVIVES and the peer would see it. The operative
promise was never mirror-imaging the future — it is *the holder set cannot grow* — and over-withholding is
the only direction that cannot disclose. The decisive argument is §29.8's: un-slating is FREE, so a naive
subtraction would let an announce-then-withdraw window permanently publish a revived claim to every peer
that pulled. **A revocable act must not have an irrevocable effect.** So the offer under-represents the
post-cut world for exactly the resurfacing set, the review says so beside that set, and the peer converges
at the cut rather than during the window.

There is ONE subtraction site, and the second caller inherits it: a container's reseed seeds from
`offeredDeltas`, so a separate store attached DURING the window would otherwise be born holding a condemned
delta. One site closes both doors, and it is the right place on the merits — a store that never receives a
condemned delta is one fewer copy for the cut to sweep, which is §24.8's recursion warning answered rather
than restated.

**READ is a GATHER-level narrowing living in ONE helper**, and it gets the same one-predicate-N-sites
discipline `cite` gets because it has MORE sites, not fewer. The naive reading — resolve against
`snapshot ∖ readClosed` — covers exactly the sites nobody was going to forget. The ones that matter:

- **The cold gather** substitutes directly: evaluate the same body over the narrowed ground. This is the
  as-of path's own move.
- **The WARM gather** defeats the naive reading outright. A materialization is maintained INCREMENTALLY
  from ingest events; it is not an operand set anything can subtract from, so a read-closed member keeps
  being served through the default path for every registered root. **So a read-closing slate DEMOTES the
  warm path for its lifetime** — while the narrowed ground differs from the snapshot, the gather ignores
  the materialization. Reads lose their warm path for the life of the slate, which is a bounded and visible
  price a compliance window can pay. **A re-seat is NOT the fix**: replaying the backend into a fresh
  reactor rebuilds a materialization that holds the members again.
- **A live subscription** resolves off its captured materialization, so the mat keeps its real job and
  loses the other one: **the mat is the TRIGGER, the narrowed ground is the RESOLUTION.** A superset
  trigger is safe (a change to a read-closed member fires, the narrowed re-resolve yields the same hex, and
  the existing sameness check swallows it as silence); a subset trigger would not be.
- **A stream open BEFORE the slate** would serve the member forever, because nothing in the slate's own
  deltas touches the watched entity's materialization, so no sink fires. A landing slate that closes `read`
  therefore ends live subscriptions the way an erase does; readers wake with `done` and resubscribe into
  the narrowed gather. Already-delivered frames are not recalled — nothing can recall them.
- **A pinned older lens** over today's ground is still a read door, and takes the same substitution.
- **As-of is the site that would have been missed.** §26 reconstructs the surviving ground at a moment T,
  and a moment BEFORE the slate would happily serve the condemned delta — so the narrowing is applied
  AFTER the reconstruction, and the temporal door confesses a suppression count in the same register
  `forgotten` already uses.

Because every mediated read on the surface resolves through one seam, a read door added LATER inherits this
by construction rather than by someone remembering — which is how §30's `?read=` gesture, written after
this closure, was covered on arrival.

**And the narrowing is REFUSED ENTRY to the ground-reading primitives, by name.** The tempting single choke
point is the one place it must never go, and the failure is not a leak but a DEADLOCK. `select`,
`containerScope`, a container's `members()`, `freeze`, §29.2's own agreement check and the operator's review
read all evaluate over the UNNARROWED ground. A read-closed slate evaluating its own membership over a
narrowed snapshot freezes to a different address than its `version`, so the slate self-invalidates, and
§29.5's pre-flight then refuses the cut at exactly the moment the deadline passes: a stuck store, permanent
suppression, and no cut possible — the worst outcome this design can produce, arrived at through its tidiest
refactor. **Read closure is a property of DOORS. The primitives that compute membership are not doors**, and
neither is a §14 RETRACTION: a write must see what it is retracting, or a caller's own strike over a
read-closed member becomes a silent no-op that signs nothing while the door answers success.

Read closure also never closes the operator's REVIEW read. The operator is the controller and must be able
to examine what they are about to destroy; a read-closed slate that could not be reviewed would defeat
itself.

### 29.4 The window, the deadline, and the lapse computed AT THE DOOR

A slate carries a **required** `deadline`. A compliance clock runs from the request, and a default here
would be the worst option — a legal deadline chosen silently by a library.

**Nothing in Loam runs a timer, and this design does not pretend one exists.** The lapse is a READ-TIME
verdict: the slate reader takes an explicit moment, and a slate whose deadline is past resolves with `read`
added to its closure set. That fails SAFE — a store down for a week wakes with read already closed — needs
no scheduler, and gives the rails a deterministic seam instead of a wall-clock race.

The moment is REQUIRED on the internal read seam, and a door reached without it FAILS CLOSED and loudly. An
optional moment defaulting to anything at all would serve a member past a lapsed deadline and look healthy
doing it, which is the fail-open direction and the only one that matters here.

**Two clocks, named, because there are two.** Delta-time is `max(Date.now(), last + 1)` and may run AHEAD
of wall-clock under load, so a deadline minted in one clock and compared against the other is a bug that
only appears on a busy store. `deadline`, `requested-at` and the moment a door is passed are WALL-CLOCK
milliseconds — one clock, the caller's, comparable — while a delta's own timestamp is DELTA-TIME and is
never compared against a deadline. `requested-at` is the compliance clock's start and is deliberately
distinct from the delta's timestamp, which records when the operator got round to filing; the gap between
them is auditable, and a reader of that gap is told it may be inflated by delta-time drift rather than by
an operator's delay.

**`requested-by` may be a §11 SEAL rather than a name.** The graveyard is permanent, and a subject's
identity is often exactly what they asked to have forgotten, so §11's commitment tool is pointed at the
request record: the identifier is either plain or a `sealCommitment(salt, subject)`, and the record NAMES
WHICH so a reader is never guessing. No new cryptography. The salt is operator-held key material kept where
the signing seed is kept — a salt stored in the store it protects is a legible preimage sitting beside its
own hash, and a salt nobody kept is a commitment that can never be honoured.

**Health reports the clock in its OWN section, and a lapsed slate does NOT move `status`.** The tempting
version — report `settling` while any slate is lapsed — would route a compliance clock through the field
§11's byte debt uses. Those are different facts with different remedies: `settling` means a promise already
MADE has not reached the bytes and the operator waits or repairs a tier; a lapsed slate means a promise has
not been KEPT and the operator's job is to CUT. Conflating them teaches whoever watches `status` that
`settling` sometimes just means someone filed a slate, and that is how a field earns the right to be
ignored. So `health()` gains a distinct `slates` section — open, lapsed, and which — plus `forgiven` (§29.8),
and `status` keeps meaning exactly what it meant.

A slate whose condemned set cannot be READ enforces NOTHING, because every closure is seeded from the member
set — so it says so, in its own field, rather than reporting closures it is not delivering. The two routes
into that state are closed at their sources instead: erasing a standing slate's pinned Term is refused, and
a cut refuses a member that IS one (which also closes the cross-slate case where one cut would silently
disarm another slate's closures). What remains is the honest case — a store that never received the Term —
where there is genuinely nothing to enforce because this store never held the ids.

### 29.5 The cut

**The pre-flight is ALL-OR-REFUSE; the per-member work is per-member with a fault report.** Atomicity is
claimed only where it is real: erasure is not transactional across tiers, and a mirror going down mid-cut
is a physical state rather than a bug.

**1. Pre-flight, before any tombstone — and the refusals are ENUMERATED, because an unenumerated one is
what a cut discovers halfway through.** It refuses if the membership does not resolve; if the slate record
does not resolve lawfully; if the container disagrees with what the record pinned; if §27.7's guard reports
an unreachable separate store; if a container scope needed for the affected set cannot be read; if a member
is another standing slate's pinned Term; if a **covered** separate store may hold a member; or if the
membership no longer agrees with `version` and the disagreement is not fully accounted for.

*The agreement re-check has ONE lawful exception, named rather than discovered.* The move that matters is
mundane: an operator erases one member by hand mid-window. The frozen ids survive, but evaluating the Term
now yields a smaller set — and without an exception the cut walks into §11's `nothing to erase` refusal,
which step 4 correctly treats as a fault, leaving a slate that STANDS with its doors closed, its deadline
lapsing, `read` closing forever, and **no repair, because nothing can un-erase**. So: a member missing from
the re-evaluation is accounted for **iff it carries a surviving lawful tombstone**. Those members are not
faults and are not re-erased — they land in the cut's `prior-tombstone` list paired with the tombstone that
already covers them. A member missing with NO tombstone is a fault, refused by id. That leg should be
unreachable today, which is exactly why it is written down.

*A covered separate store that may hold a member is a REFUSAL, not a footnote.* §27.7 returns such a store
as a FAULT only while it is neither attached nor covered by a detach record — and the documented remedy for
a blocked erase is to detach it onto the record, so **the sanctioned unblocking move converts a fault into
a footnote.** The cut would then reach the attached stores only and produce a table of proven-gone verdicts
beside a "kept" list while members sat legible on a shelf: H7 in the one artifact whose entire purpose is
not being H7. The intersection is COMPUTABLE without attaching anything — the frozen ids are in hand and the
store's at-rest membership Term is in the container table — so it is computed, and a covered store whose
admit-set intersects the condemned set refuses the cut by name. One with NO membership Term refuses too: an
uncomputable intersection cannot be excluded, and the direction is to fail closed rather than assume empty.
Both refusals are repairable — attach it and re-run, or narrow the slate, since un-slating is free.

*And when a store genuinely cannot be reached, incompleteness becomes a SIGNED DECLARATION rather than a
discovered footnote.* A store that is gone would otherwise jam a legitimate cut forever, so the slate record
may carry repeated `accepts-incomplete` pointers naming the stores the operator knowingly cuts around. With
one in force the cut proceeds and everything downstream tells the truth: those members' per-tier verdicts
read UNPROVEN, the store is listed as kept, and the receipt's non-claim section names it. **The operator can
always cut. The operator cannot cut SILENTLY over a store that may hold members** — the difference between
an incomplete erasure and a false claim of a complete one is a signature, and now it is one.

**2. The affected, resurfacing and duplicates sets are computed HERE, immediately before any purge.**
Afterwards the members are gone and every intersection reads empty — the frozen-membership lesson applying
a second time, one layer up.

**3. Per member, the ordinary erase.** The cut mints no new fan-out: tombstone, purge, attached-store
fan-out and the byte verdict all come from §11 unchanged. The only addition is one optional `slate` pointer
on each newly minted tombstone.

**4. Any fault: throw, and the slate STANDS.** No graveyard lands, the declaration survives, and every
closed door stays closed — so a partially cut slate is still slated, still reviewable, and RESUMABLE. This
is §27's `drop refused: … the pool remains ATTACHED` discipline: a thing that cannot prove it completed does
not slip out of reach. A re-run mints no second tombstone.

**5. The graveyard lands, THEN the declaration is struck.** Order is load-bearing: strike first and a crash
loses the record, because the struck declaration no longer resolves the set. A crash between the two leaves
a graveyard beside a standing slate whose members are all tombstoned, so the re-run finds nothing
outstanding and simply strikes — exactly one graveyard, idempotent by construction. Dropping the container
is the LAST ACT of the cut and never the cut itself: a shared-posture container holds no bytes of its own,
so striking its declaration purges nothing.

The cut answers with a structured report: per member the id, the tombstone, `spoken-by`, the byte verdict
per tier, and §11's citations manifest for that member; plus `prior-tombstone`, the tiers deliberately not
reached with the declaration that permitted it, the affected set, the resurfacing set, the duplicates set,
the window, and the graveyard's id.

**The per-tier byte verdict is a TRI-STATE, and `unproven` is not a synonym for `false`.** A tier that
refused, a tier that threw, and a covered store nobody looked inside are all "we did not prove these bytes
are gone" — the opposite of "we proved they are gone" — and a boolean cannot hold the difference. `health()`
already carries `unproven` for exactly this fact, and this report uses the same word for it. Collapsing the
third state into `false` is how a report of work NOT DONE reads as a report of work completed.

**The resurfacing set is an affordance, not a footnote.** If a member is a NEGATION, cutting it REVIVES its
target (§11's own consequence). So the review lists the targets of slated negations BEFORE the cut, and it
is the same set egress withholds during the window. This is a genuine new value of the two-phase shape: the
operator sees which claims will come back to life *before* destroying anything, which no single-act erasure
could ever show them.

**A copy made BEFORE the slate is outside its reach, and the review is where that gets said.** Erasure is by
ID, and a content-addressed store cannot chase content — §11 has never promised to. A promotion or a
translation that landed before identification is a surviving operator-authored copy the cut leaves standing,
and no widening of any predicate changes that; it must be slated by its own id. So the review carries a
`duplicates` set: per member, the records that link to it by a link the store can FOLLOW. It is an honest
partial — it finds links, never content — and it says so where it is printed.

### 29.6 The graveyard

What survives the cut is the erasure EVENT, not a second copy of the per-id law: one delta citing the slate,
the request record (who asked, when, why, the deadline), the frozen `version`, the window, the closure set
in force, the affected set, and the `prior-tombstone` pairs. It holds content addresses, and retaining a
hash retains zero content — §11's founding argument, reused.

**It CITES tombstones; it does not replace them.** The tombstone set is load-bearing at every door and must
remain the single per-id law, because two records of one fact is the exact failure pattern of 2026-07-21. So
the graveyard does not list its tombstones at all: **each tombstone minted by a cut carries a `slate`
pointer**, and "which tombstones belong to this graveyard" is a JOIN. That keeps the graveyard one small
delta whether the cut had four members or forty thousand, and it buys the arithmetic the receipt is made of:

> Every member of the frozen `version` has a surviving tombstone, and that tombstone either cites this
> slate or is named for that member in the graveyard's `prior-tombstone` list.

That is checkable at any later date from durable ground alone — no observation of the tiers, no memory of
the cut. It is the difference between a narrative and a proof.

**The clause after the comma is not a weakening; without it the proof is FALSE on cuts that SUCCEEDED.**
Two ordinary histories produce a member whose tombstone cannot cite this slate: an operator erasing one
member by hand mid-window, and a faulted cut whose re-run anchors on the tombstone the first attempt already
minted — minted before the `slate` pointer had a value to carry, and content addressing forbids adding a
pointer to an existing delta. In both, the simpler arithmetic computes FALSE on a cut that completed
correctly, which is indistinguishable from one that never finished. A proof that cannot tell success from
abandonment proves nothing, so the exception is ENUMERATED in the graveyard: a checker reads a closed list
of durable pairs rather than a heuristic about which tombstones look old.

**A forgiven member does not falsify it either, and the fix is not a weaker sentence but a second one.**
§29.8 makes forgiveness a tombstone strike, and a struck tombstone stops surviving, so the first lawful
forgiveness after a cut would flip the sentence to FALSE — again indistinguishable from an incomplete cut.
So the check answers separately: whether the sentence holds *literally* at a named moment, and whether the
CUT COMPLETED with every member accounted for as either a surviving covering tombstone or an ENUMERATED
forgiveness. One boolean holding both facts is the same collapse this section refuses for the byte verdict,
one layer up. And whether the frozen set could be READ at all is its own answer too: a walk that finds no
ids would otherwise report "every member is accounted for" vacuously, over a set the store can no longer
read.

**No §20 migration.** The `slate` role is added to NEWLY minted tombstones only; no delta any store already
holds changes bytes or roles, so §20 is not engaged. A tombstone with no `slate` pointer keeps binding at
both doors forever, and the shape is validated only when one is present.

### 29.7 The receipt — what is needed now, and what is deferred

**A receipt is an exported, operator-signed DOCUMENT, not a delta.** A receipt asserts something about the
WORLD AT A MOMENT — "no tier held these bytes at 12:03" — and a byte probe is not a function of the ground;
it is an observation of the tiers. Putting an observation into the ground is precisely the dry-run mistake
this whole design rejects: it goes stale, it cannot be re-derived, and a restored backup would make a
permanent delta into a permanent lie. What lands in the ground is the graveyard, durable and re-derivable.
What is exported is the receipt: derived from the graveyard, the tombstones and the frozen version, plus a
LIVE probe at the moment of issue, and **re-issuable at any time** — which is exactly §11's
testable-compliance promise.

**Two kinds of field, and a receipt must not mix them.** A HISTORY field — the window, the frozen version,
the request provenance, the tombstone ids, `prior-tombstone` — is a fact about what happened, and the cut's
report is a good source for it forever. A **per-tier byte verdict is an observation at a moment** and may
never be read from that report later: a formatter that reprints last month's snapshot as today's receipt is
the dry-run mistake wearing a letterhead. So the byte verdicts are marked non-authoritative for re-issue and
every re-issue RE-PROBES. The test for this is not a code inspection — resurface a byte after the cut, and
the re-derived verdict must FLIP while the stored copy does not.

A re-issue also **confesses what the cut was allowed to refuse.** The cut refuses on an unreachable store;
a re-issue cannot refuse, so it reports that tier as `unproven` rather than omitting it — an absent tier
reading as "not a tier" would be the same fail-open shape one level along.

And a re-issued receipt reports THREE live facts per member, because "forgiven" alone is the wrong sentence:
the tombstone's state, the re-probed bytes, and **whether the id is PRESENT in the ground again**. That third
fact is the one an obvious design loses. Striking a tombstone permits the id's return, and the federation
door then admits it because it is no longer dead; a receipt saying only FORGIVEN is technically true and
communicates the opposite of what happened, because the reader wants to know whether the data is there.

The receipt's non-claim section is printed beside the verdicts rather than as a footnote: peers are not
reached, already-served reads are not recalled, a copy re-spoken under another id still stands, pointers are
not content, a covered store was not swept, and a restored backup can resurface bytes — which is why the
document is re-issuable at all.

**The line between now and deferred, drawn on one principle: the DATA can never be reconstructed later; the
DOCUMENT can wait.** So everything above is built, including a structured report carrying every field a
receipt needs. The signed document's serialization and its CLI/HTTP surface are deferred: if the report is
complete, the receipt is a formatter; if it is not, no later work can reconstruct it.

### 29.8 Forgiveness, both sides of the cut

- **Before the cut, un-slating is FREE.** Strike the container declaration: the table is re-resolved live,
  so every closed door reopens on the next read, and not one byte moved. Narrowing a slate is a
  re-declaration with a re-frozen membership.
- **The request record stands unless it too is struck.** Someone asked; that is a fact, and §11 already
  holds that the store remembers who asked. Withdrawing the slate and withdrawing the request are two acts
  over two deltas, and no new vocabulary.
- **After the cut, forgiveness is §11's tombstone-strike, per id, and it does NOT un-purge.** Striking a
  tombstone permits the id's return; it cannot restore bytes nobody holds. The graveyard survives untouched
  — it records an event that happened, not a standing assertion about the present.
- **A forgiven id can COME BACK, and the store must be able to see that it did.** The strike removes the id
  from the tombstone set, so it leaves the byte-debt instrument entirely and the store reads clean — and the
  federation door will now admit it from a peer. All lawful, and all invisible, which is the problem: the
  one durable list of ids the store ever promised to forget is a graveyard's frozen `version`, and it is the
  only place a forgiven-and-returned id can be found. Hence §29.4's `forgiven` count, read from the
  graveyards rather than from the tombstones, and §29.7's present-again fact per member.

**Slates inside the operator's OWN replicas: the declaration crosses the edge, the enforcement does not, and
that is a decision.** A separate store shares the operator's seed, so a slate's declaration, its record and
its membership Term all cross as ordinary data and resolve inside as lawful operator-signed deltas. Nothing
inside enforces them, and nothing should: such a store is the operator's dry-run surface, not a door served
to anyone, so read closure inside it would suppress the very content the operator opened it to examine — the
same reasoning that keeps the operator's review read unnarrowed. What DOES cross is the byte question, and
that is handled where it belongs: egress closure keeps condemned deltas from being seeded in at all, §27.7's
guard and §29.5's refusal keep an unreachable one from being cut around silently, and §11's fan-out reaches
every attached store.

### 29.9 What this cannot do, said plainly

**Erasure does not reach peers**, and this design does not imply a reach it does not have. They are not the
operator's replicas, and a peer refuses a foreign operator's removal-order at its own door. Egress closure
stops FURTHER spread from this store during the window; it recalls nothing already pulled.

And there is **no notification transport in Loam**, so the notice is a READ rather than a push: the append
door's informative refusal for parties writing in, plus a slate listing the operator may expose for tenants
reading. Consequently the graveyard records the **AFFECTED SET** — the containers whose scope intersected
the condemned set at cut time — and never "who was notified," because the store cannot know a message was
received. That is the strongest claim it can actually make.

What a tenant may be told follows from the same honesty: the container and the affected entity or lens,
never the subject and never the reason. A tenant learns what will change in their view without learning
whose request caused it.

### 29.10 What this section does not decide

The signed receipt document's format and surface; whether ISSUING a receipt leaves a durable trace; a
store-level maximum on the window; lifting the closure lattice into `loam.container`'s knob vector (it waits
for a second consumer, and widening a general primitive for one preset is how a vocabulary acquires roles
nothing reads); transitive citation closure (refused on purpose); re-shaping the adoption record's primitive
`source-delta` encoding, which is closed at the predicate rather than at the bytes because changing the
bytes would be a §20 migration for one role; read closure INSIDE a container (decided against above, with
the reasoning rather than a gap); recovering a copy promoted or translated before the slate (outside the
frozen set by construction — surfaced at review, slated by its own id, never chased by content); cascade
policy, which is already a §11 caller's choice; whether a slate takes a `parent` edge (allowed,
unconstrained); and any change to how §11 erases a single delta outside a slate — `erase(id)` keeps its
exact behavior and its refusal voice, and a slate is the staged form beside it, never a replacement.

---

**Provenance.** **BUILT** as a four-piece stack — [#254](https://github.com/bombadil-labs/loam/pull/254)
(the vocabulary, the record, the readers), [#256](https://github.com/bombadil-labs/loam/pull/256) (the three
closures at their doors), [#259](https://github.com/bombadil-labs/loam/pull/259) (the cut and the graveyard),
[#262](https://github.com/bombadil-labs/loam/pull/262) (the receipt and forgiveness reporting) — realizing
ticket **T64**, 2026-07-26. `src/gateway/slate.ts` holds the vocabulary, both doors, every reader, the three
closures, the cut and the receipt; the closures reach the existing doors through `src/gateway/ingest.ts` (the
one cite predicate at both admission sites, and the one egress subtraction) and `src/gateway/reads.ts`
(`readGround` and its five named sites, plus the unnarrowed retraction gather). `src/gateway/erase.ts` gains
the optional tombstone `slate` join, the pinned-Term refusal, and health's `slates` and `forgiven` sections;
`src/gateway/container.ts` names its fault stores so a report can cite a tier without parsing a sentence.
Rails: `test/gateway/slate.test.ts`, `slate-doors.test.ts`, `slate-cut.test.ts`, `slate-translate.test.ts`,
`graveyard.test.ts`, `slate-receipt.test.ts` over the shared `slating.ts` fixture — 23 acceptance criteria,
every rail TWO-SIDED (the target gone AND a named live bystander surviving, at the bytes and through a
Schema), because a rail that only proves removal cannot see over-purging, which is the failure here with no
way back.

Three independent P5 lenses found ten confirmed defects, each fixed with its subject rather than railed
around; the worst was an over-purge channel — the condemned set pinned on a mutable declaration — and it is
why §29.1 pins on the record. The others worth naming here because they are shape rather than slip: a
read-closing slate turned a caller's own strike into a silent no-op; the cite predicate refused a NEGATION
and stranded it; and `translate`'s two batches ran in an order where a refused emission aborted the pass
before its retractions, reintroducing T58's bug from outside.

Rides §11 (the erasure this stages, whose single-delta behavior is unchanged), §7/§24/§27 (the boundaries the
operator reaches across, and the container primitive a slate IS), §26 (the as-of door the narrowing is
applied after), §27.2 (the frozen membership address), §27.7 (the completeness guard the pre-flight runs),
and §24.8 (the recursion warning the one egress site answers). Amends §11's promise from one instantaneous
act to two phases with a visible intermediate state.
