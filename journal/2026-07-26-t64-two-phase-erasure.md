# T64: the condemned set had to be pinned where nothing could move it

**Date:** 2026-07-26. **PRs:** #254, #256, #259, #262 (the four-piece stack), landing here. **Ticket:**
T64, archived. Supersedes #234, which was the same work in one 5k-line PR and unreadable as a P6 card.

**The decision that cost the most to find was one word of scope.** The design says a slate's membership
is FROZEN, and the working spec put the frozen pair — the published Term's address and the ModuleVersion
over its members — on the **container declaration**, which is where §27 already keeps them. That reads
correct and is not. `readContainerTable` resolves the membership address from the LATEST surviving
declaration; only `trust` and `posture` are pinned to the earliest. So one further operator-signed
declaration mid-window re-points the condemned set at a wider Term, with a self-consistent `version`, and
every door passes. The cut then destroys the widened set and the graveyard records the widened address —
so every receipt afterwards proves completeness over the set that was CUT rather than the set that was
IDENTIFIED. An over-purge channel with a paper trail that agrees with it.

Nobody found it by reading the code with the design in hand. **An independent P5 lens found it composing
four separately-innocent facts**, one of which was that the cut's own block labelled "RE-FREEZE AGREEMENT,
proven again" never called the agreement function at all, and that its set comparison was vacuous because
both sides read the same Term. That is the shape worth remembering: each fact defensible, the conjunction
fatal, and the comment asserting the property that was missing. The fix — pin on the RECORD, which is
content-addressed and therefore immutable, and have the door require the container to AGREE — is four
lines of vocabulary and it is why §29.1 is written the way it is.

**Two more from the same round, both H1 wearing new clothes.** A read-closing slate turned a caller's own
`clear` into a silent no-op: the retraction gathered over the NARROWED ground, so a read-closed member was
never a target, nothing was signed, and the door answered 200 while the field read absent — which is
exactly what read closure was already showing. Un-slate and the claim returns live and un-retracted. And
the cite predicate refused a NEGATION, which strands it: a batch refuses whole, so a `clear` over a field
with one slated contribution retracted none of the caller's others, and at the federation door the refusal
folded into a uniform count while union's idempotence meant the peer never resent. Both are the same
lesson: **a suppression window must never refuse the operations that REMOVE claims**, only the ones that
add dependents.

**Three lenses, ten confirmed findings, nothing refuted.** That is the highest yield this repo has seen
from P5 and it is worth pricing honestly: the findings were not carelessness, they were the parts of the
design that only become visible once the code exists. Two of them were rail defects the mutation gate then
confirmed independently — a clocks rail that could not go red for the bug in its own title (delta-time 40ms
ahead of a 600,000ms deadline), and a completeness check whose `members.length > 0` guard made "every member
accounted for" vacuously true over a set the store could no longer read.

**And the last survivor of the last mutation run was the best single argument for H10 this repo has.**
`graveyardClaims` writes `none` when the closure set is empty and writes the set out otherwise — a branch
on a COUNT. Every rail in the suite either cut a two-closure slate, which cannot tell `=== 0` from `=== 1`,
or cut a one-closure slate and never read the record back. So a one-closure cut could have recorded
`closes: none`: a permanent compliance record saying the slate closed NO doors when it closed one. The
corpus that cannot distinguish, in the durable record, on the piece whose whole subject is not overclaiming.

**On the process rather than the code.** Myk merged this arc card by card — vocabulary, closures, cut,
receipt — after refusing the single PR, and the decomposition was worth more than the reading time it
saved. Carving a green union into four layers that each compile and pass surfaced rail content the whole
had been hiding: assertions I had written against a reader when the door was what mattered, and door
assertions that had quietly become vacuous once their layer was isolated. **A stack is not just a smaller
read; it is a second pass over your own work at a different grain.** The one deviation from a byte-identical
union is a helper moved beside its only consumer, because the layer above it could not compile with it
unused — which is itself a small argument that the layering was real.
