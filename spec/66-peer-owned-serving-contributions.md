# §66 — Each peer owns the rows it contributes to a read

A gateway's reactor is a view of its admitted journal. Refresh reconciles additions and removals,
including a replacement that leaves the row count unchanged. Removal rebuilds the reactor and its
derived views, ends old watches, and refolds registrations. The rebuild reconciles the complete
admitted set again across awaited stream teardown, so a row removed during that window stays gone.
A failed rebuild remains a failure until a later complete reconciliation succeeds.

## Preparation belongs to the peer

`prepareRead()` refreshes this peer, then asks its attached children to prepare their own sources.
The ordinary GraphQL query and subscription doors, listing and renderer route preparation call it
before serving. A child source that cannot be prepared fails the read; the parent does not answer
from a cached child reactor instead. This preparation currently reaches every attached child and
can therefore fail an ordinary read because an attached child is unavailable. It does not promise
one atomic snapshot across several independently writable journals.

After its children prepare successfully, the parent refolds its own dependent surface. A withdrawn
child channel binding leaves the parent's cached surface too. A failed parent refold aborts the
read; the next preparation retries it even when all journal heads are unchanged.

An explicit `reconcileLaw` preparation also replays the peer's registrations and loads its approved
resolvers. Federation blessing and curse/lift use that owned reconciliation before the parent
replays its surface. Failures remain visible. The peer interface replaces the separate preload and
replay capabilities with preparation and contribution; it remains at 28 capabilities.

## Serving composition receives approved testimony

`readContribution(now, options)` applies the peer's own read closures and erasures before returning
rows. An inbox applies its own present owner/acting-key filter at the captured `now`. Historical
`asOf` filters testimony timestamps separately; it does not move present admission authority or
reopen a current read closure. The contribution includes approved strikes needed for forward
negation closure, and target IDs withheld because serving them without a withheld strike would
revive what that strike suppressed.

Serving scope composes those contributions and then applies the parent's scope, exclusions and
read restrictions. It closes suppression over approved testimony, including chains whose next
link lives in another contributing peer. It does not reinsert closed strike bytes from a raw
reactor. A peer visited only to compute exclusion contributes no strikes or suppression to the
union. Raw membership IDs still drive subtraction, so closing a row's read door cannot weaken an
existing exclusion.

Current suppression links are carried as ID metadata separately from historically eligible rows
and strikes. An `asOf` before a chain was spoken does not reopen a current read closure, and following
that conservative closure does not insert later strike bytes into the historical answer.

A child's own erasure applies to its own contributed copy. It does not acquire authority over an
independent copy admitted by another peer, even when the content ID and author agree. Only the
withheld-strike target closure crosses this boundary to preserve suppression. The parent's own
erasure and scope restrictions can further narrow the composed answer.

Bound queries and listings, and channel-prefixed queries, use this serving scope. Bound and channel
subscriptions remain refused by their existing contracts; this slice does not invent a maintained
view over composed peer sources.

A standing channel whose prefix is explicitly unreadable keeps only its current child law in
candidate folds, fenced by the same structural channel-name fallback used by the read refusal.
This preserves the requested channel's diagnostic after a child journal refresh; it does not
preserve withdrawn bindings or supply a replacement serving ground. Candidate and contest folds
use the same fence. Unrelated malformed channels do not prevent a native read.

Named mutation hooks and GraphQL templates check source legibility before signing, and listing
checks before declaring its backing law. A refusal therefore leaves the admitted journal unchanged.
The optional surface `assertSource` hook supplies this guard to generators; native named mutation
methods also enforce it. Generic raw `_claim` has no channel lens and keeps its existing admission
contract. Healthy channel and native mutations retain their existing behavior.

## Membership is a separate question

`select`, `containerScope`, `connectionScope`, container members and freeze retain their raw
membership contracts. Retraction, slate identification and cut must see what they operate on;
applying a serving closure there would make a slate invalidate its own frozen set. A read-closed
row can remain a raw member and keep its frozen version while it is absent from a served answer.
Raw membership is not an authorization result for a user.

The serving path currently walks source rows and approved strikes on demand. It does not provide
incremental composed materialization or a portable HyperView artifact; those require a separate
contract for source identity, closure, time, invalidation and lifecycle.

**Provenance.** Admitted refresh and teardown reconciliation:
[#683](https://github.com/bombadil-labs/loam/pull/683). Peer-owned serving contributions: [#685](https://github.com/bombadil-labs/loam/pull/685). Implementation: `src/gateway/ingest.ts`, `src/gateway/gateway.ts`,
`src/gateway/read-contribution.ts`, `src/gateway/container.ts` and the serving readers. Proof:
`test/gateway/admitted-refresh.test.ts`, `test/gateway/peer-read-contribution.test.ts`, and the
existing federation blessing/curse suites.
