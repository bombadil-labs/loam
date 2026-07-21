# §28 drafted: trust becomes a tree

**2026-07-21** — ticket T36, [rhizomatic#27](https://github.com/bombadil-labs/rhizomatic/issues/27)

The design stage of T36, written whole as `spec/28-container-trust.md`. Nothing built; it awaits Myk's
merge (P6), which it needs regardless of quality because it lands on capability, federation, and tenancy
surface at once.

The section says one thing: **trust is a property of a container.** A store is the root container, so the
operator's trust was never a special kind of trust — it is the root's. Tenants are containers within it.
Containers nest, so trust nests, and §7's undeliverable "authority real at one depth, inert at another"
becomes a tree with a declaration at each node.

## The correction the section is built on

The first version of the rule was intersection-only: a child may narrow its parent's trust, never widen
it, argued from an escalation case. Myk broke it in one move — a tenant who wants to follow a federated
source must then get the operator to trust that source *at the root*, where it binds for everyone. Every
legitimate downstream need becomes upward pressure toward `open`. The rule meant to prevent escalation
would manufacture it, one reasonable request at a time.

The fix was not a weaker rule. It was noticing that "trust" was doing two jobs:

- **Admission** (may these bytes enter?) — **delegates downward freely.**
- **Binding** (does this law have force?) — **attenuates**, crossing upward only by promotion.

§8/§12's inert-by-default already separated these; the draft had collapsed them and applied the right rule
to the wrong axis. Once split, the shape is recognizable: **a child container is a quarantine relative to
its parent.** §24, one level down. A design that turns out to be an existing design at a different depth
is usually right.

## Two things that stopped being choices

- **The trust knob determines the boundary knob.** A container admitting what its parent doesn't trust
  must be a *wall*, because a child that were merely a scope over shared ground would put the stranger's
  bytes in the parent's store — on her disk, in her backups, inside her erasure obligations. §24.1's
  argument and the copy-knob framing arrive at the same rule from opposite directions.
- **The operator's stake is nameable**: not "I vouch for your sources" but **"I can forget, and I cap the
  bill."** Erasure reach (built, #109) and the resource envelope (T34). That re-priced T34 from a
  hardening slice to a prerequisite — without an envelope, delegated admission is an unbounded bill on
  someone else's say-so.

## The ratchet

Myk's ruling: posture is per-tenant configurable, **walls by default**. The reason is an asymmetry that
inverts the usual start-cheap instinct. Wall → property is cheap and in-place. Property → wall is not
achievable in place *at all*: erasing from the root would have the tombstone assert a byte was forgotten
while it is deliberately retained elsewhere (§24.8's prohibition from the inside, and the record would be
lying); keeping both copies is duplication in a wall costume; and the only honest route is re-provisioning
the store.

Generalized past tenancy: **you cannot retroactively achieve isolation over grow-only shared ground.** A
wall's value comes from the bytes never having been commingled.

It also settled a live drift between CLAUDE.md ("tenant isolation is first-class") and §7 ("not write
fences") without either being wrong — the first is now the default, the second the opt-in posture.

## What the substrate conversation changed

Filing rhizomatic#27 as "enhancement with a known workaround, and option 3 is a real outcome" got a much
better answer than a yes/no, and two things came back that changed the draft:

1. **A second sanctioned route I didn't know existed.** SPEC-2 §3 already says general cross-delta logic
   belongs at L7 — a derived author computes the closure and asserts it as deltas a lens then reads with a
   plain depth-1 `inView`. So the choice isn't "live lens or flatten"; it's a real tradeoff between
   freshness and provenance. §28 takes **both**: host-flatten on the binding path, derived author as the
   audit path, because route (b) carries one derivation hop of lag and §7 already promises *"revoking a
   grant un-binds its author's strikes on the very next read."* Binding on (b) would silently regress a
   stated guarantee, and the regression would look well-formed.

2. **I had to retract a claim I'd used to justify my own preference.** Part of their case for route (b)
   rested on the failure mode I named when filing — a host that forgets and reads a stale trusted set.
   That mode only exists *if the host caches*. Compute per request, never store, and staleness is
   structurally impossible rather than merely detectable. So §28 specifies **the absence of a cache, not a
   detector**, and says so explicitly so a later optimization doesn't helpfully re-open a closed hole.

They also warned that `expand.reading` lives in the gather body, so sibling lenses over one HyperSchema
share a child's reading — potentially making per-tenant readings inexpressible, and possibly making
tenancy the consumer for an unbuilt escape hatch. The walls-by-default ruling had defused it hours
earlier: a wall tenant has its own store and its own bodies, so it was never sharing one. Confirmation is
outstanding.

## Learnings

**When a rule breaks on a counterexample, check whether a word is overloaded before weakening the rule.**
Softening the intersection rule would have produced a worse design than splitting "trust" into admission
and binding. The counterexample wasn't evidence the rule was too strong; it was evidence the rule was
about the wrong thing.

**File substrate issues with the "do nothing" option named as genuinely acceptable.** It got a
substantive engineering answer instead of a defensive one, including a route the filing side didn't know
about. Naming option 3 as real rather than polite is what made the reply useful.

**Retract your own arguments out loud when they weaken.** The staleness worry was overstated at filing
time, and the other side was weighting a decision on it. Saying so cost nothing and improved the answer —
and it turned into a design rule (no cache) rather than a mechanism (a detector).
