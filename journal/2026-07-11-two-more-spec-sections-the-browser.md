## 2026-07-11 — Two more SPEC sections: the browser peer (§15) and the tutorial (§16)

Design, no code — the spec now carries the two things that set up the real ship. Grounded in two
Explore audits + two Plan designs against the real tree; §17 is the glossary (renumbered from 15).

**§15 — the browser peer.** A full `Gateway` on a new `LocalStorageBackend`, bundled for the page
as `@bombadil/loam/browser`, exactly the way `./client` already ships (second esbuild entry, the
same `node:http` stub alias, the same zero-`node:` pin, plus a "must boot inside the artifact"
check). The audit is the load-bearing fact: the whole gateway/federation/runner surface is already
browser-clean (zero node builtins; `graphql` is pure JS), and rhizomatic's only node edge is its
re-exported peer transport, already neutralized. So this is not a port — §8's seam always made the
store a driver's business; the browser peer is the same gateway on a different driver. Design
calls worth keeping: one key per delta (`loam:<store>:<id>`) not a blob (append O(batch), purge is
`removeItem`, two handles converge by union, devtools shows the facts one per row); seed at its own
key so no delta export ever carries key material; quota-exceeded rolls back the batch and latches
the existing "can no longer persist" degradation; and the honest hard limit — a browser cannot
listen, so it PULLs and PUSHes-via-`/append` but can never BE pulled (leaf or aggregator, never a
hub). Continuity is the payoff: an export is a frozen `/federate` offer, and importing it under the
SAME operator seed makes the local store the same store by content address — the operator marker is
the identical delta, so the browser-authored law BINDS on arrival. One new CLI verb carries both
sources: `loam pull <url|file>`, through `Gateway.federate`.

**§16 — the tutorial.** A GitHub Pages static site that hands a stranger a real in-page store and
teaches by DOING — every completion check is a real read of their store, never a quiz. Myk's
steer, taken as a first-class acceptance bar: **it stands alone.** A visitor has never seen the
village and never will; the cast and narrative are the tutorial's own (Alice, Bob, a
self-explanatory adversary), every concept from zero, nothing installed until the finale. The
village survives only as internal de-risking (the arc reprises shapes it already proves), never
named on the site. Domain (Myk's, refined): TWO stores — a learner-owned MEDIA log (films/books,
watches-with-guests) and a bundled foreign CIRCLE (Alice/Bob/friends). The guest reference is the
federation hinge: `person:alice` is a bare id until you pull the store that knows Alice. Eleven
lessons across four acts walk genesis → signed facts → gather/resolve → multi-pointer writes →
retraction/absence (§14) → evolution → trust-vs-adversary → erasure (§11) → federation → the open
door (§12) → the finale (`npm i -g`, `loam init --seed` + `loam pull`, `loam serve`, and the page
matches `_hex` hash-for-hash — the same store, on your machine). The finale carries the seed in the
export ON PURPOSE — disposable tutorial data, and the point is to SEE the transit prove
content-addressed identity; the site states plainly (as §15 does) that real data keeps its seed in
the user's custody. Anti-rot is a test: `test/site/arc.test.ts` drives every lesson headless in
order, including the export→import→`_hex`-match round trip, pinning the finale's claim in CI.

Learnings worth keeping: (1) the client-bundle esbuild trick generalizes cleanly to a second
"store-sized" bundle — the browser surface was designed browser-clean all along, we just never
shipped an entry for it; (2) "stands alone" is a WRITING bar, not a code bar — the temptation to
lean on the village's proven narrative is exactly the trap, because the audience is a cold visitor;
(3) the two-store domain makes federation fall out of the domain instead of being staged, which is
the difference between a demo that explains federation and one that makes you feel it.
