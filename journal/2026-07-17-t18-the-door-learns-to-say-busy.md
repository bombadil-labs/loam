## 2026-07-17 — T18: the door learns to say busy, and the type keeps its word

The last two audit-2 findings, closed as one small ticket
([#133](https://github.com/bombadil-labs/loam/pull/133)) — and with them, **the backlog is empty**
for the first time since the arc began.

**The render cap.** Every anonymous render spawns a worker thread with a ~160MB ceiling, and
nothing bounded how many at once — the codebase's own `maxPublicStreams` said this should never
have been true. Now `maxPublicRenders` (default 16) applies the same discipline to the strictly
more expensive resource: the slot is acquired only around the worker execution (every free refusal
stays free), released in `finally` (the leak-the-slot rail runs cap+1 sequentially), and the
refusal is a 503 that names nothing. Public-door-scoped, following the SSE precedent — the village
act stages the crowd: six readers, two served, four clean busies, every slot returned, the
operator's door untouched.

**The type that binds.** §22.6 promised the declared output type kept the two-doors-agree
invariant, and nothing enforced it — a resolver declaring `string` and returning an object made
GraphQL null-with-error while REST emitted the object verbatim. The fix is one validator at the
apply seam, where every door inherits it, and the decided semantics were the ticket's best
sentence: **a mismatch does exactly what a throwing resolver already does.** The rails assert that
equivalence literally — mismatch ≡ throw, at both doors — and record the honest residual: each
door serializes the *fallback* through its own contract (GraphQL's declared String coerces, REST
emits raw), an asymmetry that pre-exists for throwing resolvers and was deliberately not widened
here.

Seven rails (the concurrency, release, under-cap, cross-door, equivalence, valid-types, and
blast-radius cases), 654 tests, the village at 31 acts fresh. The queue is bare; what remains
named-but-unauthored is Myk's to prioritize: promote-LAW, endorse-import, the fork/PR demo,
durable-pool boot registration, the §27 manifest design pass, VersionedHyperSchema, and the §20
migration-resurrection LOW.
