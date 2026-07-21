## 28. Trust is a property of a container

§8 made trust DATA — one declaration at `loam:trust`, resolved from the live deltas, so a roster edit is
a delta and never a restart. §7 made tenancy data too. But the two never met: trust was a **scalar with
exactly one holder** (the operator, store-wide), and a tenant was an author-community with read lenses and
no trust of its own. §7 noticed the seam and deferred it — *"per-tenant admin chains still mint
community-vocabulary grants while constitutional strikes require store standing — revisit with
trust-is-data (step 13)."* Trust-is-data landed. This section is the revisit.

The answer is not "trust is per-operator" and not "trust is per-tenant." It is:

> **Trust is a property of a CONTAINER.**

A store IS a container — the degenerate one, §27.1's vector with every knob at its trivial setting
(membership `input`, live, curated, no boundary). So the operator's trust was never a special kind of
trust; it is simply the **root container's** trust. Tenants are containers within it, each carrying their
own. Containers nest, so trust nests, and the thing §7 could not express — authority that is real at one
depth and inert at another — is just a tree with a declaration at each node.

This collapses four questions into one primitive, and it makes §27.1's trust knob mean something precise
instead of gesturing at the operator.

### 28.1 The two axes — admission delegates downward, effectiveness attenuates upward

Everything here depends on separating two things the word "trust" has been doing at once. Conflating them
produces a design that looks safe and is unusable; the failure is worth recording, because it is not
obvious until someone builds the counterexample.

- **ADMISSION** — *may these bytes ENTER this container?* This is what `loam:trust`'s `open` / `roster` /
  `closed` actually governs: the federation door.
- **BINDING (effectiveness)** — *does law in these bytes have FORCE?* This is inert-by-default (§8/§12):
  foreign law binds nothing until blessed.

The rules are opposite, and each is opposite for a reason:

> **Admission delegates downward freely. Effectiveness attenuates.**

**Why admission must delegate.** Suppose it did not — suppose a child container could only admit what its
parent already trusts, so trust narrowed by intersection down the tree. Then a tenant who wants to follow
a federated source must first persuade the operator to trust that source *at the root*, where it would
bind for everyone. Every legitimate downstream need becomes upward pressure toward `open`. The rule
intended to prevent escalation would manufacture it, one reasonable request at a time. So: **Bob may admit
into Bob's container what Alice has never heard of**, and Alice's roster feels no pressure, because Bob's
container is a distinct scope and Alice's ground is untouched.

**Why effectiveness must not.** Law admitted into a child binds **within that child at most**. It reaches
the parent only by PROMOTION (§24.3's adoption-merge — the operator re-signs it as their own claim with a
`loam.adoption` record, built in [#111](https://github.com/bombadil-labs/loam/pull/111)). Nothing a child
admits can bind upward on its own, ever. Authority never rides in on data (§6), and a child's admission
decision is data as far as the parent is concerned.

### 28.2 A child container is a quarantine relative to its parent

Look at what §28.1 describes and it is something already built: *a place where untrusted law may bind —
inside, and nowhere else — with promotion as the only crossing.* That is §24, verbatim, one level down.

This is the strongest evidence the framing is right. §24 was designed for one specific situation (running
a stranger's app behind glass) and turns out to be the general shape of *any* parent-child container
relation. The quarantine was never a feature; it was this section's special case, discovered early.

So the whole §24 apparatus applies at every depth, and should be read that way: the one-way glass is the
admission boundary, the sequestered writes are effectiveness attenuating, promotion is the crossing, and
drop is what a container's parent may always do.

### 28.3 The trust knob determines the boundary knob

§27.1 said exclusion is "a SPECTRUM keyed on trust" — a property for your own containers, a wall for
untrusted foreign law. Under §28.1 that stops being a judgement call and becomes a **derivation**:

> **A container that admits what its parent does not trust MUST be a WALL (a separate store).
> A container that only narrows its parent's trust MAY be a PROPERTY (a flag over shared ground).**

The argument is an escalation that would otherwise arrive by the back door. Suppose Bob's container were
merely a **scope** — a membership query over Alice's shared ground, with exclusion as a claim. Bob admits
Mallory's deltas. Where do the bytes go? Into Alice's store, because there is no other store. They are
excluded from Alice's default read, but they are *in her ground*: on her disk, in her backups, inside her
erasure obligations, and reachable by any query that widens the scope. Bob's local decision has silently
placed a stranger's bytes in Alice's store.

**The wall is what makes delegated admission safe.** It is not a security posture chosen for feel; it is
the storage consequence of allowing a child to decide admission for itself. This is §24.1's
"you-cannot-discard-a-mark" argument and the copy-knob framing (a curated container is pointer
arrangement; an untrusted one is a separate arena) arriving at the same rule from two directions, which is
usually a sign the rule is real.

### 28.4 The ratchet — you cannot retroactively isolate grow-only ground

The posture is a **per-container choice** (tenant A a wall, tenant B a property, in one instance — they
compose fine on read). But the choice is not symmetric, and the asymmetry inverts the usual
start-cheap-and-harden-later instinct. This subsection exists so nobody discovers that at 2am.

**Wall → property is cheap, in-place, and deliberate.** Federate the wall's deltas into the root, where
the root's admission applies — so the operator must actually admit those authors. That cost is *correct*:
dissolving a wall IS the escalation case of §28.3, and it should require a decision rather than a flag.

**Property → wall is not achievable in place at all.** The ground is grow-only and the deltas are already
commingled. There are exactly three routes, and two of them are dishonest:

1. **Copy out, then erase from the root.** The tombstone would assert the byte was forgotten while it is
   deliberately retained in the tenant's new backend. That is §24.8's own prohibition arriving from the
   inside, and **the record would be lying** — the one thing erasure may never do.
2. **Copy out and keep it in the root, excluded.** The bytes now exist in both places: duplication wearing
   a wall costume, failing the discard-with-zero-trace test that motivated walls in the first place.
3. **Re-provision the store.** Build a fresh backend holding everything except tenant T, and a second
   holding T; the old store ceases to exist. No tombstone lies, because nothing claims to have forgotten
   anything.

Only (3) is honest, and it is an **operational migration, not an operation**.

The general statement, because it reaches past tenancy:

> **You cannot retroactively achieve isolation over grow-only shared ground.** A wall's value comes from
> the bytes never having been commingled. Once they have been, no in-place act recovers it.

**Therefore walls are the DEFAULT, and property is opt-in** (DECIDED — Myk, 2026-07-21) for tenants known
to share a trust domain: same org, same team, internal partitioning. Not because isolation is always
needed, but because of the direction of travel. *"We thought we didn't need isolation, then a customer
asked for it"* is the overwhelmingly likely transition, and it is the one that costs a re-provision; its
reverse costs an afternoon. **Default to the reversible choice.**

This also settles a drift between two of Loam's own documents, and settles it in the right direction:
CLAUDE.md's standing decision that *"tenant isolation is first-class"* becomes the **default** and
therefore a true statement, while §7's read-lens machinery becomes the opt-in **property** posture. Both
are true of different deployments; neither document was wrong; and the stronger promise is the one that
holds unless someone deliberately opts out.

### 28.5 What the operator keeps, and cannot delegate

If a child may admit bytes the parent never vetted, and the parent hosts the disk, the parent needs
something. But that something is emphatically **not** "I vouch for your sources" — that is the blanket
trust §28.1 exists to avoid. The honest operator stake is two powers, and both already exist in the
design:

> **"I can forget, and I cap the bill."**

- **ERASURE reaches through every container, unconditionally** (§24.8, BUILT in
  [#109](https://github.com/bombadil-labs/loam/pull/109) — `erase` fans the tombstone and purge out to
  every attached pool, gated on the tombstone actually landing so a forgery can never drive a purge). A
  child can never become a place where a byte the operator must forget survives. A container is a staging
  area, never a hiding place — and that sentence now holds at every depth.
- **The RESOURCE ENVELOPE bounds what a child may spend** (§24.5 — unbuilt, ticket T34). The operator's
  own doors must keep answering at full speed while a child does whatever a child does.

These two are precisely why delegated admission does not require delegated liability, and they are the
reason §28.1's freedom is safe to host. **T34 is therefore load-bearing for this section, not a hardening
nicety** — without an envelope, delegated admission is an unbounded bill on someone else's say-so.

### 28.6 Computing the trusted set — where the declaration lives, and how the closure is taken

**Where it lives (RECOMMENDATION).** §27.1 already establishes that a container is itself an ENTITY and
its knobs are CLAIMS about it. Trust is one more knob-claim: **a declaration filed at the container's
entity**, in the same shape `loam:trust` already uses. Nothing new is invented; the existing declaration
gains a subject.

The happy consequence is that **the root needs no migration.** A store's existing `loam:trust` declaration
*is* the root container's declaration — same bytes, same context, newly understood as "the root's" rather
than "the store's." Existing stores are already correct under §28 without re-signing a single delta.

**Who may author it (RECOMMENDATION).** A container's declaration binds if authored by someone with admin
standing **in that container**, established by a grant rooted in its parent, recursing to the root where
the operator sits. That recursion is the whole difficulty, and §28.6's second half is about taking it.

**How the closure is computed.** rhizomatic's `inView` is stratified at parse time — no `inView` inside
`inView.term` — so a *live, in-lens* trusted set reaches exactly one link. That ceiling is **permanent and
deliberate**, not a gap awaiting a fix (rhizomatic#27): nesting is *syntactic* while a container tree has
*dynamic* depth, so a bound would only ever express the case this is not; and a recursive fixed-point
operator would break predicate-evaluation cost, decidable subsumption for reactor dispatch, and
incremental maintenance under negation-aware masks.

SPEC-2 §3 sanctions **two** routes for exactly this, and Loam uses **both, for different questions**:

- **(a) HOST-FLATTEN — the BINDING path.** Walk the containment tree in the host, flatten the result into a
  plain `inSet` predicate, and hand that to the lens. Any depth, today, no substrate change. Admission is
  not a lens at all (`admitForImpl` resolves a policy and returns an ordinary predicate), so the admission
  half was never constrained in the first place.
- **(b) A DERIVED AUTHOR — the AUDIT path.** An L7 derived author computes the closure and asserts it as
  signed deltas; a lens then reads those with a plain depth-1 `inView`. Cycles are handled once inside one
  function rather than in every host, and the emission carries real provenance:
  `rhizomatic.derived.from` pins the input view's canonical hash, `explain` traces a trusted set back
  through function → input snapshot → underlying deltas → their authors, and pure derivations are
  replay-verifiable by any third party.

**Binding uses (a), and this is not a preference.** Route (b) carries **one derivation hop of lag** — a
grant delta lands, the materialization updates, the derivation fires, the closure delta ingests, and only
then does the lens see it. A revoked grant would still bind for one cascade. §7 already states and tests
the opposite: *"revoking a grant un-binds its author's strikes on the very next read."* Putting binding on
(b) would silently regress a stated guarantee, and the regression is invisible, because a one-cascade-stale
trusted set is perfectly well-formed. Route (a), re-resolved per request, has zero lag.

**Route (b) still earns its place**, because it answers a question (a) cannot answer at any price: *show me
why this author was trusted, and let me verify it myself.* For a tenancy model that is a real requirement,
and it is a different requirement from deciding whether a claim binds right now. Run both; do not choose.

**The staleness guard is the ABSENCE OF A CACHE (RECOMMENDATION, and it is a prohibition).** The obvious
worry about (a) is a host that forgets to re-derive and reads a stale trusted set with no error. That
failure mode exists **only if the flattened set is stored**. Compute it per request and never cache it,
and staleness is not merely detectable — it is structurally impossible. So §28 does not specify a
staleness detector; it specifies that **there is nothing to go stale**, and says so here explicitly so
that no later optimization helpfully introduces a cache and re-opens a closed hole. If profiling ever
demands one, that is a design change requiring its own invalidation story, not a local optimization.

### 28.7 What becomes of §7's tenant machinery

**REUSED, not shimmed (RECOMMENDATION).** `loam.tenant` / `loam.members` / `loam.grants` already express
exactly what a tenant-as-container needs for membership and standing; §7 built them and they are correct.
What §28 adds is orthogonal: a **trust declaration** filed at the tenant's entity (§28.6) and a **posture**
(wall or property, §28.4). Neither replaces the existing vocabulary — they sit beside it.

So §7's own summary — that tenant machinery survives as *"vocabulary for author-communities and read
lenses, not as write fences"* — remains true and is now completed rather than corrected. The read lenses
are the property posture. The write fence, where one is wanted, is the wall, and it is a store boundary
rather than a check inside one store: **the isolation was never going to come from a predicate.**

**Migration: none for existing deltas.** No delta already on disk changes shape or meaning. The posture
declaration is new vocabulary, minted with the rest of the container vocabulary (T32) and subject to the
same shape-distinguishability discipline; a store with no posture declaration reads as the default, which
by §28.4 is a wall — and a single-tenant store has nothing to isolate, so the default is inert there. No
§20 step is required by this section.

### 28.8 Depth, shape, and the one thing this section depends on

**Live containers stay a TREE; frozen module versions may be a pinned DAG.** §27.4 already decided this,
for drop-safety — a live peer shifts underneath a container that depends on it, while an immutable version
cannot. §28 inherits the rule and needs nothing more: the trust closure walks the containment tree, which
is acyclic by that rule, so the binding path has **no cycle handling to get wrong**. (Route (b) handles
cycles anyway, being general; that is a property of the derived author, not a requirement of this section.)

Depth is unbounded and does not need a cap. The flatten is O(depth) per request over a tree that is small
in practice — root → tenant → perhaps a quarantine inside it — and pathological depth is a resource
question, which §28.5's envelope already owns.

**But there is a dependency worth stating loudly, because it is the kind that is discovered late:** §27.4's
tree rule must be **ENFORCED, not merely stated.** A cycle in containment makes the §28.6 flatten
non-terminating, turning a spec sentence into a hang. Today the rule is prose. Whoever builds the
`Container` primitive (T32) must enforce acyclicity at the moment a container is attached to a parent, and
must rail it — §28's binding path assumes it as a precondition.

---

**Provenance.** **Design-stage DRAFT (Claude, 2026-07-21)** — realizes ticket **T36**; awaits **Myk's
merge (P6)**, which it requires regardless of its state because it lands on capability, federation, and
tenancy surface at once. It BUILDS nothing.

DECIDED by Myk (2026-07-21, across one design conversation): (1) **trust is container-scoped**, with a
store as the root container and tenants as containers within it; (2) **admission delegates downward
freely while effectiveness attenuates** (§28.1) — the correction that saved the design, arrived at when
Myk broke an earlier intersection-only rule with the case of a tenant federating a remote source, showing
that narrowing-only would manufacture exactly the blanket-trust pressure it meant to prevent; (3) **the
trust knob determines the boundary knob** (§28.3), so wall-vs-property is derived rather than chosen; (4)
**per-tenant configurable posture with WALLS AS THE DEFAULT** (§28.4), on the ratchet argument — and with
it, the resolution of the CLAUDE.md/§7 drift in favor of the stronger promise holding by default.

RECOMMENDATIONS awaiting his word: where the declaration lives and who may author it (§28.6); the
no-cache prohibition as the staleness guard (§28.6); reuse rather than replacement of §7's tenant
vocabulary, with no §20 step (§28.7); and unbounded depth resting on an enforced tree rule (§28.8).

**Substrate position (rhizomatic#27, answered 2026-07-21).** Stratification at depth 1 is **permanent by
design**, with both recursive routes sanctioned and their tradeoff named — host-flatten for freshness,
derive-and-`inView` for provenance. Loam takes both, keyed on the question being asked (§28.6). The
substrate side also flagged that `expand.reading` lives in the gather body (SPEC-2 §4.5), so sibling
lenses over one HyperSchema necessarily share a child's reading — which would make "tenant A and tenant B
read embedded posts differently" inexpressible by lens choice alone. **§28.4's walls-by-default ruling
defuses this for the default posture** (a wall tenant has its own store, its own registrations, and
therefore its own gather bodies — it was never sharing one); the constraint bites the PROPERTY posture
only, where it becomes a stated limit and one more reason to choose a wall. Confirmation of that reading
is outstanding with the substrate side; if wall-tenants can still share a body, this paragraph is wrong
and the unbuilt `reading: {hole: …}` escape becomes a prerequisite for property-posture tenancy rather
than a possibility.

Rides §6 (authority never rides in on data), §7 (the residual this section collects), §8 (trust is data,
generalized here from a scalar to a tree), §11/§24.8 (the erasure reach the operator cannot delegate),
§12 (inert-by-default, which §28.1's attenuation is a restatement of), §24 (revealed as this section's
special case at depth 1), §24.5/T34 (re-priced to load-bearing), and §27 (the container primitive this is
a property of). Follow-on: T32 must carry a per-container trust declaration in the vocabulary it mints and
must enforce §27.4's tree rule; T34 builds the envelope §28.5 depends on.
