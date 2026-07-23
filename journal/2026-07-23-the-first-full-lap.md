# The first full lap, and what independence actually costs

**2026-07-23.** T67 — a live erasure leak on `main` — run as a complete ADLC lap
on purpose, to exercise the machinery this repo had documented and never run.
The bug is small. The lap is the point, and it went differently than expected.

## The scoreboard

Ten confirmed defects, across three prosecution rounds:

| round | when | found |
|---|---|---|
| `adversarial-review` on the working spec | before any code | 3 |
| routed lenses + `hollow-test` on the diff | after implementation | 3 |
| `adversarial-review --verify` on the FIXED diff | after the fixes | 4 |

The last row is the one worth staring at. **Three of those four were defects
introduced while fixing the first six.** Re-prosecuting after a fixup is not
bookkeeping — it found the worst bug of the night, and it found it in code
written by someone who had just spent hours thinking about exactly this hazard.

The design-stage round matters differently. It caught a flaw no rail could ever
have caught, because the rails were downstream of the same wrong premise: the
proposed fix would have made `erase` reject correctly and then **stranded the
erasure permanently**, because `eraseImpl` guards on `reactor.get(id)` before
the tombstone lookup, and a partial attempt re-seats the target out of the
reactor. The operator does exactly what the error instructs, and hits *"nothing
to erase."* No invocation of `erase` could ever finish that sweep. The existing
leak is what masks the trap; fixing the leak creates it.

## The gates, and which ones were ever red

A gate never seen red has proven nothing, so each was made to fail first.
`spec-lint` exited 2 on a line-wrap beginning with `MUST` (the parser splits it
into its own criterion and truncates the bullet). `rails-guard` exited 2 on an
edited frozen rail. Nine revert probes turned specific rails red — run, not
reasoned about, which mattered: **one of the two headline rails was hollow**,
and only the probe revealed it. Its fixture purged through the mirror pair
before calling `erase`, consuming the very condition it existed to create, so
the pre-fix code threw for an unrelated reason and the rail was green against
the bug it was written for.

## `adversarial-review` runs here now

Three stacked blockers, each invisible until the one above it cleared. The
documented Windows argv limit was real and gone on Linux. Beneath it: the
`claude` on `PATH` was the **Windows install reached through WSL interop**,
v1.0.51 — it answers `--version` perfectly and cannot take stdin. Beneath that:
a 120s default timeout that a real review exceeds. Every one of the three reads
as *"the tool ran and had nothing to say."* CLAUDE.md now records all three.

## What the rail backstop was actually doing

Declaring T67's rails made the CI gate live for the first time — and it
immediately failed the PR that declared them, because a ticket earns rails at P3
by writing tests, and those tests usually land in a suite that already exists.
Fixing that led somewhere worse: **a rail's freeze evaporates the moment its
ticket lands.** The wrapper reads declarations from the ticket store, and P6
deletes the ticket. So a rail is frozen only while its work is unfinished, and
goes unguarded forever exactly when it starts protecting a bug already paid for.
Verified: `ticket-archive/` empty, landed tickets gone from the store, and not
one ticket on `main` declaring a single rail. The gate has been a structural
no-op for its entire life (T69).

That file is on ADLC's exact trust-root list, so fixing it demands a cross-model
approve this box cannot produce — the gate correctly refusing same-model review
of a change to the enforcement layer itself. It was reverted out of T67 and
given its own ticket.

## Two refusals worth recording

I tried to narrow T67's rail set to make its build green. The gate answered
`AUTHORIZATION_REQUIRED: rail-narrowing` and it was right: narrowing rails to
pass your own build is precisely the motive that guard exists to resist. The
rule is to stack the PRs and say so.

And `flail-check` was not recorded, because it wants a session log this harness
does not produce. Recording a pass nobody earned is H7 at the process layer —
the hazard this very ticket exists to delete.

## The lesson, stated plainly

The repo's governing principle held under test: **the system catches mistakes;
the model does not avoid them.** Every round of independent review found real
defects in code that had just survived the previous round. Not one was caught by
care, a sharper prompt, or knowing the hazard — H9 was written in the same
session that violated it three times. Independence is the active ingredient, and
its cost is that you have to keep paying it after you think you are done.
