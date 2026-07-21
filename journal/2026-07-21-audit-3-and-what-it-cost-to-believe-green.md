# Audit 3, and what it cost to believe a green bar

**2026-07-21** — audit 3 (four angles, thirteen findings); landings
[#153](https://github.com/bombadil-labs/loam/pull/153) (T40),
[#154](https://github.com/bombadil-labs/loam/pull/154) (T41); tickets T40–T47

One entry for one story: an audit, and the two tickets it produced that landed the same day. The
remaining six are queued.

## How it started

rhizomatic, answering an unrelated substrate question ([#27](https://github.com/bombadil-labs/rhizomatic/issues/27)),
mentioned in passing that `negated(d, D)` ranges over the OPERAND SET — suppression is a property of
the set being evaluated, not of the delta. They raised it about a hypothetical future migration.
Checking whether it applied to *shipped* code found that it did, in three places. That became T38,
and the pattern became the reason to unpause audits.

## What the audit found

Four angles — narrowing operations, presence-vs-survival, erasure reach, authority boundaries — all
drawn from bugs found hours earlier rather than from a generic checklist. Every angle landed. Two
findings were probed to certainty rather than argued:

- **A completed erasure left the plaintext recoverable from the sqlite file.** `secure_delete`
  defaults OFF, so `DELETE` unlinked the row while its content stayed legible in freelist pages.
  §11 promises zero bytes retained.
- **`migrate()` resurrected withdrawn operator law.** Every step re-signed without checking survival,
  so a withdrawn registration returned live, in the operator's voice, under a new id its retraction
  never named — turning a §17 410 into a 200, served anonymously if the lens had been declared public.

And the largest architectural hole was one **§24.8 had already written down as a build rule**: a
durable quarantine must be registered so the primary re-attaches it to the erasure fan-out at boot,
or erase must refuse to report completeness it cannot deliver. Neither half was built. That is T44.

## The learnings, which matter more than the list

**The gates verify conformance to the ticket. They cannot verify that the ticket is right.** Rails
are downstream of the spec, so a wrong premise produces *perfect rails around a real bug*. All three
negation-closure sites shipped green through P3, P4, P5 and P6. This is now written into CLAUDE.md
as the standing justification for auditing, so nobody re-pauses it on cost.

**Knowing the failure pattern does not prevent reproducing it.** The T40 diff audit — the first run
of the new standing rule — caught four things in the fix *I had just written*: a hollow rail (both
sqlite rails closed the store before scanning, and close runs its own checkpoint, so reverting the
fix left them green), a silently discarded `wal_checkpoint` return value (**hazard H7, violated hours
after I wrote H7**), pre-existing stores keeping the leak forever, and an uncovered partial-purge
case. That is the whole argument for the audit being structural rather than a matter of care, and it
is why the widened self-merge rule is gated on it.

**Assert at BOTH levels — delta and object (Myk).** The day produced the failure in both directions:
object-level said `get(id)` was undefined while the bytes sat in the file (T40); delta-level said the
right deltas crossed while a reader saw a retracted claim as live (T15/T38). Choosing one leaves the
other open. Note the middle is not the top — `reactor.negationsOf(...)` is still delta-level
structure; the object question is what a **View** contains and what a **door** answers.

**Writing the object-level assertion exposed a fake fixture.** T41's delta rails were green over a
fixture that forges bare definitions with no registration, so the store binds nothing and
`readRegistrations` finds nothing. The rails tested what they claimed and could not speak to the
consequence the ticket was about. The rail is committed skipped, with what it needs to pass, rather
than deleted.

**A one-link rule twenty lines from a transitive one is a bug, not a style wart.** T41's audit found
`readingMap` keeping its own weaker survival check: retract a binding, retract the retraction, and it
is live by the real rule and struck by the weak one — the parent definition then silently not
migrated, permanently unresolvable, step reporting nothing. One survival rule per file.

## Process changes made today

- **Audits are standing** — after every piece of major work, at the retro shape (3–4 angles over the
  tree after an arc, 1–2 scoped to the diff after a ticket; no verify stage; a clean result is valid).
- **Self-merge widened** — the reserved-surface bar is gone; the test is now *repair vs decide*, and
  a clean audit is what earns it.
- **Rails assert both levels**, with the gap named in the file when one is genuinely out of scope.
- Two new hazards: **H6** (a program name is not a lens name — since §21.7 coexistence, gating a door
  on `hyperschema.name` authorizes every reading over that program) and **H7** (an idempotence
  short-circuit must prove it actually landed something — `publish` had this, `promote` still does).
