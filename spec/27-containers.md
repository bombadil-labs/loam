## 27. Containers — the primitive under sandboxes, modules, and federation

A quarantine pool (§24) turned out not to be a quarantine. It is a **referenceable, content-addressable
container of deltas** — a store you can spawn, seed with a chosen subset of the ground, resolve over, ship,
and drop — and "sandbox" is only the first policy anyone pointed it at. Once the container is a primitive,
a surprising amount of the back half of this spec stops being separate features and becomes *configurations
of one object*:

- A **quarantine** (§24) is a container with the posture UNTRUSTED · one-way-seeded · live · droppable —
  probation.
- A **module** is a container with the posture CURATED · frozen · content-addressed · with a manifest of
  what it exports — a shippable unit.
- **Federation** (§8) is moving a container's deltas between stores.
- **"Ship an app" (§23)** is a module whose contents are `{schema + renderer + seed deltas}`.
- A **`VersionedSchema` (§21)** is the degenerate container: one frozen reading, nothing else.

This section names the primitive, fixes the two questions Myk has decided (§27.2, §27.3), formalizes what a
"branch" is once containers and resolvers are separate (§27.4), and states the mapping that makes the whole
edifice explicable to anyone who groks git (§27.5) — because the honest one-line answer to "what is Loam" is
**git, if the atom were a signed claim instead of a file.** This is a design-stage section: it fixes shapes,
marks DECIDED what Myk has decided, and BUILDS none of it — the quarantine pool of §24 is its first, single-
policy instance, and promotion (§24.3) is its first cross-container operation.

### 27.1 The primitive, and the policies it specializes into

A container is a `StoreBackend` plus a `Gateway` over it — its own delta-set, its own doors, resolvable in
its own right. Nothing new: it is what §24 built. What makes it a *primitive* rather than a bespoke
quarantine is that its behavior is a small vector of knobs, and the arc's features are settings of that
vector:

- **Membership** — which deltas are inside. **This is a delta-query** (DECIDED, §27.6): a `Term → dset`, the
  shape `offeredLens` already is — static (freeze to a version) or live (a subscription), over a local or
  remote store. A shippable module adds a MANIFEST atop the query: which schemas / renderers / entities are
  its PUBLIC SURFACE — the exports it promises to keep stable across versions (§27.8), and the manifest is
  what promotes a container to a MODULE. Note the correction §27.8 makes to the phrasing this bullet used to
  carry: an unexported member is NOT-ADVERTISED, never NOT-READABLE, because any delta ingested into your
  store is visible to you (the §27.8 invariant, DECIDED — Myk, 2026-07-21). The manifest is an interface
  promise, not an access control.
- **Seeding** — how it is populated: one-way inbound federation from a primary (the quarantine), an
  explicit import of a shipped module, or hand-authored deltas.
- **Trust posture** — foreign law inside binds nothing until blessed (inert-by-default, §8/§12). The
  container is the safe staging area for untrusted law; "installing" a trusted module is load + a promotion
  of its law (§27.3). This knob also decides whether "excluded/sandboxed" can be a PROPERTY or must be a
  WALL (below).
- **Boundary** — reference or merge (§27.3): does the container stay a distinct unit you point at, or
  dissolve into your ground? (And merge splits by trust — scope-flip vs adoption, §27.3.)
- **Identity** — a living name that mints frozen versions (§27.2).

**A container is itself an ENTITY, and its knobs are CLAIMS about it** — so a store's own organization is
data, negatable and forkable like everything else (trust is data, §8, arriving at *structure* is data). In
particular the sandbox/exclusion is a **property**: a claim "container C is excluded," and merging C in is
negating that claim (§27.3's scope-merge — flip the flag, no re-sign).

**When exclusion is a property, and when it must be a wall.** §24.1 proved *you cannot discard a mark* — a
"sandboxed" flag on canonical deltas that every reader must honor forever, discarded only by negating each
delta with residue. That argument is about UNTRUSTED foreign law, and there it stands: a stranger's law needs
a separate store (structural isolation) for discard-with-zero-trace and erasure-evasion resistance. But for
YOUR OWN containers — deltas you or your grantees authored, organized into semi-permanent scopes — a property
is exactly right: you never need to discard-with-zero-trace (you re-include or exclude), the deltas were
always yours, and exclusion is a scope choice the read query honors, not a security boundary a stranger might
evade. So "excluded" is a SPECTRUM keyed on trust: a flippable property for your own containers; a separate
store for untrusted ones. The grow-only union still has no *canonical* boundary — only a distinct container
gives isolation of foreign law — but among your own deltas, a container is a named region of the scope
algebra, and exclusion is a claim.

### 27.2 The living → frozen ladder (DECIDED — Myk, 2026-07-15)

A container's identity follows the same shape as every other living/static pair in Loam, and it would be
strange for this one to break the pattern. **A LIVING CONTAINER evolves and mints frozen versions; a MODULE
VERSION is an immutable, content-addressed delta-set.**

    living container : module version  ::  Schema : VersionedSchema  ::  HyperSchema : HView

Both exist, laddered, for the same reason they do everywhere: the living thing is where work happens and the
ground goes on moving; the frozen version is what you ship, pin, verify, and reproduce. A module version's
identity is a content address over its member deltas — order-free, because the members are a CRDT set, so it
is a hash over the sorted member-ids, or a Merkle-set for incremental sharing (the snapshot doctrine's own
economics ladder, §22.3 / §23.10 — `inline → content-addressed ref → Merkle-chunked tree` — written for a
byte-blob and here pointed at a delta-SET). Two consumers loading the same module version get the same
bytes: dedup, verification, reproducibility. A package hash.

### 27.3 Reference or merge — the load fork, and it is promotion (DECIDED provenance — Myk, 2026-07-15)

Everything hinges on what LOAD means, and there are exactly two answers:

- **REFERENCE-load** — the module stays a distinct container your ground points at: droppable,
  versionable, swappable. This is quarantine, and it is dependency-style import.
- **MERGE-load** — the module's deltas dissolve into your ground by ordinary union: permanent, boundary
  gone. This is vendoring.

The fork is not new machinery; it is the PROMOTION knob of §24.3 seen from both ends. *Promote a module* =
merge-load. *Import / quarantine a module* = reference-load. Reference is the safe default (droppable, no
commitment); merge is the deliberate act. So the module system and the §24 promotion story are one lever.

**And provenance is always kept — even on merge (DECIDED).** This is load-bearing, and it is one of the
things that makes Loam what it is: a merged delta still carries its author's signature and an adoption
pointer (`loam.adoption`, §24.3) recording *where it came from* — which module version, which author, when.
Because the atom is a signed claim, merge cannot flatten authorship the way a git squash does; who-wrote-what
survives forever, per fact, cryptographically. This is exactly what makes **fork and pull-request native**:

- A **fork** is your container referencing theirs plus your own deltas on top. Your deltas *are* the diff —
  already signed by you, already content-addressed. There is no patch file and no rebase; the contribution
  is the deltas.
- A **pull request** is offering those deltas back: you federate them to the creator, whose operator
  resolves whether to bless them. Because provenance is intrinsic, the creator sees EXACTLY what changed and
  WHO you are — not a reconstruction, a signature. Merge is union; disagreement, if any, is a read-time lens
  (§13/§14), never a write-time conflict to hand-resolve.

**The two merges (DECIDED, Myk, 2026-07-15) — re-signing is the trust-crossing, not the merge.** Merge-load
splits by trust relationship, and the split dissolves what first looked like a conflict in the promotion
story ("do we re-sign to merge, or not?"). The answer is: it depends on whose deltas they are.

- **Scope-merge** — a container in your OWN trust domain (deltas you or your grantees authored). "Merging"
  is INCLUDING the container in your primary scope: flip the exclusion property (§27.1). **No re-signing** —
  the authorship never changed, so re-signing would pointlessly rewrite your own claims and churn their
  content addresses. Trivial, and provenance is already intact (it was always yours). This is the merge for
  the sandbox-as-a-property model: excluded → included is a flag.
- **Adoption-merge** — a container across a TRUST BOUNDARY (a stranger's law or outputs). Here you must
  RE-AUTHOR to bind, because foreign authorship binds nothing (inert-by-default, §8/§12): the operator
  re-signs the content as their own claim with a `loam.adoption` record keeping the stranger's authorship on
  the trail (§24.3, built as promote-outputs). This is the merge for a stranger's fork.

So **re-signing is not the merge mechanism — it is the trust-boundary-crossing mechanism.** Within a trust
domain, merge is scope inclusion (flip the flag, no re-sign); across one, merge is adoption (re-sign, with
provenance). The two are the same §27 reference→merge lever, keyed on whether the deltas are already yours —
and "excluded/sandboxed" is therefore a spectrum: for your own containers a PROPERTY (a flippable claim, see
§27.1); for untrusted foreign law a separate store (only structural isolation gives discard-with-zero-trace
and erasure-evasion resistance, §24.1). The trust posture picks whether exclusion can be a flag or must be a
wall.

### 27.4 What a "branch" is, once containers and resolvers are separate

A git branch fuses two things Loam keeps apart, and both are chosen at query time. A view is
`resolve(Schema, gather(scope))`, and a **branch is a choice of `(scope, resolution)`**:

- **SCOPE** — git's isolation axis ("which commits are in this line"). In Loam: which CONTAINERS (and which
  deltas within them) you gather over. This is the container's job — the boundary.
- **RESOLUTION** — git's "the tip is the state." In Loam: which claims WIN, via the Schema/Policy
  (`byAuthorRank`, `pick`, `merge`, `conflicts`). This is the resolver's job — the selection.

Git *pins* both: scope = one history-line, resolution = latest-commit-wins. Loam frees both, at read time,
and lets you instantiate arbitrarily many at once — so **you are never limited to a single branch, and it
falls out for free.** Free because (a) resolution is already N-at-once (§17, "N interfaces over one store")
and (b) the atom carries the selectors a branch needs — authorship in the signature, membership in the
container — so a Policy *can* branch on them. "Alice's branch" is `pick byAuthorRank [alice, …]`; "the
cosmos I operate in" is a gather scoped over `primary ∪ chosen containers`; both are read-time choices, both
composable, both instantiable simultaneously as many living windows on the same objects.

The precise relationship, and the reason BOTH primitives are needed: **resolution SELECTS; it does not
ISOLATE.** Once a delta is in your ground, no Policy un-sees it. Isolation — my work-in-progress not
touching your view — is the container's boundary, not the resolver's. Containers give scope; resolvers give
selection; together they reconstruct AND exceed the git branch (Loam can resolve a branch that *displays* a
conflict via a `conflicts` Policy — a view git cannot produce, because git makes you resolve to proceed).

This also sharpens the dependency question §24.2 left half-open. LIVE containers must stay a **tree** (a
quarantine persistently depending on a peer breaks drop-safety, because a live peer shifts underneath it).
But an IMMUTABLE module version is frozen and content-addressed, so it can safely PIN other module versions —
and the graph becomes a **DAG of immutable snapshots** (the nix model), where a live tree could not. The
rule: **live containers stay a tree; frozen module-versions can be a pinned DAG.** Immutability is what buys
back the dependency edges drop-safety forbids.

### 27.5 Loam is git for signed claims (and git is the special case)

The one-line answer, and the onramp for every technical person alive: it is git, where the atom is a signed
claim instead of a file. Every divergence below is a CONSEQUENCE of that one substitution, not a separate
paradigm to learn — which is what collapses "so many interweaving novel ideas" into "one idea, many
payoffs":

| | git | Loam |
|---|---|---|
| **atom** | a blob (whole-file snapshot); authorship rides the *commit*, not the content | a signed **claim** — provenance is intrinsic, per-fact, and survives merge |
| **merge** | 3-way; conflicts; a human resolves at write time | commutative **union** — no conflicts; disagreement is a *read-time lens* (§13/§14) |
| **diff / blame** | line-diff is the storage format; blame is reconstructed | diff is **a lens** over two attested snapshots (§22.3); blame is the delta's own signature |
| **forget** | can't, really — history-rewrite is violence and objects linger | **§11 erasure** is law: tombstone + purge, reaching *through* the quarantine glass (§24.8) |
| **working tree** | one HEAD, one checkout | **many simultaneous lenses** over one ground (§27.4) — never "on one branch" |
| **trust** | none native; access control is out-of-band | **capabilities** first-class (§6/§7); foreign law inert until blessed (§8/§12) |
| **live** | snapshots you check out | containers **live-follow** and re-resolve (§24.2 local-first-live) |

**Git is the special case.** Collapse Loam's degrees of freedom — resolve everything latest-wins, never use
capabilities, never erase, treat the whole store as one lens — and what falls out *is* git. Loam is what you
get when you do not collapse them. Git discovered that content-addressed immutable objects behind a living
ref is the right skeleton for collaboration; Loam keeps that skeleton and changes the bone from *file* to
*signed claim*, and the divergences drop out as free consequences.

**The demos that make someone sit up** are each a git operation with one wall removed — "you know this…
now watch the wall not be there":

- Merge two forks → **zero conflicts, and blame still shows every line's true author across the merge.**
- A subject exercises erasure → **the byte is gone from the repo AND from every fork that pulled it.**
- Open a PR → **it is just your signed deltas — no patch file, and the maintainer sees exactly what and
  who, cryptographically.**
- Check out a branch → **check out five at once, live, as five windows on the same objects.**
- Clone a sketchy repo → **run its whole app against your real data, watch it, drop it with zero trace.**

Each is impossible in git, and each is a *consequence of the atom*, not a bolted-on trick — which is the
whole rhetorical point: the familiarity is the hook, the removed constraint is the payload, and there is
only ever one idea to have first.

### 27.6 Membership is a delta-query (DECIDED — Myk, 2026-07-15), and the questions that remain

**Membership is a query (DECIDED).** A container's contents are defined by a delta-query — a rhizomatic
`Term` that evaluates to a `dset` (a set of whole deltas), exactly the shape `offeredLens` already uses. This
is the SCOPE axis of §27.4, made concrete: the query IS the container; the Schema resolves it. It ranges
across two dimensions the substrate already gives:

- **Static or live.** Evaluate once and freeze the `dset` → a frozen MODULE VERSION (content-addressed,
  §27.2); or re-evaluate as the ground grows → a LIVING container (the quarantine is exactly this — seeded by
  a live membership lens).
- **Local or remote.** The query runs over your ground, or a peer's (federation carries the remote deltas in,
  filtered by the membership query on the way — again, the quarantine's inbound edge).

And it is already EXPRESSIVE today (verified against rhizomatic): membership by author (`match{field: author}`),
by time range (`and` of two `timestamp` matches), by an explicit id set (`match{field: id, cmp: inSet}`), by
touching an entity (`hasPointer{targetEntity}`), by context (`hasPointer{context}`), and any boolean
combination (`and`/`or`/`not`, term-level `union`). So the membership primitive needs no substrate change to
select — it is a `Term → dset`, and the Loam-side work is only to EXPOSE that evaluation as a first-class
`select(term)` / live `watch(term)` surface (a parameterized `offeredDeltas`, nearly free).

The one gap is **set difference** — "the scope is the union of active containers MINUS the excluded ones,"
which the sandbox-as-a-property model (§27.1/§27.3) needs. `union` is a first-class `Term` op; `difference`
and `intersect` are not. Single-level exclusion by delta id is expressible today via the reflective idiom
`select(not(inView(T, id)))` = `input ∖ T`, so the property model WORKS now for excluding one container — but
that idiom is depth-1 stratified (the excluded term may not itself be a difference), so containers defined
RELATIVE to one another do not compose. Composable, nestable set-difference (and intersection, to complete
the `∪`/`∩`/`∖` algebra) shipped in **rhizomatic 0.6.0** (2026-07-15, issue **#16**): `difference` and
`intersect` are now first-class `Term` ops, symmetric with `union` and nestable to any depth. Loam's bump to
0.6.0 is queued as **T14**; until it lands the single-level exclusion idiom still works, and the general
container algebra unlocks the moment it does. (Containers are, at bottom, set algebra over deltas: membership
a query, exclusion a property, composition the boolean operators.)

The questions that DO remain open:

1. ~~**The manifest.**~~ **CLOSED — see §27.8.** A membership query says what is *in* a container; a module
   still needs to say what it *exports*. That is where a module stops being "a query's output" and becomes a
   package with an interface, and §27.8 now names the interface. (Membership: decided. Manifest: decided.)
2. ~~**Identity as a Merkle-set.**~~ **CLOSED** — see the identity provenance below. The order-free content
   address is BUILT at rung 2 of the §22.3/§23.10 ladder (a hash over the sorted member ids), which is what
   turns "a container" into a nameable, verifiable, pinnable module version. The Merkle rung remains the
   named next step, and the reason it is not yet needed is recorded there rather than here.
3. **Trust on load, precisely.** A loaded module carries law (schemas, renderers, grants). Inert-by-default
   says it binds nothing until blessed; "install a module" is load + a scoped promotion of its law. What is
   the smallest safe blessing — the whole module's law, or a per-export grant?

### 27.7 What this means for the build

Nothing here demands a rewrite; it is a LIFTING. The quarantine pool (§24, PR #109) is the primitive's first
and only instance today, with its knobs hard-wired to the quarantine posture. Taken seriously, the arc's
next moves are: build **promotion** (§24.3) — which is *the first container operation*, merge-load with kept
provenance, and worth building regardless of how far this framing goes; then, when a second policy wants the
same object (a trusted module import, a shipped app), generalize the pool into a named `Container` with the
`{membership, seeding, trust, boundary, identity}` vector and let **quarantine be one preset**. The Container
primitive is the north star; promotion is the next commit; the two are the same direction.

### 27.8 The manifest — a module's interface, and the honesty about what "internal" means

**A word on the words first, because this section is where they start colliding.** §27.1 named one primitive
and several postures of it, and the prose has to keep them straight:

- a **container** is the PRIMITIVE — a delta-set with the `{membership, seeding, trust, boundary, identity}`
  knob vector;
- a **quarantine** is a container in the posture UNTRUSTED · one-way-seeded · live · droppable;
- a **module** is a container in the posture CURATED · frozen · content-addressed — **and the manifest is
  exactly what promotes a container to one.** A container without a manifest is not a module; it is ground
  you scoped;
- a **module version** is the frozen, content-addressed delta-set itself (§27.2).

Only two of those are type names. `ModuleVersion` is (built, §27.2) and `Container` will be (§27.7's
lifting). **"Module" and "quarantine" are PROSE — names for settings of the vector, not exported types** —
the same discipline "lens" runs under. Nothing should ever declare a `Module` type; a module is a container
you can describe, and this section says what the description contains.

Membership (§27.6) says what is IN a container. Identity (§27.2) names the frozen result. Neither says what
a consumer may *rely on*, and that is the whole difference between a delta-set and a package. The manifest
is the interface: **the exports a module promises, named so a consumer can ask for one without knowing how
the module is built inside.**

**The manifest is itself member deltas.** Everything else in Loam is data — trust (§8), budgets (§25), a
Schema as a publishable entity (§21), a container's own knobs as claims about it (§27.1) — and a manifest
that were a separate artifact would be the one piece of a module living outside the model the module is made
of. As member deltas it is negatable, forkable, and readable through the ordinary doors; and because §27.2's
address is computed over the members, **a module version pins its own interface for free** — you cannot
swap what a version exports without minting a different version, which is exactly the property a consumer
pinning that version wants.

One consequence has to be stated or it becomes a bug: **a manifest may never cite the version address it is
part of.** It is a member, so it is inside the hash; a manifest naming its own version id would be a
fixpoint with no solution. Exports name their targets directly (below), the address closes over the whole
member set including the manifest, and nothing is circular.

**What a module may export, split by what it costs to accept.** The list is closed, and it is ordered by
the distinction that matters downstream — whether accepting the export is accepting LAW:

| Export | Kind | Accepting it means |
|---|---|---|
| HyperSchema (§21) | law | a shape your reads may resolve against |
| Schema (§21) | law | a resolution program that decides which claims win |
| resolver binding (§22) | law | code that computes a value your doors then advertise |
| renderer binding (§23) | law | code that renders, and may hold a pen (§23.3) |
| entity | fact | a name to read; binds nothing |
| byte-blob (§23.7) | fact | bytes to serve; binds nothing |

The law/fact split is not decoration. Inert-by-default (§8/§12) says foreign law binds nothing until blessed,
so the manifest's law rows are precisely the list a "smallest safe blessing" has to range over — §27.6's
question 3 inherits this table as its domain, and a module exporting no law is a module that needs no
blessing at all.

**An export names its target by that kind's most stable identifier, and carries a module-local ALIAS.**
A raw delta id is wrong: it is content-addressed, so an adoption-merge (§27.3) that re-signs the content
mints a new id and silently breaks the export. So each kind names itself the way that kind is already
named — a Schema by its §21 schema identity (the living→frozen ladder §21 already built), a renderer by its
content-addressed ESM address, an entity by its entity id — and the export wraps that target in an **alias**:
a short module-local name the consumer writes.

The alias is the point. It is the seam between the interface and the contents, and it is what lets a module
publish `Feed` at version 1 and a completely rebuilt `Feed` at version 7 while every consumer still asks the
same question. A consumer says `(module version, "Feed")`; aliases are module-local, so two modules may both
export `Feed` with no collision and no registry to arbitrate. This is the shape §27.6 asked for when it asked
what a consumer writes to say "give me this module's Feed schema."

**And now the honesty, which matters more than the mechanism.** §27.6 framed the manifest as public surface
"versus internal deltas it needs but does not expose," and that phrasing promises something this design does
not deliver. What replaces it is not a caveat about manifests but an INVARIANT ABOUT STORES (DECIDED — Myk,
2026-07-21):

> **Any delta ingested into your store is visible to you.**
>
> Therefore: **"internal" means NOT-ADVERTISED. It never means NOT-READABLE.**

State it at the store level, because that is the level it is true at. A store has no compartments hidden from
its own operator; ingestion IS visibility. This is the read-side dual of "trust is data" (§8) — nothing about
your own ground is kept from you by law, only organized by it — and it is why a non-exported member is a
member you can plainly read: `select` is a first-class door (§27.6), and §23.9/§24.2's opt-in interop read is
deliberate transparency through the glass, not a leak.

**The invariant is what keeps the container ONE primitive.** A quarantine and a module are the same object in
two postures (§27.1). If a module could hide members while a quarantine could not, the two postures would
carry opposite read rules and "container" would be a word covering two different things — exactly the drift
§24.10 exists to prevent. So this is not a concession the manifest makes; it is a property the primitive
requires.

**A module's internals are therefore as private as a JavaScript bundle's — which is to say, not at all**, and
that is structural rather than an implementation shortfall. Confidentiality of contents you HOLD is not
something any manifest can grant. Genuine confidentiality means the deltas never arriving — a remote module
you query rather than load, which is a different architecture, and one containers can already express
(§27.6's membership query is local-or-remote).

**What this narrows, usefully:** §24.2 deferred a read-side capability slice as an open honesty note. This
invariant does not close that gap, but it fixes its shape — such a slice can only ever govern **what a door
serves to OTHERS**, never what an operator sees in their own store. Any future design that reads as "hide
these deltas from the store that holds them" is out of bounds by this invariant, not merely unbuilt.
(§24.2's own note is a different axis — how much of the PRIMARY a container is given — and stays open.)

So the manifest is an **interface promise, not an access control**. What it actually buys, stated without
inflation: a consumer knows which names are stable across versions, which surface is meant to be depended
on, and which law they are being asked to bless. What it does not buy: secrecy. In the §13 register, the
manifest widens nothing a door may lawfully answer — it narrows what a *maintainer* has promised to keep
working, and that is a social contract enforced by version identity, not a boundary enforced by the store.

**A minimum substrate version, and nothing more.** A manifest states the lowest rhizomatic version the
module requires. This is not speculative future-proofing; the case has already happened. Composable set
difference and intersection arrived in rhizomatic 0.6.0 (#16), so a module whose membership query nests a
`difference` simply cannot evaluate on 0.5.x — and without a stated floor the consumer meets that as a
confusing evaluation failure deep in a Term instead of a clean refusal at load. One version floor turns a
runtime mystery into a door-level "this module needs 0.6.0, you have 0.5.2." Everything else a fuller
dependency story might carry — version ranges, a solver, transitive resolution across the §27.4 frozen DAG —
is deferred until a module actually pins another module, and is noted here only so the deferral is on the
record rather than an oversight.

**Storage follows §27.2's rule, restated because the manifest is the first thing that will be tempted to
break it: a persisted export names its target by content address and never holds its bytes.** Content
addressing is hash consing — a delta's id *is* its structural hash — so naming costs an address where
embedding would cost a copy. That single choice is three properties at once: the shared representation (a
version over ten thousand members is ten thousand addresses); erasure correctness by construction (§11/§24.8
— a manifest that NAMES its exports cannot become a place where an erased delta survives, because it never
held the bytes, and an erased export reads as honestly missing rather than secretly present); and §27.4's
composition rule, since a version pinning another version is one more address. The same sentence answers the
memory question, the erasure question, and the federation question, which is usually the sign it is the
right sentence.

**Provenance.** **Design-stage DRAFT (Claude, 2026-07-15)** — this section names a primitive the arc
converged on and fixes its two decided questions; it BUILDS nothing and awaits **Myk's sign-off in chat
(P6)** before it shapes implementation. DECIDED by Myk (2026-07-15), across this session's design
conversation: (1) the living→frozen laddered identity (§27.2); (2) always-kept provenance, including on
merge, which makes fork and pull-request native (§27.3); (3) **membership is a delta-query** — a `Term →
dset`, static-or-live, local-or-remote (§27.6), which is the SCOPE axis of the branch formalism made concrete;
(4) **the two merges** — scope-merge (flip the exclusion property, no re-sign, own trust domain) vs
adoption-merge (re-sign with `loam.adoption` provenance, across a trust boundary), so re-signing is the
trust-crossing not the merge (§27.3); and (5) **sandbox/exclusion is a spectrum keyed on trust** — a
flippable PROPERTY (a claim about the container entity) for your own containers, a separate STORE for
untrusted foreign law (§27.1). The branch formalism (§27.4) sanity-checks Myk's "a branch is chosen at query
time" into `(scope × resolution)`, both query-time, with the live-tree / frozen-DAG rule. The git mapping
(§27.5) is the canonical way to explain Loam to anyone who groks git, and the source of the "impossible" demo
set. **Substrate dependency (satisfied):** the general (composable, nestable) container set-algebra needs
first-class set DIFFERENCE (and intersection) in rhizomatic's `Term` — `union` existed, difference/intersect
did not; filed as **rhizomatic#16** and **landed in rhizomatic 0.6.0** (2026-07-15). Adoption is queued as
**T14** (top of the build queue); single-level exclusion was expressible even before it (`select(not
(inView(T, id)))`), so the near-term build was never blocked. Rides §8 (federation), §11 (erasure), §13/§14
(read-time conflict), §17 (N lenses), §21 (the living→version ladder), §22.3/§23.10 (the content-address
economics ladder), and §24 (the container's first instance; promotion/promote-outputs as its first
operation, built #111). Follow-on tickets: the first-class membership `select`/`watch` surface and
scope-merge (both on today's substrate); the composable container set-algebra (on 0.6.0 / rhizomatic#16); the
manifest and Merkle-set identity (§27.6); then the full `Container` lifting.

**§27.6 MEMBERSHIP BUILT** [#132](https://github.com/bombadil-labs/loam/pull/132) (realizes ticket
T15, 2026-07-17) — the decided shape's first implementation slice: `Gateway.select(term)` evaluates
a rhizomatic Term (the JSON `op` profile) over the store's surviving ground, once, refusing any
non-dset result loudly; `Gateway.watch(term)` is the same Term live — the current members, then a
fresh evaluation whenever the membership moves, on the entity-stream Channel machinery (the
"parameterized `offeredDeltas`" this section called nearly free — and it is: both live in
`src/gateway/ingest.ts` beside `offeredDeltas` itself). The quarantine's seeding edge generalizes to
`QuarantineOptions.membership` (a Term; the `admit` predicate is the degenerate form, one or the
other), re-evaluated per pulse, erasure law intact. The composed scoping 0.6.0 bought is proven at
the edge: a nested difference (difference against difference — the depth-1 `inView` idiom's
impossible case) seeds a pool and live-follows (`test/gateway/membership.test.ts`, 6 rails;
`demos/village/phase-membership.mjs`, 4/4). Deferred, still open as designed: the module manifest
(question 1), Merkle-set identity (question 2), trust-on-load (question 3), the §27.7 `Container`
lifting. Federation/quarantine seeding surface → Myk's merge (P6). *(Question 2 was subsequently
closed at rung 2 by T29 — see the identity provenance below.)*

**§27.2 IDENTITY BUILT** (realizes ticket T29, 2026-07-20) — the keystone, and the third rung of the
same ladder `select` and `watch` already climbed. `Gateway.freeze(term)` evaluates a membership Term
ONCE and names the result: a `ModuleVersion` of `{ id, members }` whose id is a content address over
the members (`src/gateway/container-identity.ts`). §27.2 had already decided the property that
matters — the address is ORDER-FREE, because the members are a CRDT set — and this fixes the rung at
**2** of the §22.3/§23.10 economics ladder: a hash over the SORTED member ids, domain-tagged so a
module-version address can never collide with another content address computed elsewhere over the
same bytes. Nothing about how a member was reached enters the address: not the naming Term, not
which side of a union it arrived on, not the store it came from, not the wall clock. Only which
deltas are in. That is what lets two consumers who froze the same members agree WITHOUT
COORDINATING — the dedup, verification and reproducibility §27.2 promised, i.e. a package hash.

**Rung 3 (the Merkle-set) is deferred, and here is why it is not yet needed:** it buys exactly one
thing over rung 2 — INCREMENTAL sharing, "ship me only the members I do not already have" — and
nothing in the arc consumes that today. Reference-load pulls by federation (§27.3) and merge-load
re-signs (§24.3, built [#111](https://github.com/bombadil-labs/loam/pull/111)); neither diffs two
versions to find the delta. When something does — a module registry, an incremental pull — rung 3 is
the named next step, and it stays cheap to take because the id is OPAQUE behind one helper: no call
site parses it, so the rung changes without any of them moving.

**No new on-wire shape.** The address is computed as a pure function and recorded nowhere, so this
ships **no §20 migration** — nothing in the bytes any store already holds changed. The first delta
that CITES a module version (a manifest, question 1; a pinned dependency, §27.4's frozen DAG) is
where that question arrives, and it arrives with the vocabulary decisions of T32.

Rails: `test/gateway/container-identity.test.ts` (8) — order-freedom proved by construction rather
than asserted (the same members named by three differently-ordered Terms, and by a union from either
side, agree); cross-store determinism (two independent gateways, each holding ground the other does
not, freeze the same members to the same id); sensitivity; NON-DRIFT (a version frozen against a
live Term is unmoved as the ground grows underneath it — the living→frozen ladder made a test); the
address is over members and not over WHEN; an empty membership is a lawful and stable version; and
`freeze` neither widens nor narrows what `select` accepts, asserted as an equivalence between the
two doors rather than against a pinned error string. Village: `demos/village/phase-membership.mjs`
freezes a living container and watches the ground move past it.

**§27.8 MANIFEST DESIGNED** (design-stage, ticket T30, Claude 2026-07-20) — closing §27.6's question 1.
The manifest is member DELTAS (so a version pins its own interface, and nothing about a module lives
outside the model a module is made of), with the one stated constraint that it may never cite the version
address it is part of. Exports are a CLOSED list split by whether accepting one is accepting LAW —
hyperschema / schema / resolver binding / renderer binding are law; entity and byte-blob are facts — which
hands §27.6's question 3 its exact domain. Each export names its target by that kind's most stable
identifier (never a raw delta id, which an adoption-merge would silently break by re-signing) and carries a
module-local ALIAS, the seam that lets a rebuilt `Feed` stay `Feed` across versions and lets two modules
export the same name without a registry. A minimum rhizomatic version is stated, motivated by a case that
already happened (a nested `difference` cannot evaluate below 0.6.0); richer dependency resolution is
deferred and the deferral recorded. Storage follows §27.2: exports NAME their targets by content address
and never hold bytes — hash consing, which is what content addressing already was (Myk, 2026-07-20) — so
the shared representation, §11/§24.8 erasure correctness, and §27.4's composition all fall out of one
choice.

**THE VISIBILITY INVARIANT (DECIDED — Myk, 2026-07-21).** §27.6 had described a manifest as separating
public surface from "internal deltas it needs but does not expose," which implies a confidentiality nothing
here delivers. What replaced it is not a caveat but a store-level invariant in Myk's own words: **any delta
ingested into your store is visible to you** — therefore "internal" means NOT-ADVERTISED and never
NOT-READABLE. Stated at the store level because that is where it is true: ingestion IS visibility, and a
store has no compartments hidden from its own operator. It is the read-side dual of "trust is data" (§8).

Two consequences worth having on the record. First, **the invariant is what keeps the container ONE
primitive** — a module that could hide members while a quarantine cannot would give two postures of one
object opposite read rules, the drift §24.10 exists to prevent; so this is a property the primitive requires,
not a concession the manifest makes. Second, **it fixes the shape of the deferred read-side capability
slice**: such a slice can only ever govern what a door serves to OTHERS, never what an operator sees in
their own store, so any future design reading as "hide these deltas from the store that holds them" is out of
bounds rather than merely unbuilt. (§24.2's own note — how much of the primary a container is given — is a
different axis and stays open.)

**Vocabulary pinned here too**, because §27.8 is where the words start colliding: *container* is the
primitive, *quarantine* and *module* are POSTURES of it and remain PROSE (never exported types, the
discipline "lens" runs under), and the manifest is precisely what promotes a container to a module. Only
`ModuleVersion` (built) and `Container` (§27.7, unbuilt) are type names.

**Design-stage: awaits Myk (P6).** Question 3 (trust on load) remains open and now has a concrete domain —
the four law rows above — as ticket T31.
