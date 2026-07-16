## 2026-07-16 — Audit 2: the composed system, four angles, one HIGH

The audit pause expired by its own terms (Myk, 2026-07-09: "no further audit panels until the arc and its
landings are done") — the arc landed this morning, and Myk asked for a sweep before the next lift, honest
that he had not deep-read the week. Run in exactly the shape audit-1's retro prescribed: **four
tightly-scoped finder angles, findings capped per angle, NO separate verify stage** (the finders were
already precise; the fixer verifies while fixing). ~640k subagent tokens, four angles: the erasure law
end-to-end, the stranger at the doors, executable code at rest, spec-vs-code honesty.

**It earned its keep on one finding.** A pool with trust mode `closed` silently evades erasure: the
fan-out lands its tombstone via `federate` with no admit override, so the pool's own trust policy
applies — and `closed` admits nothing, *deliberately including the operator's own deltas*. The tombstone
is refused, `eraseReplica`'s guard sees no tombstone and takes its SILENT RETURN branch, and `erase()`
resolves cleanly while the forgotten byte lives on. It contradicts spec/24's own residual note, which
promises the fan-out is "best-effort-and-LOUD." Two MEDs ride with it (nested pools are outside the
fan-out; a selective `admit` drops pre-existing tombstones at seeding, so federation replay can re-admit
purged bytes) and one LOW (migration re-expresses erased content under a fresh id — a §20 surface,
deferred with its own named ticket-to-be).

**Why per-PR review could not have caught it, and what that means for the gates.** The HIGH exists only
at the intersection of trust policy (§8), quarantine pools (§24), and erasure (§11) — three PRs, three
diffs, each correct in isolation. The per-PR panels this week were good and caught real things (the
vN-pin slide, the forged-tombstone purge); they are structurally blind to composition. That is the
argument for the periodic audit surviving as an institution, not the argument against the panels: **the
panel reviews a diff; the audit reviews a system.** Budget them differently and expect different bugs.

The other three angles: the doors came back substantially clean (uniform anonymous refusals hold; both
write gates fire independently; every undeclared `@hash` stays 404 — three LOWs, all on already-declared
routes). Executable-code-at-rest verified clean on the sharp parts (no data-URL breakout, content-address
keying, the timeout genuinely cannot wedge the loop, no authority crosses postMessage) with two MEDs: the
anonymous render fan is uncapped while the sibling SSE door caps at `maxPublicStreams`, and a resolver's
declared `type` never binds — so a mistyped return makes GraphQL null-with-error while REST emits the
object, breaking the very §17 two-doors-agree invariant §22.6's provenance advertises. Honesty found NO
case of the spec claiming a guard the code lacks (the dangerous direction is clean) — only understating
drift: SPEC.md's index still calls §23 unbuilt and §24 in flight, and one hollow rail (the memory bound
asserts only a 500 the timeout alone produces).

**The doctrine, now stated three times in three weeks — A FAN-OUT MUST RE-DERIVE ITS OWN REACH.** The
purge re-checks the tombstone (slice 1's catch); promotion re-checks the shape, the closure, and the id
(#111's catch); now the fan-out must re-check that it actually reached every replica. Every one was the
same bug: trusting a condition a caller or a config implied instead of deriving it from what is recorded.
Three instances is a defense, not a coincidence — this is what P7 distill is for.

Authored T16 (the fan-out unit — HIGH + two MED, one ticket because they are one mistake), T17 (the
honesty sweep), T18 (the two executable-code MEDs). **`coldstart --prompt-only` earned its keep at P0**:
it caught that T16 asserted both "throw if the tombstone did not land" and "the forged-tombstone rail is
unchanged" — in tension, since after the admit override the only non-landing cause IS a forgery. The
ticket now DECIDES the split (unlawful → refuse without purging; lawful-but-unlanded → throw) instead of
leaving a builder to guess. It also caught a DoD I could not have met: "show the operator being told when
a pool cannot honor it" has no honest village staging once trust-refusal stops being a cause. Both fixed
before the ticket shipped. `merge-forecast`: width 1, and its order is a scope heuristic — the HIGH says
build T16 first.

**Process learning (the classifier).** The synthesis step tripped a content classifier — not the finder
prompts, which were already in CLAUDE.md's neutral correctness register, but the AGGREGATE: four reports'
worth of attack-shaped prose landing in one context at once. The finders were fine; the pile was not. Next
audit: synthesize incrementally, one angle at a time, rather than collecting four reports and reasoning
over the heap. Adding that to the retro alongside "no verify stage."
