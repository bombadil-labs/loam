## 22. Custom resolvers — the last step of the lens becomes programmable

A field's value is not stored; it is COMPUTED (§4, §14). Today that computation does two jobs in one
breath. A **Policy** SELECTS — which claims count, in what order, what counts as disagreement:
`pick`'s ordering, `all`'s inclusion, `conflicts`' refusal to decide. And the same Policy REPRESENTS —
what the survivors DENOTE as a value: `merge`'s fold, `absentAs`'s rendering of silence. Selection is
the closed rhizomatic algebra, frozen and universal (SPEC §2). Representation was only ever a set of
built-in defaults — six shapes the algebra happens to export — and until now Loam offered no way past
them. That is an artificial constraint, and it is a Loam-SURFACE constraint, not a substrate one.

**The move: an optional Loam-level `resolve(deltas) → value`, downstream of the Policy.** The Policy
keeps the epistemics untouched — whose claims survive, in what order, what counts as conflict — and a
custom `resolve` overrides only the semantics: what those surviving claims MEAN as a value in this
lens. Absent a custom resolve, the Policy's built-in representation stands, exactly as today; nothing
existing moves. This is an OVERRIDE, not a second resolution system beside the algebra (question 1,
DECIDED — Myk, 2026-07-12): resolution still runs the frozen program, and `resolve` is a final,
optional step layered on its output.

What it opens: a field whose value is a computation over its bucket — a trend, a histogram, a
latest-N; a field that consults its siblings in the HyperView; a field that reaches past the selection
into the store; even a field that leaves the store and asks a remote API. The View stops being limited
to the shapes the Policy algebra exports and becomes what an app MEANS by its data — while the ground
stays pure deltas and rhizomatic stays closed. Selection is trust-and-provenance work and MUST remain
in the closed algebra: §14 leans on exactly this (writing is the dual of resolution BECAUSE resolution
is a known, universal program — `clear` re-runs the gather without caring what the field computes).
Representation was never load-bearing for the write side, and freeing it costs the algebra nothing.

**The §14 consonance — a custom resolve does not break writing, only predictability.** The write
primitives — assert, retract, and the `clear`/`remove` verbs built on them — act on the BUCKET, the
ground (§14). `clear` works "by construction" precisely because it lets resolution re-run without
caring what resolution COMPUTES; a custom `resolve` sits downstream of that and is invisible to it. So
resolvers do not break the write mechanism. What they break is the naive expectation that you write
`x` and read back `x` — you read back `f(x)`. Loam already refuses to promise more than this (§13:
views are perspectival; absence is unknown, not affirmed-empty). Writability therefore stays
orthogonal at every rung (question 5, DECIDED — Myk, 2026-07-12): a write still hits the bucket, which
is real, and the surface documents the honest "round-trip not guaranteed" posture for any resolved
field rather than pretending otherwise. (Rung (e) below is the one exception, for a reason that is not
about honesty but about there being nothing to write to.)

### 22.1 The purity ladder

A resolver declares, in the signed schema definition (question 3, DECIDED — Myk, 2026-07-12), WHICH
RUNG it occupies. The rung is not discovered at runtime; it is part of what a reader trusts when it
trusts the lens — a store can refuse a rung it does not admit, and a reader knows what kind of
computation it is about to believe. **v1 BUILDS rung (a) only.** The design admits the whole ladder so
that the registration vocabulary, the caching contract, and the doors are shaped correctly from the
start; the higher rungs land later, each behind its own gate.

- **(a) bucket-pure** — a function of the SELECTED deltas only. Cacheable, deterministic, testable —
  the same bucket always resolves to the same value, on any peer, forever. This is the only rung v1
  admits, and it is the safe floor: it cannot observe anything the algebra did not already gather, so
  it cannot surprise a federated replay.
- **(b) hyperview-scoped** — may read SIBLING fields' buckets within the same HyperView. Still
  deterministic given the HyperView, but a field's value now depends on more than its own bucket, so
  invalidation widens from the field to the ENTITY.
- **(c) store-querying** — reaches PAST the selection into the store. Deterministic given the store's
  state, but hyperview-local invalidation is gone: the value can change when deltas the field never
  gathered change, so a correct cache must scope invalidation to the store.
- **(d) effectful** — remote APIs, clocks, randomness, anything outside the ground. The view is no
  longer a function of the ground: two readers of the SAME deltas can see different values. This is
  admissible — lenses were never promised to agree (§13) — but it forfeits caching, reproducibility,
  and any federation replay. A store that admits rung (d) is telling its readers, in the signed
  definition, that this field's value is not a fact about the ground.
- **(e) synthetic** — a Schema property with NO analog in the HyperView at all. No bucket, no Policy,
  no gather: `resolve` is the field's ENTIRE existence. This is a SECOND AXIS, not merely a higher
  rung. Rungs (a)–(d) grade what a resolver of an EXISTING (gathered) field may READ; (e) drops the
  requirement that the field correspond to anything gathered at all — and it COMPOSES with the input
  rungs (a synthetic field may itself be bucket-pure over other fields, or effectful). Two
  consequences follow. First, **a synthetic field is READ-ONLY BY DEFINITION**: there is no ground to
  assert against, so a write is refused with a reason — this is exactly where the §14-amendment
  derived-field refusal arrives, now at the Loam layer, and it needs no rhizomatic support because the
  refusal is a surface fact, not an algebra fact. Second, (e) is where the overlap with rhizomatic's
  `DerivedFn` stops being a naming coincidence and becomes a design question (§22.2). **Rung (e) is
  DESIGN-ONLY in v1**: this section describes synthetics fully and builds none.

### 22.2 Resolver and DerivedFn are read/write duals

`resolve` and rhizomatic's `DerivedFn` are DUALS, and Loam keeps both while touching nothing in
rhizomatic (question 2, RESOLVED — Myk, 2026-07-12).

- **`DerivedFn` is the WRITE side** — substrate, frozen (`implementations/ts/src/derivation.ts`): a
  HyperView goes IN, signed claims come OUT. "Everything that computes is an author": its outputs land
  ON THE RECORD, with `rdb.derived.*` provenance reaching down to the input HyperView's content
  address. It changes the ground.
- **`resolve` is the READ side** — Loam-level, this section: the ground goes IN, a VALUE comes OUT.
  Perspectival, per-lens, never touching the record.

The per-field choice is therefore a single honest question: **should this computation's output be a
CLAIM or an INTERPRETATION?** A claim goes through `DerivedFn` and is remembered; an interpretation
goes through `resolve` and is recomputed. Rung (e) synthetics are `resolve` territory — a field that
exists only as an interpretation. And the tell for when you have reached for the wrong tool: a rung
(c)/(d) resolver that wants to REMEMBER what it computed does not want to be a resolver at all — it
wants to be a derived AUTHOR (§24's "promote the outputs" rides exactly this dual).

**Vocabulary guard.** "Derived" is reserved for the WRITE side. The read side says "resolver" or
"synthetic." Do not parallel these with near-synonyms, and never call a `resolve` step "derivation" —
the two words name opposite sides of the record.

### 22.3 What a resolver is at rest — the snapshot doctrine

A resolver is code, and code — like schemas and documents — must live in the ground as content. The
residue is settled (question 4, RESOLVED — Myk, 2026-07-12): a resolver at rest is **EXECUTABLE
SOURCE**. The delta asserts directly-runnable ESM; what you audit IS what runs — one hash, no
signed-vs-executed gap. Building (bundling, transpiling from richer sources) is the PUSHER's business,
done before pushing; an optional provenance claim MAY link the runnable bytes back to their pre-build
sources for deeper audit, but the runnable bytes are the ground truth and the thing the signature
attests. This is what §24's trust story requires: the signature is over exactly the bytes that run.

The general shape of "code, schemas, and documents at rest" is a cross-cutting doctrine, not this
section's alone. It LANDS with §22 as the standalone subsection below, and §21, §23, and §24 cite it
verbatim.

#### The snapshot doctrine

Our deltas cannot do track changes — and neither can git's object model: blobs are whole snapshots,
and every diff anyone ever read was computed at read time from two snapshots plus a lineage relation.
That is not the missing feature; it is the design.

- Deltas assert VERSIONS OF COHERENT WHOLES, plus supersession claims relating them. Never edits.
  History is `supersededBy` lineage — §17's append-only law, close kin to §20's re-sign-and-negate.
  `supersededBy` STAYS Loam vocabulary, never substrate: negation is rhizomatic's because masking
  changes resolution's inputs; supersession changes nothing operationally — it is testimony readers
  follow, and lineage is a lens, per-reader. If cross-app interop wants it, standardize the role NAME
  in rhizomatic's docs, never semantics in its algebra.
- DIFF IS A LENS. Line diff, AST diff, semantic diff — derived views over two attested snapshots,
  chosen by the reader, never a storage format. Likewise the AST, outline, symbol table: structure
  WITHIN a unit is computed from the bytes, not stored as ground. The bytes are the ground truth; the
  AST never was.
- The granularity of a delta is the granularity of ATTESTATION — what would an author sign? Nobody
  signs a keystroke; nobody means an AST node in isolation. For code the unit is the module/artifact,
  and the signature attests EXACTLY the bytes that run (what §24's trust story requires). A swarm of
  signed fragments carries no signature on the combination a reader manufactures from them.
- Structure BETWEEN coherence units lives in deltas. Module entities with import edges, a document's
  outline — queryable, per-unit provenance, targeted supersession. The graph is delta-native; the
  leaves are atomic.
- ORDERING IS AN AUTHORED CLAIM. A container's arrangement is asserted as a value at the container
  level, signed as a whole; concurrent rearrangements CONFLICT visibly (§13) instead of interleaving
  silently.
- THE ECONOMICS LADDER: inline bytes → content-addressed ref → Merkle-chunked tree. All three are
  snapshot semantics; only storage costs change. Content addressing already dedups unchanged units
  across versions. v1 stops at the first rung that fits in a delta.
- Live collaborative editing, if it comes, is an EPHEMERAL LAYER (a CRDT session, an editor buffer)
  that periodically ASSERTS snapshots into the ground. Editing is conversation; the delta is the
  notarized statement at the end of it.

This is §21's picture in different clothes: a living Schema evolving as a domain node, reified by
snapshot into a fixed content-addressed VersionedSchema. One picture, every rung of the ladder.

### 22.4 Riding §21 — a resolver is part of a frozen version

A resolver does not float free. §21 (decided by Myk, 2026-07-13) makes a **Schema** a first-class,
semantically-named living entity — `FilmClassic`, say — that evolves as a domain node and is reified
by snapshot into a fixed **VersionedSchema** identified by `name@short-content-hash`. Changing a
resolver mints a NEW version under §17's append-only law (question 7, DECIDED — Myk, 2026-07-12),
exactly as any other change to the definition does; a version once published stays answerable, and
evolving a resolver publishes a new lens beside the old rather than unseating it.

**Where a resolver freezes, precisely** (refined at build, Myk overruling the assumption that §21 had
already frozen it, 2026-07-14). §21 landed with the VersionedSchema snapshot hashing the rhizomatic
`Schema` — `props` + `default`, the SELECTION program — because rhizomatic's `Schema` has no room for
a Loam-level `resolve`, and rhizomatic is frozen. So in v1 a resolver rides the **binding**, per field,
and freezes at the **registration-version** granularity: each registration delta is a version
(`readRegistrationVersions` pins it by content address), changing a resolver mints a new binding →
a new version, and a pinned version applies its OWN resolver forever. This satisfies §17's
append-only law and the "pin it, it answers the same" guarantee at the version-delta level. Folding a
resolver's content address into the `name@hash` VersionedSchema itself — so a renderer that pins
`FilmClassic@<hash>` (§23) freezes the resolution too — is deferred to §23, exactly as §21 deferred the
symmetric `VersionedHyperSchema`: built when the renderer-pin needs the whole reading frozen, not
before. This section rides §21's ladder; it does not redesign it — see §21 for the identity model.

### 22.5 Caching and invalidation (question 6 — RECOMMENDATION, for Myk's review)

This is the one genuinely open design question. The following is a reasoned RECOMMENDATION, not
settled law.

**For v1's rung (a), memoize on `(resolver-content-address, hash-of-the-selected-delta-set)`.** A
bucket-pure resolver is a pure function of exactly two things: the code (whose content address §21
already froze into the VersionedSchema) and the deltas it was handed. Key the memo on both. The cache
invalidates EXACTLY when the bucket recomputes — the same trigger as a plain View recompute, because a
bucket-pure resolver observes nothing a View does not. There is no separate invalidation machinery to
build: a resolver at rung (a) folds into the existing View memoization, and the resolver's content
address is already in the key because it is already in the version.

**Erasure invalidates by construction (§11) — make it explicit.** "The bucket recomputes" includes a
fact that is FORGOTTEN, not only one that changes. When a delta in the bucket is tombstoned or purged,
it drops out of the selected-delta-set, so the set's hash changes and the memo MISSES: the resolver
re-runs over the surviving ground, and its old value — distilled from bytes that no longer exist — can
never be served from cache. This is not a special case bolted onto invalidation; it falls straight out
of keying on the delta-set hash. It is also non-negotiable: a resolver whose cache outlived an erasure
would be an erasure-EVASION channel, handing back a value computed from forgotten bytes. The rung-(a)
contract therefore promises what §11 requires — the cache forgets exactly when the ground does, and a
memoized resolver value is proven, at implementation time, to disappear when any delta it was computed
over is erased.

**Higher rungs declare their invalidation SCOPE, and none are built in v1:**

- (b) hyperview-scoped → invalidation scope is the ENTITY (the value depends on sibling buckets, so any
  of the entity's buckets recomputing must invalidate).
- (c) store-querying → invalidation scope is the STORE (the value can change when deltas the field
  never gathered change; only a store-level trigger is sound).
- (d) effectful → NO caching (the value is not a function of the ground; a cache would be a lie).

Making the scope part of the SIGNED rung declaration means the gateway can promise a cache contract a
reader can verify, rather than guessing how far a resolver reaches. v1 promises the rung-(a) contract
and nothing more.

### 22.6 Output types for the doors (question 8 — RECOMMENDATION, for Myk's review)

The following is a reasoned RECOMMENDATION, not settled law.

A resolver changes what a field's VALUE IS, and the doors generate their types from the registration
(§17: GraphQL fields, OpenAPI shapes). **The signed schema definition MUST declare each resolved
field's output TYPE alongside its rung.** Without it, the surfaces cannot speak the field they serve:
a resolver that turns a `pick` string into a histogram would break every generated door SILENTLY —
GraphQL would still advertise `String`, OpenAPI would still document a string, and the door would
answer with a shape neither contract promised. The type declaration travels with the resolver in the
same signed definition (so it is frozen into the VersionedSchema, and two peers naming the same
version cannot disagree about what the door speaks), and the surface generators read it exactly as
they read the Policy today. This keeps the §17 invariant intact — two doors over one registration
agree, `_hex` for `_hex` — even when the field's value is a computation the algebra never named.

**Provenance.** Design accepted (Myk, 2026-07-13); **rung (a) landed**
[#97](https://github.com/bombadil-labs/loam/pull/97), riding §21. The lens's last step is now
programmable: an optional `resolve(bucket) → value` per field, declared with its rung and output type
in the signed binding, executed as directly-runnable ESM (loaded from a `data:` URL, cached by content
address, applied synchronously over the field's bucket). The memo (question 6) landed as recommended —
keyed on `(resolver-content-address, surviving-bucket-delta-set)`, so erasure invalidates by
construction (§11): an erased fact drops from the bucket, the key changes, and a value distilled from
forgotten bytes can never be served. Output types (question 8) landed as recommended — GraphQL and
OpenAPI advertise each resolved field's declared type, keeping the §17 two-doors-agree invariant. The
implementation lives in `src/gateway/resolvers.ts` (load / apply / memo), `src/gateway/registration.ts`
(the `ResolverSpec` on the binding), `src/gateway/gateway.ts` (the resolve paths + publish validation),
and the door generators (`src/gateway/gql.ts`, `src/surface/rest.ts`). Only rung (a) is built; the
higher rungs (b/c/d) and (e) synthetics are described above and refused at parse — a store admits
exactly the purity its signed definition names. v1 executes the operator's OWN resolvers in a governed
store (only operator law binds, §7); confinement for UNTRUSTED executable law is §24's quarantine and
§23's renderer trust. Additive/non-breaking: a binding without resolvers is the pre-§22 shape, so no
§20 migration. Realizes ADLC ticket T3.

**§22.6 THE DECLARED TYPE BINDS** [#133](https://github.com/bombadil-labs/loam/pull/133) (ticket
T18, audit-2 MED, 2026-07-17) — the two-doors-agree promise this section made became enforced
behavior: `applyResolvers` validates every resolver's returned value against its declared
`ResolverOutputType` at the apply seam, ONCE, where every door inherits it (`matchesDeclaredType`,
`src/gateway/resolvers.ts` — all six types including the §23.7 `bytes` envelope). A mismatch does
exactly what a throwing resolver has always done: the field falls back to its Policy value, blast
radius of one field, and the rails assert the equivalence directly (mismatch ≡ throw, at the
GraphQL door and the REST door — `test/gateway/resolver-typing.test.ts`). Residual, named honestly:
each door serializes the FALLBACK through its own contract (GraphQL's declared String coerces a
numeric Policy value; REST emits it raw) — an asymmetry that pre-exists for throwing resolvers and
is deliberately not widened here.

**§22.7 RESOLVERS AND EXPANDED CHILDREN — the reading is named**
[#139](https://github.com/bombadil-labs/loam/pull/139) (ticket T25). A resolver applies at the lens
door, over a top-level field's bucket. An entity embedded as an EXPANDED CHILD of another lens's
gather (a feed's posts, a plan's guests, a bed's plants) is a different matter: the child is a whole
little view, resolved on its own. Building the first real apps surfaced the question of WHICH reading
resolves that child — and found the substrate had no answer. Before rhizomatic 0.8, an expanded child
was resolved through the PARENT's Schema (a recursion that only produced sensible output when the two
schemas' fields happened to align); a child's intended reading was unstatable in the gather program.
Loam filed that as [rhizomatic#23](https://github.com/bombadil-labs/rhizomatic/issues/23), and 0.8
answered it: an `expand` now names BOTH halves of the child's lens — `schema` (how the child gathers)
and `reading` (the resolution Schema it resolves through) — and a legacy readingless body refuses to
resolve, loudly, with no parent-Schema fallback. So an expanded child is now resolved through its OWN
reading's Policies, named in the term and validated at registration.

And this section's HOST-LEVEL resolvers now reach across that boundary too (ticket T26,
[#140](https://github.com/bombadil-labs/loam/pull/140)). A §22 resolver rides a binding, and
`applyResolvers` decorates a lens's top-level fields; `decorateChildren` then reaches one level down
and repeats, applying the CHILD reading's resolvers to each expanded child — recursively, to
grandchildren and beyond. So a Pachyderm post read directly and the SAME post embedded in the timeline
now carry the identical computed byline. The mechanism avoids reimplementing any of rhizomatic's
ordering: the same hview is resolved a second time with every expansion stripped, so each formerly
expanded pointer renders as the child's entity ID in the identical Policy order — that alignment is the
child's identity, letting the host splice the decorated child back into the exact position it holds.
The reading's own resolvers are looked up by name (a reading's name IS its lens name), and the child's
resolver memo invalidates on the child's own erasure exactly as a top-level field's does (§11): the
child bucket keys the memo. **v1 boundary, named honestly:** decoration reaches a child embedded as a
single expansion pointer (a feed's post, a plan's guest) under a `pick` or `all` Policy — the common
shape. Two cases are left resolved-but-undecorated, never mis-decorated: a child buried inside a
MULTI-pointer object value (the alignment can't name it), and a field whose Policy is `conflicts` or
`merge` (they dedup by canonical hex or fold to primitives, so the stripped-id resolve and the full
resolve can diverge — the alignment holds only for the position-preserving policies). Both are rungs
deferred until a consumer needs them.

**Provenance.** rhizomatic 0.8 adoption landed [#139](https://github.com/bombadil-labs/loam/pull/139)
(ticket T25), realizing [rhizomatic#23](https://github.com/bombadil-labs/rhizomatic/issues/23). Loam
threads every bound resolution Schema into `SchemaRegistry.build` as a reading (`programReadings`,
`src/gateway/lifecycle.ts`), so an `expand`'s `reading` resolves at eval time and an unknown reading
is refused loudly at publish (`test/gateway/reading-refs.test.ts`); every shipped `expand` body names
its child's reading. Because a readingless body is a breaking on-wire change, a §20 migration carries
old stores forward — it fills each `expand`'s `reading` from the child hyperschema's single bound lens
(pre-0.8 stores are single-lens, so the pairing is mechanical), re-signing the definition and negating
the old (`src/migrate/migrate.ts`, the `expand-reading` step; `test/migrate/expand-reading.test.ts`).
The jump from 0.6 also adopts 0.7's strict Ed25519 acceptance criterion (rhizomatic#20) — transparent
for every honest signature. Host-level resolvers reaching expanded children landed
[#140](https://github.com/bombadil-labs/loam/pull/140) (ticket T26): `decorateChildren`
(`src/gateway/resolvers.ts`), wired into every read path — query, pinned version, and the live watch
stream (`src/gateway/reads.ts`) — so a door, a version door, and a subscription all attribute a
timeline the same way. Rails: a post read directly and as an expanded child resolve to the same
byline, a child reading with no resolvers passes through untouched, and the child memo invalidates on
child erasure (`test/gateway/child-resolvers.test.ts`). Additive, no wire change, no migration — the
enrichment is pure read-path. Pachyderm's timeline (`demos/pachyderm/`) now carries its attributions,
closing the gap pachy.2 documented.
