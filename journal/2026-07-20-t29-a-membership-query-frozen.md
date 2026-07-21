# T29: a membership query, frozen and named

**2026-07-20** — [PR #152](https://github.com/bombadil-labs/loam/pull/152)

§27.6's question 2, closed at rung 2. `Gateway.freeze(term)` evaluates a membership Term once and
names the result: a `ModuleVersion` of `{ id, members }`, the id a content address over the members.
`select` reads the container as it is, `watch` follows it, `freeze` mints the version you ship — the
same ladder, third rung, and the code says so by living beside the other two.

§27.2 had already decided the property that carries everything: the address is **order-free**,
because the members are a CRDT set. What was open was only which rung of the §22.3/§23.10 economics
ladder to stand on. Rung 2 — a hash over the sorted member ids — because rung 3 (the Merkle-set)
buys exactly one thing over it, incremental sharing, and nothing in the arc consumes that yet:
reference-load pulls by federation, merge-load re-signs, and neither one diffs two versions to find
the delta. The deferral is cheap to reverse because the id is opaque behind one helper.

## What was learned

**A ticket that names its own build order is worth more than a ticket that names its own solution.**
The three coldstart gaps this arc's authoring turned up were each worth more than the tickets they
were found in: `loam:container` does not exist anywhere in the tree, so T32 has to *mint* reserved
vocabulary (with everything CLAUDE.md's shape-distinguishability corollary implies); §24.7's prose
describes "the stock React host (§23.2)" which is a component Loam never built, since §23.2 is the
host *contract* and the serving path is `serveRouteImpl`; and T34's isolation rail was an adjective
("does not degrade the primary") where it needed a measurable bound. None of those were visible from
the spec alone — they came from checking whether the scope paths a ticket names actually exist. That
check is cheap and should be routine before a ticket is called executable.

**A rail can go green on the absence of the thing it tests.** The refusal rail here first passed
because `gw.freeze is not a function` throws, and `.toThrow()` does not care why. It was a hollow
test in the most literal sense — green before a line of the implementation existed. The fix was to
stop asserting *that* something threw and start asserting an **equivalence**: freeze and select
agree, both refusing with the same voice or both admitting over the same members. A rail comparing
two independently-reached answers cannot pass by accident, which is the general shape worth reaching
for whenever a single-sided assertion feels thin.

**The village earns its keep as a second reader.** `hollow-test` reported three surviving mutants in
`phase-membership.mjs` — not a coverage gap, since vitest does not run the village, but a useful
reminder that the demo's checks are load-bearing prose that no unit run defends. They are defended
by running the village, which is why the ledger records a count.

## Left on the table, deliberately

A `ModuleVersion` holds its members as in-memory `Delta` objects — safe here, because that is exactly
what `select` already hands a caller and nothing is persisted. The moment anything *stores* a
version, that changes: a stored member list must be re-read against the living ground rather than
kept as a byte copy, or an erased member (§11/§24.8) would survive inside it. Rather than leave that
in a reviewer's head, it went into T30's body, where the first thing that persists a version will
have to answer it.
