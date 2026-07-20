## 21. Schema identity & versioning — the lens ladder

The whole promise of the HyperSchema/Schema symmetry (§4) is that one gather program can carry many
readings: `HyperSchema : HyperView :: Schema : View`, and just as one HyperView answers many Views,
one HyperSchema should answer many Schemas. Today it does not. A registration files under
`registration:<schemaEntity>`, latest wins (`registrationEntity` in `src/gateway/registration.ts`),
and the registry refuses a duplicate hyperschema name — so `HyperSchema : Schema : roots` binds
**1:1:1** by construction. Register a second lens over a `Film` gather program and it does not join
the first; it EVICTS it. The symmetry is promised in the types and denied at the door.

That knot has to come undone before anything stands on top of it. A resolver (§22) needs a schema
identity it can ride while the schema goes on evolving; a renderer (§23) needs one it can PIN so that
"pinned to schema v3, works forever" means something. Naming, multiplying, pinning — the registration
model gives a Schema none of the three, because it gives a Schema no identity of its own at all. This
section gives it one, and reorganizes the pieces into a ladder:

> **HyperSchema —many→ Schema —many→ VersionedSchema —many→ API.**

Each rung is a real, addressable thing; each arrow is genuinely many. A HyperSchema (the gather
program) carries many living Schemas; a living Schema throws off many VersionedSchemas as it mutates;
a VersionedSchema is served through many APIs (GraphQL, REST, whatever a §17 generator derives). What
follows walks the ladder from the bottom, because each rung explains the one above it.

**The lens, drawn.** The ladder is the *vertical* view — one column, bottom to top. The other view is
horizontal: the two definitions each generate their product against a second input, and each reifies
to a frozen snapshot. That is the **lens** — the reading-side assembly, not any one type in it:

```
  living:   HyperSchema ──× ground──▶ HyperView ──× Schema──▶ View
                │ reifies                            │ reifies
  frozen:   VersionedHyperSchema  (pencil)        VersionedSchema  (name@hash)
```

`VersionedSchema` is built (this section); `VersionedHyperSchema` is drawn in pencil — the deferred
rung, built when a pin needs the gather itself frozen. A lens is one choice of program per rung plus
the binding's stance; forking at any rung (§21.7's coexistence forks the Schema, rung 3) yields a
different lens with its own tuple of content addresses. The full treatment — the five rungs, the
generating arrows, the prose-not-a-type rule — lives in the §18 glossary; this is the same picture,
placed beside the ladder it completes.

### The Schema becomes a first-class entity

**A Schema is a domain node like any other** — its own id, its own deltas, resolved from the ground by
the Schema Schema exactly as a `Film` is resolved from the ground by the film hyperschema. Since
**rhizomatic 0.5.0 this is real machinery, not an aspiration**: `SCHEMA_SCHEMA` plus
`publishSchemaClaims` / `loadSchema` publish and read a resolution `Schema` as its own deltas over the
`rhizomatic.schema.*` vocabulary — the exact mirror of `HYPER_SCHEMA_SCHEMA` +
`publishHyperSchemaClaims` / `loadHyperSchema` for a HyperSchema. The hyperschema half of a
registration already lives this way: the definition is a REFERENCE, planted at its own entity as
`rhizomatic.hyperschema.*` claims and read back by `loadHyperSchema`, while the registration merely
points at it. Half the decoupling road was already paved. What was never paved is
the other half: the Schema travels as a CARRIER — inline canonical JSON stuffed into the registration
delta (`role: "schema"` in `registrationClaims`) — so it has no identity apart from the registration
that quotes it. The design closes the asymmetry by lifting the Schema up beside the HyperSchema: both
are entities, both are published as deltas, both are resolved, neither is a passenger of the binding
that serves them.

**Registration is demoted to a BINDING.** Once the Schema is an entity, a registration stops being the
Schema's home and becomes what it always should have been: a small, three-part declaration — *this
hyperschema, this schema, these roots, served here.* It names two entities and adds a liveness
declaration; it carries no definition of either. A binding is cheap and plural by nature: binding a
second Schema over a hyperschema is another binding delta, not a fight over one `registration:<…>`
slot. The eviction goes away because the thing that evicted was the identity living inside the
binding.

### What names a lens

If a Schema is its own entity, it needs a name that is its own — not borrowed from the hyperschema it
reads, because the entire point is that many of them read the same hyperschema. **Schema names are
semantic, and a human or an AI sets them.** Over a `Film` HyperSchema you might define a `Film`
Schema — the broad public reading — and a `FilmClassic` Schema that surfaces only the archival fields,
and the two evolve on their own clocks forever. The name says what the reading is FOR; it is content,
authored like any other fact, not a coordinate the system hands out.

**The registry lifts the old 1:1 by keying on `(hyperschema, schema-name)`** instead of on the
hyperschema alone. That is the whole unlock: `Film` and `FilmClassic` are distinct keys over one
gather program, so they coexist instead of colliding, and the duplicate-name refusal narrows from
"one lens per hyperschema" to its honest form — "one LIVING lens per name per hyperschema," which is
just what it means for a name to name something. **Built** ([#131](https://github.com/bombadil-labs/loam/pull/131),
realizing ticket T2): `readRegistrations` keys latest-wins per (registration entity, lens) — the lens
name read from the binding's own `schema:<name>` pointer — and the grouped serving surface
(`groupPrograms`, `src/gateway/lifecycle.ts`) derives one program per hyperschema with a lens map,
exactly as §21.7 below pins. Two operators may still bind different Schemas under
the same pair on their own stores; that is federation, resolved by whose law binds (§7), not a
registry collision.

**The reified snapshot is that semantic name plus a short content-hash of the frozen bytes —
`FilmClassic@a1b2c3`.** Both halves are now rhizomatic primitives (0.5.0): the name is `Schema.name`
(0.5.0 gave a `Schema` optional `name` + `alg`), and the hash is `schemaCanonicalHex(schema)` over the
resolution content — `props` + `default` — with `name`/`alg` deliberately EXCLUDED as identity
metadata, so renaming a lens does not change its version and two peers computing the hash agree.
Loam is eventually-consistent and grow-only: the living `FilmClassic` Schema
is a view computed from deltas, so a mutation of it does not overwrite anything — it produces a NEW
snapshot with new bytes and therefore a new hash. The semantic name is the handle a person reaches
for; the `@hash` suffix is what makes each frozen state unambiguous when the same name has meant
several things over time. `FilmClassic` is the living lens; `FilmClassic@a1b2c3` is one photograph of
it. This is the same discipline §17 already runs one level down — a version's TRUE NAME is a content
address, the human-friendly alias is the convenience — pulled up to the Schema itself and given a
name it can wear in a URL.

### The VersionedSchema is a distinct snapshot entity

A version is **not** the binding delta. `readRegistrationVersions` today pins each surviving
registration by its content address, which was the best a Schema-with-no-identity could do — but it
conflates two questions that the ladder must keep apart: *what is this frozen reading* and *is it
being served.* A **VersionedSchema is a snapshot entity in its own right** — the canonical JSON of the
resolved Schema at a moment, frozen and content-addressed, standing whether or not any door serves it.
A version can exist, be named (`name@hash`), and be pinned WITHOUT being bound anywhere. That
separation is load-bearing for the rungs above: a renderer pins a VersionedSchema so it keeps
resolving against a fixed reading even after the living Schema has moved on and even if the operator
has un-bound that version from every door.

**And this snapshot IS §17's per-version freezing, made first-class — so the lift and the versioning
are one move.** The living `schema:<name>` entity is what the LATEST binding resolves and evolves
against; each registration VERSION pins its own frozen VersionedSchema, and §17's version door
(`readRegistrationVersions` / `resolvePinned`, the REST `name@hash` route) resolves an old version
against ITS snapshot — so v1 keeps its old reading forever, exactly as today's inline-schema freezing
does, only now the frozen reading is a named entity anyone can pin rather than bytes buried in a
registration delta. This is a build constraint, not just a picture: **lifting the Schema out of the
registration and minting the per-version snapshot must land together.** A living entity with no
snapshots would resolve every version against the latest, collapsing v1 into v2 and breaking §17's
freezing — there is no coherent intermediate state where the Schema is a living entity, §17 still
freezes, and snapshots do not yet exist.

**Its shape is the frozen canonical JSON, and snapshots never supersede one another.** The snapshot is
literally the bytes the Schema Schema resolved to, run through rhizomatic's canonical JSON profile —
`schemaCanonicalHex` (0.5.0) is exactly that hash — so `parse∘serialize` is identity and the hash is
stable across peers. A newer snapshot of a living Schema
is a fresh, permanent entity that does NOT retire the old one: `Film@abc` and `Film@xyz` coexist, each
independently pinnable AND independently servable, so a consumer bound to `Film@abc` keeps being served
it after the living Schema has moved on to `Film@xyz`. Backwards compatibility is therefore not a
courtesy the operator must remember to preserve — it is the default a content-addressed snapshot cannot
help but provide, because nothing about minting `Film@xyz` touches the bytes of `Film@abc`. The link
between them is GENEALOGICAL, not supersessive: a snapshot may record the predecessor it was DERIVED
FROM — an ancestry pointer, provenance a reader follows BACKWARD — but never a `supersededBy` that would
mark it retired. Supersession (§20's instrument) is for a delta a migration replaces; a VersionedSchema
is replaced by nothing. The operator chooses which versions to publish and MAY publish several at once
(a binding names the version it serves, §17), so a Schema's history is a family of coexisting readings,
all answerable, none struck. Pin any of them and it answers forever; the ground remembers all of them.

### Roots are liveness, and they ride the binding

**Roots declare which entities stay hot — they are not a scope, and they belong to neither the Schema
nor its versions.** A root says "keep this entity materialized and ready to answer"; it is an
operational fact about a serving deployment, and it changes when the deployment's concerns change, not
when the reading changes. So roots ride the **binding** — the registration-as-binding that says
"served here" — and never travel with the Schema entity or freeze into a VersionedSchema. Two
deployments may serve the very same VersionedSchema with different roots hot without the reading
diverging by a single byte; a VersionedSchema stays a pure statement of *how to read*, uncontaminated
by *what to keep warm*. (This is the same instinct as §14's writability: discipline that is not
resolution may be local to a deployment, because resolution must stay a universal function of the
data.)

### The naming pass — expunge the schema/hyperschema blur

The 0.3.0 realignment expunged the schema/hyperschema conflation at the delta level
(`rhizomatic.hyperschema.*`), but it never reached Loam's own ids and prose. The hyperschema
definition entity still defaults to `schema:<Name>` (`schemaEntityFor`), and comments throughout call
it the "schema entity" — for what is, precisely, the HYPERSCHEMA. Now that Schema is a first-class
citizen with its own entity, that blur is not just untidy; it is a name collision waiting to bite. The
implementing PR **renames the hyperschema's entity prefix off `schema:`** so the gather program and
the reading no longer fight over one namespace.

Two disciplines govern that rename, both non-negotiable:

- **It is a breaking on-wire change, so it ships its §20 migration in the same PR.** The `schema:<Name>`
  entity id is baked into registration deltas that older stores already hold; a rename that left them
  behind would open the store and lose the surface. The migration re-signs each affected delta into
  the new form at its original timestamp and negates the old with a `supersededBy` link and a reason —
  supersede, never rewrite.
- **The renamed ids must be shape-distinguishable from the old form** (the standing corollary): the new
  prefix cannot be confusable with `schema:<anything>`, so shape-detection can tell a migrated store
  from an un-migrated one without a per-delta version stamp. The version lives in the vocabulary, as it
  did for `rhizomatic.hyperschema.*`.

**The rhizomatic naming lag is fixed upstream (0.5.0), so this section's rename is the ONLY one left.**
rhizomatic's API used to spell these `loadSchema` / `publishSchemaClaims` while operating on
HYPERSCHEMAS — names that predated the 0.3.0 realignment.
[rhizomatic#10](https://github.com/bombadil-labs/rhizomatic/issues/10) resolved it in **0.5.0**: those
are now `loadHyperSchema` / `publishHyperSchemaClaims`, and the old names are reused for resolution
Schemas (`loadSchema` now returns a `Schema`). Loam adopted the rename in the 0.5.0 upgrade, so the
substrate's API and Loam's own vocabulary finally agree that the hyperschema is the hyperschema — a
code-only change, no data moved. What remains for this section is Loam's OWN at-rest rename above
(`schema:` → `hyperschema:` on the hyperschema-definition entity), which the API rename does not touch
and which ships its §20 migration.

### How the upper rungs stand on this

The ladder exists to be climbed, and §22–§23 are why it must hold weight:

- **A resolver (§22) rides the living Schema, and is part of what a VersionedSchema freezes.** Resolution
  is the Schema's job — the Schema Schema plus the per-property Policies ARE the resolver — so a
  resolver is not a fourth rung; it is the Schema in motion. When a snapshot is taken, the resolution
  discipline it froze travels inside the VersionedSchema's canonical bytes: pin the version and you have
  pinned exactly how it resolves. That is what makes a pinned reading reproducible rather than merely
  labelled.
- **A renderer (§23) PINS a VersionedSchema.** "Renderer pinned to schema v3 keeps working forever" is
  precisely the guarantee this ladder was built to provide: the renderer names a `name@hash`, the
  snapshot is content-addressed and grow-only, the living Schema may evolve or be re-bound or un-bound
  entirely, and the pinned reading still answers because a content address cannot be unsaid. Without the
  snapshot rung there is nothing stable to pin; with it, pinning is just naming a hash. The renderer's
  durability is not a feature it implements — it is a property it inherits from the rung below.
- **The same freezing waits one rung down — a VersionedHyperSchema, when a pin must outlive the
  GATHER.** A View is `resolve(Schema, gather(HyperSchema, ground))`, so a VersionedSchema freezes only
  HALF the reading: pin `FilmClassic@<schemaCanonicalHex>` and the resolution is fixed, but the gather
  program can still move if the `Film` HyperSchema is republished. A fully-reproducible pin is therefore
  a PAIR — `(VersionedHyperSchema, VersionedSchema, roots)` — and the HyperSchema half is the exact
  mirror: `Film@<termHash>` (rhizomatic already hashes a HyperSchema by its body term and already
  publishes/loads it via `HYPER_SCHEMA_SCHEMA`), a snapshot minted by the same doctrine, **no substrate
  change**. It is LATENT today — §17 freezes the schema per version but references the hyperschema live,
  a gap no test exercises — and turns real at §23, where a renderer's "works forever" needs the gather
  frozen too. Build it when §23 needs it; the rung is symmetric and unblocked.

### §21.7 Coexistence — the serving surface *(design landed [#114](https://github.com/bombadil-labs/loam/pull/114); BUILT [#131](https://github.com/bombadil-labs/loam/pull/131), 2026-07-17)*

Slice 2prime pinned the registry key — `(hyperschema, schema-name)` — and stopped at the door. This
subsection opens it: when `Film` and `FilmClassic` both read one gather program, what does each look
like FROM OUTSIDE — at GraphQL, at REST, in a `loam.public` declaration, under a renderer's pin? The
answer has a shape worth saying up front: **coexistence is a serving-side reading, not a wire
change.** Every fact it needs is already in the binding's bytes; nothing at rest moves, so nothing
migrates (§20 has no work here). What follows names the lens at the doors, proves the single-lens
case byte-identical, routes around the frozen registry, and walks the ladder's upper rungs.

**The lens name names everything a door serves.** The serving name is `Schema.name` — the semantic,
human-authored name §21 already gave the lens (a rhizomatic 0.5.0 primitive, stamped on every
published Schema). Every generated surface derives from it, exactly as every surface today derives
from `hyperschema.name`:

- **GraphQL** builds one family per LENS, not per hyperschema: types `<LensName>View` /
  `<LensName>Patch`, the query and subscription field (leading letter lowered), and the mutation
  family — the per-prop claim field, `clear<LensName>`, `remove<LensName>`, `link<LensName>`,
  `sever<LensName>`, plus the lens's own claim templates. `Film` and `FilmClassic` over one gather
  program are `FilmView` and `FilmClassicView`, `film(entity:)` and `filmClassic(entity:)` — two
  complete, independent families in one schema document. Hook dispatch (`hooks.resolve` /
  `watch` / `mutate` / …) keys on the lens name, and the gateway's definition lookup follows; the
  build-time collision refusals (field names, templates, `__proto__`, the meta-field set) stand
  unchanged, now guarding the lens namespace — which is strictly more names, refused by the same
  code at the same moment.
- **REST**'s path segment is the lens: `/rest/<vN | @hash>/<LensName>/<entity>`, and the OpenAPI
  document lists one version family per lens. **`loam.public`** declarations (§12/§17, and §23.8's
  `name@version` pins) name lenses too — publishing `Film` anonymously says nothing about
  `FilmClassic`, which is the entire point of two readings.
- **The hyperschema's name recedes to where it always belonged: the program layer.** Cross-schema
  references inside gather bodies (`fix`, `SchemaRef`) resolve through the SchemaRegistry by
  HYPERSCHEMA name, untouched. Programs name programs; doors name readings. The two namespaces stop
  sharing one string the moment a second lens exists — and keep agreeing, letter for letter, while
  there is only one.

The name is already refused NUL at publish, already `legal()`-ized for GraphQL, already unique per
`(hyperschema, name)` by §21's narrowed registry key. Two lenses whose names legalize to the same
GraphQL identifier are refused at build time by the existing collision check — loudly, before any
state changes. And "lens" stays PROSE: `Schema.name` carries the serving name, and no exported type
gains the word — the recommendation is that none ever needs to.

**The degenerate case — one lens, today's universe — is byte-identical.** Every store Loam has ever
minted stamps `Schema.name = hyperschema.name` (slice 2prime's single-lens rule), so every derived
name is the SAME STRING under either keying: `FilmView` is `FilmView`, `film` is `film`,
`/rest/v1/Film/…` is itself, the SDL and the OpenAPI document and introspection do not move by one
byte. At rest the story is even shorter: the binding delta already names its lens — the `schema`
pointer targets `schema:<name>`, the `schemaVersion` pointer targets `schema:<name>@<hash>` — so no
delta grows a role, loses a role, or changes bytes. **No §20 migration ships, because no wire
changes.** (The one honest alternative — filing each lens's bindings under a lens-qualified
registration entity, `registration:<hyperschemaEntity>:<lens>` — WOULD be a breaking rename of every
registration delta's `registers` pointer and would ship a migration for a cleanliness the reader
below gets for free. Recommended against.)

**Routing around the frozen registry — the wall was never where it looked.** rhizomatic's
`SchemaRegistry.build` refuses a duplicate hyperschema name, and that refusal is CORRECT: within one
serving surface a hyperschema name must name one gather program, or `fix`-references become
ambiguous. Two lenses over one hyperschema share ONE program — the same definition entity, the same
body, the same `termHash` — so the registry never needs to hold two of anything. The gateway simply
builds it from the DEDUPLICATED hyperschema set (one entry per definition entity) rather than one
entry per binding, and the duplicate refusal keeps doing its real job: refusing two DIFFERENT bodies
answering to one name. No substrate change, no rhizomatic conversation, no workaround vocabulary —
the wall was Loam's own habit of building the registry from a per-binding list.

The sharing runs deeper than the registry, and it is a feature — but unlike the registry dedup, it is
NOT free (honesty note, from a fact-check of this memo against the code): the reactor's materialization
is keyed by the HYPERSCHEMA's name (the gather is the hyperschema's; only resolution differs per lens),
which is exactly what lets two lenses share one materialization — and exactly what makes today's
one-register-per-binding habit THROW (`duplicate materialization`, rhizomatic's reactor) the moment a
second binding names the same hyperschema.

**The build shape: dedup is a data structure, not a discipline.** The naive reading of the above is
"remember to deduplicate in two places" — the SchemaRegistry build and the materialization register —
and that is a loaded footgun: the flat per-binding list (`Bound[]`) is consumed at four sites today
(`SchemaRegistry.build` and `reactor.register`, each in both the fixpoint and the rebind paths), and
every future consumer keyed on the program would inherit the same silent obligation. The memo therefore
pins the implementation shape: the gateway derives **ONE grouped reading** — the serving surface —

    programs: Map<hyperschemaName, {
      hyperschema,                    // ONE definition (all bindings must agree, see below)
      roots,                          // the UNION of the member bindings' roots
      lenses: Map<lensName, binding>  // the §21.7 group key, read from the binding's own bytes
    }>

computed in one place from the surviving bindings, and **every consumer iterates the groups**: the
SchemaRegistry builds from `programs` (one hyperschema each — dedup is a non-event), the reactor
registers ONE materialization per program over the union roots, GraphQL builds one family per lens by
walking `lenses`. There is no dedup left to forget, because no consumer ever sees the flat list; the
invariant lives in the one constructor. Two consequences fall out at that single seam, both of which
the flat list hides:

- **Same name, different body is refused AT GROUPING, loudly.** Two bindings naming one hyperschema
  whose definitions disagree (different `termHash`) cannot share a group — that is the registry's own
  "one name, one gather program" law, now enforced once, before any state changes, instead of surfacing
  as a mid-rebind registry throw.
- **Widening the roots is a REBIND, not an addition.** The reactor has no deregister and refuses a
  duplicate materialization, so a new lens whose roots are a subset of its program's existing union
  rides the cheap additive path — but one that WIDENS the union must re-register the shared
  materialization, which means a generation bump (the existing `rebind` machinery, §17). The grouped
  model makes this decidable at the seam (compare the new union to the old); the per-binding model
  could not even ask the question.

Roots are liveness and ride each binding (§21); a shared gather warms for whoever declared it. None of
this exists in the code today; all of it is the gateway's own list-building to fix, no substrate change.
The GraphQL surface already speaks the sharing's language: `_hviewHex` documents that "two lenses over
the same body and root share it while their `_hex` may differ" — one gathering of evidence, two
adjudications. Resolution stays a universal function of the data either way; sharing the gather changes
cost, never answers.

**The registry's key, read from the bytes that were always there.** Bindings for both lenses file
under the same registration entity (`registration:<hyperschemaEntity>` — the hyperschema's family),
and the reader groups them by `(registration entity, lens)`, deriving the lens from the binding's own
`schema` pointer — `schema:<name>` encodes it, and has since slice 2prime. "Latest wins" narrows to
"latest PER LENS": registering `FilmClassic` no longer evicts `Film`, because they were never in the
same group — the eviction §21 opened with was a grouping error, and the fix is the grouping. A
pre-coexistence store regroups conservatively: one lens name per hyperschema means one group, exactly
the reading it always had. Federation is untouched — two operators binding different Schemas under
one `(hyperschema, name)` on their own stores remains whose-law-binds (§7), not a registry question.

**The ladder, climbed per lens.** Each lens runs its OWN version ladder: §17's answerable versions
group by `(registration entity, lens)`, so `Film` counts v1, v2, … while `FilmClassic` counts its
own, each version's true name still its registration delta's content address, each frozen against
its own VersionedSchema snapshot — whose entity id (`schema:<name>@<hash>`) was lens-named from
birth. The upper rungs inherit cleanly: a §22 resolver rides the binding, so it is per-lens by
construction — republishing `FilmClassic`'s histogram resolver mints a `FilmClassic` version and
moves nothing of `Film`'s; a §23 renderer pins `(schemaName, version)`, and `schemaName` is the LENS
name, so "pinned to `FilmClassic@…`, works forever" is one lens's promise, undisturbed by its
siblings' evolution. The latent `VersionedHyperSchema` (`Film@termHash`) sits BELOW the fork and is
shared by every lens over the program — one frozen gather, many frozen readings — exactly the
symmetry the ladder drew.

**Two doors, one ground — the write discipline stays honest.** Sibling lenses share their ground, so
a field `writable` through `FilmClassic` but read-only through `Film` is writable, full stop — the
claim lands once and both lenses re-resolve it. That is not a bypass; it is §14's own posture:
writability is per-binding SERVING discipline, never resolution, exactly as two doors with different
grants have always been. The operator who wants a field immutable everywhere names it writable
nowhere. Likewise the public door: `loam.public` admits lens by lens, so publishing `Film` reveals
nothing of `FilmClassic` — the anonymous world sees exactly the readings declared to it, and the
shared materialization underneath leaks no names it was not asked to serve.

**On-wire verdict: nothing breaks.** No delta kind changes shape, no entity id is renamed, no role
is added or removed; every change lives in how the gateway READS surviving bindings and NAMES what
it serves. A §21.7 store and a slice-2prime store hold indistinguishable bytes until the operator
registers a second lens — and that act is an ordinary, additive binding delta in the existing
vocabulary. The register input needs only one non-default: `schema.name` in the registration payload
names the lens, defaulting to `hyperschema.name` when absent — today's behavior, unchanged, forever
the degenerate case rather than a special one.

**Boundaries, in the §13 register.** A VersionedSchema fixes a READING, not a promise about the ground:
the data it resolves goes on growing, so "pinned" means the lens is stable, not that the answer is
frozen. A binding is serving discipline, not authority: binding a Schema at a door never widens what
that door may lawfully answer (§17), and un-binding a version stops serving it without erasing it. And
a Schema is an entity in an open store, so a foreign peer may hold its own Schema under the same
`(hyperschema, name)` pair — whose reading binds is a question of law (§7), the same as every other
delta; the registry keys locally, and federation resolves globally.

**Provenance.** Design accepted (Myk, 2026-07-13); **landed in slices.** Slice 1 — the
`schema:`→`hyperschema:` entity rename + the §14 immutable-by-default flip in one §20 migration —
landed [#92](https://github.com/bombadil-labs/loam/pull/92). Slice 2 ([#96](https://github.com/bombadil-labs/loam/pull/96)) lifted the Schema to a first-class
entity via 0.5.0's `SCHEMA_SCHEMA` (`publishSchemaClaims`/`loadSchema` at `schema:<name>`) and minted
the per-version, content-addressed VersionedSchema snapshots that serve §17's freezing; the
registration became a binding (`schema` → the living entity, `schemaVersion` → the frozen snapshot),
carried forward for stores on disk by the `inline-schema-to-entity` §20 migration (`src/migrate/`) —
single-lens, `Schema.name = hyperschema.name`. That landing also hardened the migration chain against
0.5.0's reuse of the `rhizomatic.schema.*` vocabulary and the `schema:` prefix for resolution Schemas:
the 0.3 role-realignment step now skips a store that already speaks `rhizomatic.hyperschema.*`, and the
slice-1 entity rename is role-scoped to genuine hyperschema references — so re-migrating a §21 store is
a no-op rather than a corruption. One implementation refinement to the picture above: the LIVE surface
resolves the latest SURVIVING binding against **its own snapshot**, not the living `schema:<name>`
entity. The two agree in the common case (every publish republishes the living entity), but diverge
under withdrawal — striking the latest registration does not negate its living-entity publish, so
resolving the living entity would keep serving a withdrawn shape; resolving the surviving binding's
snapshot keeps the live reading and §17's version door in lockstep. The living entity remains the
first-class, directly-loadable evolving node it is above; it is simply not the read path. The
implementation lives in `src/gateway/registration.ts` (`registrationDeltaClaims`,
`versionedSchemaEntityFor`), `src/gateway/gateway.ts`, and `src/gateway/genesis.ts`. **Coexistence** — two lenses over one hyperschema — remains deferred to its
own design-stage slice: this section pins the registry key `(hyperschema, schema-name)`, but the
SERVING surface (the GraphQL type/mutation/hooks keying, and the `schema.name == hyperschema.name`
single-lens naming) is unspecified and needs a design pass before build. The `VersionedHyperSchema`
rung above is symmetric and substrate-ready (`termHash`), built when §23 needs it.

**§21.7 BUILT** [#131](https://github.com/bombadil-labs/loam/pull/131) (realizes ticket T2,
2026-07-17) — the grouped serving surface, exactly as designed: `groupPrograms`
(`src/gateway/lifecycle.ts`) derives one PROGRAM per hyperschema — the gather, the union of member
roots, a lens map — computed in one place from the surviving bindings; the registry takes one
hyperschema per group, the reactor registers one materialization per program, and every door keys
per LENS (`lensOf`, `src/gateway/registration.ts`): the GraphQL family, REST's path segment, the
`loam.public` admission, and the §17 ladder. Latest-wins narrowed to latest-per-lens; the rival-body
termHash refusal fires at grouping before any state changes; the rebind rule (subset-rooted lenses
ride the additive path, a widened union rebinds the generation) decides at the program level. The
degenerate single-lens case is BYTE-IDENTICAL, held by snapshot rails
(`test/gateway/coexistence.test.ts`, 10 — which caught one mid-build SDL wording drift and forced
its revert) and zero collateral across the suite. No §20 migration — the lens name was already in
the binding's bytes (slice 2prime); nothing at rest moved. The village demonstrates it live
(`demos/village/phase-coexistence.mjs`: the Townbook and FirstImpressions lenses over one gather,
one public, one not). Serving-loop surface → Myk's merge (P6).
