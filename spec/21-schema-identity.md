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
just what it means for a name to name something. Two operators may still bind different Schemas under
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

**Boundaries, in the §13 register.** A VersionedSchema fixes a READING, not a promise about the ground:
the data it resolves goes on growing, so "pinned" means the lens is stable, not that the answer is
frozen. A binding is serving discipline, not authority: binding a Schema at a door never widens what
that door may lawfully answer (§17), and un-binding a version stops serving it without erasing it. And
a Schema is an entity in an open store, so a foreign peer may hold its own Schema under the same
`(hyperschema, name)` pair — whose reading binds is a question of law (§7), the same as every other
delta; the registry keys locally, and federation resolves globally.

**Provenance.** Design accepted (Myk, 2026-07-13); **landing in slices.** Slice 1 — the
`schema:`→`hyperschema:` entity rename + the §14 immutable-by-default flip in one §20 migration —
landed [#92](https://github.com/bombadil-labs/loam/pull/92). Slice 2 (in progress) lifts the Schema to
a first-class entity via 0.5.0's `SCHEMA_SCHEMA` and mints the per-version VersionedSchema snapshots
that serve §17's freezing (single-lens, `Schema.name = hyperschema.name`). **Coexistence** — two lenses
over one hyperschema — is deferred to its own design-stage slice: this section pins the registry key
`(hyperschema, schema-name)`, but the SERVING surface (the GraphQL type/mutation/hooks keying, and the
`schema.name == hyperschema.name` single-lens naming) is unspecified and needs a design pass before
build. The `VersionedHyperSchema` rung above is symmetric and substrate-ready (`termHash`), built when
§23 needs it.
