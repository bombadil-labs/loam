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

- **Membership** — which deltas are inside. A lens over a ground (what the quarantine federates), or an
  explicitly curated set ("populate it with specific things"). A shippable module wants curation plus a
  MANIFEST: which schemas / renderers / entities are its PUBLIC SURFACE versus internal deltas it needs but
  does not export (§27.6).
- **Seeding** — how it is populated: one-way inbound federation from a primary (the quarantine), an
  explicit import of a shipped module, or hand-authored deltas.
- **Trust posture** — foreign law inside binds nothing until blessed (inert-by-default, §8/§12). The
  container is the safe staging area for untrusted law; "installing" a trusted module is load + a promotion
  of its law (§27.3). Quarantine and trusted-import differ only in this knob.
- **Boundary** — reference or merge (§27.3): does the container stay a distinct unit you point at, or
  dissolve into your ground?
- **Identity** — a living name that mints frozen versions (§27.2).

"A separate container, not a mark" is not a new argument here — §24.1 already proved it (*you cannot discard
a mark*: a "sandboxed" flag on canonical deltas would demand every reader honor it forever, and erasing a
marked set means negating it delta-by-delta with residue). It generalizes verbatim: a module has to be a
separate addressable unit you *reference*, not a namespace tag smeared across one ground, precisely so you
can unload, version, and swap it. The grow-only union has no native boundary; the only boundary is a
distinct container.

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

### 27.6 The genuinely open questions (where the design work is)

1. **Membership and the manifest.** What is *in* a module, and what does it *export*? A curated set plus a
   manifest naming its public surface (which schemas / renderers / entities are visible to a consumer versus
   internal). This is where a module stops being "a bag of deltas" and becomes a package with an interface.
2. **Identity as a Merkle-set.** The canonical, order-free content address over member deltas — the keystone
   everything else hangs on. Buildable on the §22.3/§23.10 ladder, but it is the piece that turns "a
   container" into "a nameable, verifiable, pinnable module version."
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

**Provenance.** **Design-stage DRAFT (Claude, 2026-07-15)** — this section names a primitive the arc
converged on and fixes its two decided questions; it BUILDS nothing and awaits **Myk's sign-off in chat
(P6)** before it shapes implementation. DECIDED by Myk (2026-07-15): the living→frozen laddered identity
(§27.2) and always-kept provenance, including on merge, which makes fork and pull-request native (§27.3). The
branch formalism (§27.4) sanity-checks Myk's "a branch is chosen at query time" into `(scope × resolution)`,
both query-time, and states the live-tree / frozen-DAG rule. The git mapping (§27.5) is the canonical way to
explain Loam to anyone who groks git, and the source of the "impossible" demo set. Rides §8 (federation), §11
(erasure), §13/§14 (read-time conflict), §17 (N lenses), §21 (the living→version ladder), §22.3/§23.10 (the
content-address economics ladder), and §24 (the container's first instance, and promotion as its first
operation). Realizes no ticket yet; the follow-on tickets are promotion first, then the `Container` lifting.
