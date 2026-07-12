# Loam — the backlog

_Unbuilt and partially-designed spec steps live here, not in [SPEC.md](SPEC.md). SPEC.md is the
record of what **is** — grown only by a landing PR, every section carrying a `**Provenance.**`
footer. An item here is drafted, refined, and argued over freely; when its work lands, **the same
PR deletes it from this file and writes the finished section into SPEC.md** with its provenance
footer. That keeps the spec honest (only shipped design) and this list honest (only pending
design). Reserved section numbers are noted so a landed item slots back into place without
renumbering the sections that already reference each other._

Ordering is rough priority, top-first; Myk sets it. Each item says what it needs before code.

**How to read this file (notes for the builder — hard-won; don't relearn them):**

- **The dependency spine is strict: §21 → §22 → §23 → §24 → hardening pass.** Do not start an
  item's implementation before everything it depends on is IN SPEC.md — merged, provenance footer
  and all. The §14 amendment stands off the spine and may interleave anywhere.
- **"Opens at the design stage" is a deliverable, not a mood.** It means: the step's first output
  is the drafted SPEC-section prose (staged to migrate on landing) plus answers to the item's
  listed design questions — and then you STOP and wait for Myk's word in chat before writing
  implementation code. "He'd probably approve" is not his word.
- **"(Myk)" / "Myk's call" marks a decision that needs his sentence in chat.** Do not resolve it
  by inference, however obvious the answer looks. Likewise anything **blocked on a rhizomatic
  conversation**: rhizomatic is frozen — no Loam workaround, no forked vocabulary, no edits to
  that repo. Note the wall and route around it.
- **A breaking on-wire change ships its §20 migration in the same implementing PR**, and the
  changed deltas must be shape-distinguishable from every prior version (CLAUDE.md, hard rule).
  A design-stage PR ships no migration — the migration rides the code that makes the break real.
- **Reserved section numbers are load-bearing** — items cite each other by them. Never renumber.
- **"Lens" is prose, not a type.** Throughout these docs (SPEC.md included) it names the
  reading-side assembly — a Schema over a hyperschema, the composed thing that turns shared
  ground into a View. Mostly it just means the Schema. No exported type carries the name today;
  §21 question 3 ("what names a lens?") is where the design decides whether it gets one. Until
  then, write `Schema` when you mean the Schema.

---

## §14 amendment — the remaining write verbs (edges, derived, and the default flip)

_Most of write semantics **landed** in SPEC §14
([#73](https://github.com/bombadil-labs/loam/pull/73)): the two primitives (assert / retract), `clear`
(retract-your-own → absence), `remove` (value-scoped retract), and optional `writable` declaration —
both doors. The open "clear-others" question is **resolved**: retract-your-own is the floor and the
ceiling; shaping a view against others' claims is the schema **Policy's** job, not a negation's (Myk,
2026-07-12). What remains are two narrow surface verbs and one posture decision. When they land they
are an **amendment appended to SPEC §14**, not a new section._

- **expanded / relational edges as first-class verbs — READY TO BUILD.** The uniform
  `clear`/`remove` already negate edge deltas; name them — `link` (assert the edge) and `sever`
  (retract it) — so the write surface speaks the relation, and never pretends you write INTO the
  nested entity's resolved value (that is its own Schema over its own ground). The real work: the
  `expand` that marks a field as an edge lives in the **hyperschema's gather body**, not the
  Schema, so the surface must learn to read the published hyperschema definition (not the inline
  Schema) to know which fields are edges — and offer entity-pointer, not primitive-value, writes
  for them. Two facts that save a day: (1) if `link`/`sever` are pure surface sugar over
  assert/retract of the SAME edge-delta shape already on the wire, there is no on-wire change and
  therefore no migration — keep it that way unless the design genuinely forces otherwise; (2) the
  shipped write verbs and `writable` live in `src/gateway/gateway.ts` + `src/surface/surface.ts`,
  and the hyperschema definition is loaded via `src/gateway/registration.ts` — start there.
- **derived fields are read-only — UNBLOCKED (Myk, 2026-07-12), re-scoped into §22.** The
  rhizomatic conversation happened: `DerivedFn` is write-side computation — HView in, signed
  CLAIMS out, "everything that computes is an author" — and needs no changes (§22 question 2
  has the full resolution). Loam's read-time computed field is §22's rung (e) synthetic,
  read-only by construction; when synthetics land, the surface refuses writes to them with a
  reason. Nothing remains of this bullet but that refusal, and it ships with §22 — delete this
  bullet when §22 lands.
- **the immutable-by-default flip — DECIDED (Myk, 2026-07-12): flip it, riding §21's migration
  wave.** §14's original intent wins: silence means "you may not." The flip is breaking, so it
  lands WITH the §21 implementing PR — which already ships a §20 migration for the `schema:`
  rename — one wave, one migration, every existing registration (village, tutorial, tests)
  gaining its explicit `writable` list in the same change. Strictness arrives before renderers
  and federation grow the ecosystem. Do not flip ahead of that wave; until it, the permissive
  default is correct behavior, not a bug to fix in passing.

---

## The snapshot doctrine — code, schemas, and documents at rest (DECIDED)

_Resolved in conversation (Myk + Claude, 2026-07-12). Cross-cutting doctrine, not its own SPEC
section: it **lands with §22** (its natural home — the "what is a resolver at rest" answer), and
§21, §23, §24 cite it. Recorded here so no design stage reopens it from scratch._

Our deltas cannot do track changes — and neither can git's object model: blobs are whole
snapshots, and every diff anyone has ever read was computed at read time from two snapshots plus
a lineage relation. That is not the missing feature; it is the design. Accordingly:

- **Deltas assert versions of coherent wholes, plus supersession claims relating them.** Never
  edits. History is `supersededBy` lineage — §17's append-only law, close kin to §20's
  re-sign-and-negate.
- **Diff is a lens.** Line diff, AST diff, semantic diff — derived views over two attested
  snapshots, chosen by the reader, never a storage format. Likewise the AST, the outline, the
  symbol table: structure WITHIN a unit is computed from the bytes, not stored as ground. The
  bytes are the ground truth; the AST never was.
- **The granularity of a delta is the granularity of attestation — what would an author sign?**
  Nobody signs a keystroke; nobody means an AST node in isolation. For code the unit is the
  module/artifact, and the signature attests EXACTLY the bytes that run — which is what §24's
  trust story requires. A swarm of signed fragments carries no signature on the combination a
  reader manufactures from them; a substrate that assembles values from independent claims
  manufactures interleavings nobody wrote, tested, or meant.
- **Structure BETWEEN coherence units lives in deltas.** Module entities with import edges, a
  document's outline — queryable, per-unit provenance, targeted supersession. The graph is
  delta-native; the leaves are atomic.
- **Ordering is an authored claim.** A container's arrangement is asserted as a value at the
  container level, signed as a whole; concurrent rearrangements CONFLICT visibly (§13's honest
  posture) instead of interleaving silently into an order nobody chose.
- **The economics ladder: inline bytes → content-addressed ref → Merkle-chunked tree.** All
  three are snapshot semantics — every version a complete whole — only the storage costs change.
  Content addressing already dedups unchanged units across versions. v1 stops at the first rung
  that fits in a delta.
- **Live collaborative editing, if it ever comes, is an ephemeral layer** (a CRDT session, an
  editor buffer) that periodically ASSERTS snapshots into the ground. Editing is conversation;
  the delta is the notarized statement at the end of it.

And this is §21's picture wearing different clothes: a living Schema evolving as a domain node,
reified by snapshot into a fixed, content-addressed VersionedSchema — the same doctrine arriving
at versioning instead of code. One picture, every rung of the ladder.

---

## Reserved §21 — Schema identity & versioning: untangling the lens ladder

_Opened by Myk 2026-07-12, off a late-night probe of the `loam register` payload. **NOT YET
SCOPED — opens at the design stage,** and it lands BEFORE resolvers (§22) and renderers (§23):
both need a schema identity that can be named, multiplied, and pinned, and today's registration
model gives them none of the three._

**What the probe found (facts, with receipts):**

- **A second lens over a hyperschema REPLACES the first.** A registration files under
  `registration:<schemaEntity>`, latest wins (`registration.ts` — `registrationEntity`), and the
  registry refuses duplicate hyperschema names, so hyperschema : Schema : roots binds 1:1:1 by
  construction. There is no way to hold two Schemas over one gather program — the thing the
  whole HyperSchema/Schema symmetry promises. Not good (Myk).
- **The two halves have different standings at rest.** The hyperschema definition is a
  REFERENCE — it lives at its own entity, published as schema-schema deltas, and the
  registration merely points at it. The Schema is a CARRIER — inline canonical JSON inside the
  registration delta. Half the decoupling road is already paved; the Schema half never got its
  own identity.
- **Naming conflation residue.** The hyperschema definition entity defaults to `schema:<Name>`
  (`schemaEntityFor`), and Loam's prose says "schema entity" throughout — for what is the
  HYPERSCHEMA. The 0.3.0 vocabulary pass expunged this at the delta level
  (`rhizomatic.hyperschema.*`) but not in Loam's ids and comments. (Rhizomatic's own
  `loadSchema`/`publishSchemaClaims` load and publish HyperSchemas — frozen substrate naming, a
  conversation in that repo, not ours to fix here.) Renaming Loam's `schema:` prefix is a
  breaking on-wire change → ships a §20 migration in the same PR.
- **A proto-VersionedSchema already exists.** `readRegistrationVersions` (§17) pins each
  surviving registration delta — Schema + roots as canonical JSON — by its content address, the
  version's TRUE NAME. What's missing is everything upstream of it: the version snapshots a
  *registration*, because a registration is the only identity a Schema has.

**The proposed ladder (Myk):**

> **HyperSchema** —many→ **Schema** —many→ **VersionedSchema** —many→ **API** (GraphQL, REST,
> whatever)

A Schema is a LIVING domain node — a view computed from deltas via the Schema Schema, evolving
like anything else in the system — until it is snapshotted and REIFIED into a fixed
VersionedSchema (plausibly literally the canonical JSON string, content-addressed). Doors serve
VersionedSchemas; the living Schema goes on living.

**Design questions:**

1. **DECIDED (Myk, 2026-07-12): yes.** The Schema becomes a first-class entity — its own id, its
   own deltas, resolvable like any domain node — with registration demoted to a BINDING (this
   hyperschema + this schema + these roots, served here). The hyperschema half already works
   exactly this way; the design stage's job is the shape, not the whether.
2. **DECIDED (Myk, 2026-07-12): a distinct snapshot entity**, not the registration delta — a
   version can exist, be named, and be pinned WITHOUT being served, exactly as the snapshot
   doctrine (above) pulls. The design stage pins its shape (plausibly literally the canonical
   JSON, content-addressed) and its supersession wiring.
3. Many-to-many unlocking: the `registration:<schemaEntity>` keying and the name-unique registry
   both assume 1:1. A surface type then needs a name of its own, apart from the hyperschema's —
   what names a lens?
4. **DECIDED (Myk, 2026-07-12): the binding/serving layer.** The probe established roots are a
   LIVENESS declaration (which entities stay hot), not a scope; they ride the
   registration-as-binding, never the Schema.
5. The naming pass — expunge the remaining schema/hyperschema blur in Loam's ids and prose;
   every on-wire rename ships its migration (§20).
6. How the upper rungs stand on this: a resolver (§22) rides the Schema and is presumably part
   of what a VersionedSchema freezes; a renderer (§23) PINS a VersionedSchema — "renderer pinned
   to schema vN keeps working forever" needs exactly this ladder under it.

**Definition of done for the design stage:** a drafted SPEC §21 answering all six questions,
argued in a PR, and Myk's sign-off in chat — only then implementation. **Code anchors** for the
probe's facts: `schemaEntityFor` (`src/gateway/registration.ts:146`), `readRegistrationVersions`
(`src/gateway/registration.ts:463`), and `registrationEntity` + the duplicate-name refusal in the
same file. **Traps:** the `schema:` prefix rename (question 5) is on-wire — its migration rides
the implementing PR, and the renamed entity ids must be shape-distinguishable from the old form;
and rhizomatic's `loadSchema`/`publishSchemaClaims` names are frozen substrate — leave them,
record the mismatch in prose only.

---

## Reserved §22 — Custom resolvers: the last step of the lens becomes programmable

_Proposed by Myk 2026-07-12; musings + open questions appended by Claude the same night. **NOT
YET SCOPED — opens at the design stage.** Lands after schema identity (§21), whose ladder it
rides, and before renderers (§23) because it settles the "code shipped as deltas" question
renderers inherit._

Today a field's **Policy** does two jobs in one breath: **selection** (which claims from the
gathered bucket count — `pick`'s ordering, `all`'s inclusion, `conflicts`' refusal) and
**representation** (what value the survivors denote — a `merge`'s fold, `absentAs`'s rendering
of silence). The proposal: factor out an optional Loam-level **`resolve(deltas) → value`**,
downstream of the Policy. The Policy keeps the epistemics — whose claims, in what order, what
counts as disagreement; the closed rhizomatic algebra, untouched and frozen. `resolve` overrides
the semantics — what those surviving claims *mean* as a value in this lens. Absent a custom
`resolve`, the Policy's built-in representation stands, exactly as today; nothing existing moves.

What it opens: a field whose value is a computation over its bucket (trend, histogram, latest-N),
a field that consults its siblings in the HyperView, a field that reaches past the selection into
the store, even a field that leaves the store entirely and asks a remote API. The View stops
being limited to the six shapes the Policy algebra happens to export and becomes what an app
means by its data — while the ground stays pure deltas and rhizomatic stays closed.

**Musing — is this overlapping what policies already do? Did we overcook Policy?** Claude's
read: the Policy isn't overcooked, it's *doing two jobs*, and only the second is the one that
chafes. Selection is trust-and-provenance work and MUST stay in the closed algebra — §14 leans
on it (writes are the dual of resolution *because* resolution is a known program). But
representation was only ever a default, and Loam currently offers no way past it — that is the
artificial constraint Myk is feeling, and it is Loam-surface, not substrate. An optional
override at the lens layer recovers full expressiveness with **zero rhizomatic changes**.
Whether `sum`/`average` should *long-term* migrate out of Policy into resolve is a real
question — but rhizomatic is frozen, so it is a conversation with Myk in that repo, not a Loam
decision; Loam's move is to make the question moot by letting resolve supersede.

**The §14 consonance (this is the pleasant surprise):** writes never needed the value function.
`assert` / `retract` / `clear` / `remove` act on the *bucket* — the ground — and clear works "by
construction" precisely because it lets resolution re-run without caring what resolution
computes. So a custom `resolve` does not break the write mechanism; it breaks *predictability*
(write `x`, read back `f(x)`). And Loam already refuses to promise more than that — §13's
posture, views are perspectival, absence is unknown. The surface just has to say so honestly.

**The purity ladder** — not all resolvers cost the same, and the rung should probably be
declared in the schema at rest, not discovered at runtime:

- **(a) bucket-pure** — a function of the selected deltas only. Cacheable, deterministic,
  testable; the gentlest rung, and maybe the only one v1 admits.
- **(b) hyperview-scoped** — may read sibling fields' buckets. Still deterministic given the
  HyperView; invalidation widens to the entity.
- **(c) store-querying** — reaches past the selection. Deterministic given the store, but
  hyperview-local invalidation is gone.
- **(d) effectful** — remote APIs, clocks, anything. The view is no longer a function of the
  ground; two readers of the same deltas see different values. Philosophically admissible
  (lenses were never promised to agree — only the ground is shared) but it forfeits caching,
  reproducibility, and any federation story that replays views.
- **(e) synthetic** — the top of the ladder (Myk, 2026-07-12): a Schema property with **no
  analog in the HyperView at all**. No bucket, no Policy, no gather — `resolve` is the field's
  entire existence, an arbitrary function the schema designer invents. The Schema stops being
  only a resolution discipline over gathered ground and becomes, in part, a *program* whose
  output happens to be shaped like a View. Strictly this is a second axis, not just a higher
  rung — (a)–(d) grade what a resolver of an existing field may READ; (e) drops the requirement
  that the field correspond to anything gathered — but it composes with the input rungs (a
  synthetic field may still be bucket-… well, there is no bucket; hyperview-scoped, store-
  querying, or effectful). Two consequences fall out immediately: a synthetic field is
  **read-only by definition** (there is no ground to assert against or retract from — the
  §14-amendment's derived-fields bullet arrives early, at the Loam layer), and it is where the
  overlap with rhizomatic's **`DerivedFn`** stops being a naming question and becomes a design
  question (open question 2 below is load-bearing, not hygiene).

**Open questions for the design stage:**

1. **DECIDED (Myk, 2026-07-12): override.** `resolve` is optional atop an intact Policy, never a
   second resolution system beside it. Naming still needs care — no near-synonyms.
2. **RESOLVED (Myk, 2026-07-12): read/write DUALS — keep both, touch nothing in rhizomatic.**
   `DerivedFn` (substrate, `implementations/ts/src/derivation.ts`) is write-side computation:
   HView in, signed claims OUT — "everything that computes is an author," outputs on the record
   with `rdb.derived.*` provenance down to the input HView's content address. `resolve` is
   read-side: ground in, VALUE out, perspectival, never touching the record. They don't compete;
   the per-field design choice is "should this computation's output be a claim or an
   interpretation?" Rung (e) synthetics are resolve territory (nothing is asserted) — the old
   "DerivedFn by another road" worry was a false alarm. Vocabulary guard: **"derived" is reserved
   for the write side; the read side says "resolver" / "synthetic."** Signpost for the ladder: a
   rung (c)/(d) resolver that wants to REMEMBER what it computed doesn't want to be a resolver —
   it wants to be a derived author. (§24's promote-the-outputs rides derived authorship; this
   dual is load-bearing there.)
3. **DECIDED (Myk, 2026-07-12): v1 BUILDS rung (a) only; the design admits the whole ladder; the
   rung is part of the signed schema definition**, so a reader knows what kind of lens it is
   trusting.
4. **What is a resolver at rest? — RESOLVED (Myk, 2026-07-12): the snapshot doctrine (above).**
   A resolver at rest is a delta asserting the content-addressed bytes of a named, versioned,
   coherent unit; the signature attests exactly the bytes that run; history is supersession
   claims; diff is a lens, never a storage format. The design stage TRANSCRIBES this into the
   SPEC §22 draft as a standalone subsection titled for reuse — §23 inherits it verbatim. The
   residue is settled too **(Myk, 2026-07-12): executable source.** The delta asserts
   directly-runnable ESM — what you audit IS what runs, one hash, no signed-vs-executed gap;
   building is the pusher's business, done before pushing; an optional provenance claim may link
   the runnable bytes to their pre-build sources for deeper audit. Nothing left to invent, only
   to word.
5. **DECIDED (Myk, 2026-07-12): writability stays orthogonal at every rung** — writes hit the
   bucket, which is real; the surface documents the honest "round-trip not guaranteed" posture
   for resolved fields. Rung (e) never was a question: no bucket, no write — refused with a
   reason.
6. The caching/invalidation contract per rung — what does the gateway promise, and where does
   memoization live? (Still open — genuine design-stage work.)
7. **DECIDED (Myk, 2026-07-12): yes.** The resolver's content address is part of what a
   VersionedSchema freezes; changing a resolver is a new schema version under §17's append-only
   law.
8. **Output types for the doors (gap sweep, 2026-07-12).** A resolver changes what a field's
   VALUE is, and the doors generate types from the registration (§17 — GraphQL fields, OpenAPI
   shapes). The signed definition must therefore declare the resolver's output TYPE alongside
   its rung, or the surfaces cannot speak the field they serve. Without it, a resolver that
   turns a `pick` string into a histogram breaks every generated door silently.

**Guidance for the design stage (the posture, so it needn't be rediscovered):** with questions
1–5 and 7 decided above, the design stage DESCRIBES the whole ladder, BUILDS rung (a) only, and
has exactly one open question left to argue: the caching/invalidation contract (question 6).
Rung (e) is design-only in v1 by question 3's decision — the DerivedFn wall is gone (question 2
resolved it as duals), so describe synthetics fully and build none of them yet. Question 4 is
transcription, not invention: a standalone subsection written for reuse; §23 inherits it
verbatim.

---

## Reserved §23 — Renderers: push deltas, get software

_Handed over by Myk 2026-07-11; reframed 2026-07-12. **NOT YET SCOPED — opens at the design
stage.** Draft the SPEC section, then STOP for Myk before implementation code. Depends on §21
(schema identity — a renderer pins a VersionedSchema) and §22 (resolvers — the executable-delta
doctrine). See memory `renderer-task`._

A Loam store already carries its own schema, its own doors, its own law — everything except its
own face. Close that gap: **a renderer is a UI component pushed as deltas**, bound to a Schema
and a route, and **Loam ships a stock React host** — a running app whose router is *derived from
the store*. Push a renderer delta and the route exists; no build, no deploy, no app store
between an idea and the people it's for. §17 said surfaces are materializations of the
registration — GraphQL, REST, OpenAPI. This is the same law arriving at the screen: **a renderer
is a surface whose door is pixels.** The database is the deployment.

What becomes possible when this works:

- **The village becomes a place, not a script** — a URL where every phase's stores render
  themselves, and growing a store mid-meeting grows the town in the browser.
- **Federation ships apps, not just data.** Join a confluence and its interfaces arrive with its
  ground — a peer's board renders in your host, inert-by-default like foreign law (§8/§12)
  until the operator blesses it. Software distribution becomes delta replication.
- **Local-first, live by construction** — a renderer subscribes to a View over local ground;
  writes go through the §14 verbs; offline is just the store being a store.
- **An ecosystem on the substrate's own mechanics** — renderers are signed, versioned (§17 law),
  content-addressed, forkable, supersedable. The app-store problems (provenance, updates,
  rollback) are already solved by the delta model; we just point it at UI.

What must be designed before any code (the real work):

- **The host contract** — what a mounted renderer receives: a resolved View + a live
  subscription + the write verbs (`assert`/`clear`/`remove`) as **capability-scoped handles**,
  never raw store access. The renderer speaks lens; the host holds the keys. Pin this down
  first — everything else is downstream of it. Two sub-questions the 2026-07-12 gap sweep
  added: **whose pen writes** — a click in a foreign renderer becomes a delta signed by WHICH
  identity (the user's own key, or a per-renderer granted author, so provenance shows the
  mediating code and revocation is per-renderer? §19's write-path labels — door, pen, wire,
  derived — gain a fifth value here); and **the module contract** — what the host provides
  ambient (React, the loam client) versus what a renderer must bundle INTO its snapshot unit.
  Ambient must be tiny and versioned: the bundle IS the attested artifact.
- **The economics arrive early (gap sweep, 2026-07-12).** A bundled UI riding in a delta is
  store-sized data: the browser peer's ~5 MB origin quota (§15) meets renderer snapshots
  immediately, so the snapshot doctrine's later rungs (content-addressed ref, chunked tree)
  likely graduate from "later economics" to §23 v1 design questions. Budget for it in the
  design; don't discover it in the demo. Related, proposed by Myk (2026-07-12): **a rhizomatic
  0.4 `bytes` primitive** — an ADDITIVE Target kind `{ kind: "bytes", mime, value }`, identity
  hashed over raw bytes (encoding is transport, never identity; base64url in JSON wire, native
  byte string in CBOR), MIME riding in-kind as attested interpretation-testimony. Additive ⇒ no
  migration (shape-distinct by construction, the §20 corollary free); old peers refusing the
  unknown kind is version discipline, not breakage. Not needed for §21/§22 (v1 resolvers are
  text ESM); becomes pressing here. It is a rhizomatic conversation — Myk opens it in that
  repo; §23's design names it a dependency for binary assets and does NOT treat the primitive
  as a blob store (it is the inline rung only; big assets still climb the ladder).
- **The public-door tension (gap sweep, 2026-07-12).** §17 deliberately serves only the LATEST
  version per declared name on the ANONYMOUS door (hash probes were an existence oracle) — but
  a renderer PINS a VersionedSchema, and the village-as-a-URL wants strangers reading rendered
  routes. Reconcile explicitly: plausibly a public declaration may name pinned versions (a
  declaration is not a probe — the operator chose to reveal that version), but that is a
  §12/§17 amendment and must be argued, not assumed.
- **What a renderer delta IS — RESOLVED by inheritance:** the snapshot doctrine (above §21,
  landing in §22). A renderer at rest is a delta asserting the content-addressed bytes of a
  whole, versioned unit; the signature attests exactly what mounts; history is supersession.
  The source-vs-artifact residue is settled once, in §22's transcription — do not reopen it
  here. One answer for both kinds of shipped code, by construction.
- **Proven at push time, not hoped at runtime** — a renderer declares the schema(s) + version it
  consumes; the door checks that declaration against the registered surface (the
  SurfaceGenerator seam, §17, is the natural anchor) and REFUSES a mismatch. Pin down the exact
  compatibility relation.
- **Versioning under §17 law** — renderers born versioned, append-only; pinned to schema vN a
  renderer keeps working forever; decide what happens when vN is struck.
- **Trust for executable consumers — the sharpest edge.** Who may push, whose renderers a host
  mounts, the sandbox story. Federation makes it acute; inert-by-default is the floor. The
  sandbox story does not start from zero: §6 already names object-capability confinement
  (SES / Worker / wasm compartments) as the discipline for federated code in the runner —
  renderers inherit that doctrine at the screen, they don't invent a parallel one.
- **The router discipline** — how a renderer claims a route, who owns the namespace, collisions,
  multiple renderers over one schema (a Schema is a lens; there is no reason it has only one
  face).

Closest existing machinery: SPEC §17 — renderers are the read side of the same story; the
SurfaceGenerator seam lives in `src/surface/surface.ts`. For review, use a specialized panel
(substrate-semantics · capability-security · correctness-API), not one generalist — this is the
sanctioned exception to the one-reviewer budget rule (CLAUDE.md names capability/federation work
as panel-worthy): three tightly-scoped angles, findings capped per angle, no separate verify
stage (the fixer verifies while fixing — audit 1's retro).

---

## Reserved §24 — The quarantine: a place where untrusted law may bind

_Proposed by Myk 2026-07-12 as the stretch goal of the arc; lands after renderers (§23), before
the hardening pass. **NOT YET SCOPED — opens at the design stage.** Do not open this item — even
its design stage — before §23 is merged into SPEC.md: the host contract, the code-at-rest
doctrine, and the trust UI are inputs here, and designing against guesses of them wastes the
work twice._

Today, foreign law is inert-by-default (§8/§12): a remote-authored schema, function, or renderer
merges as data and binds nothing — safe, and also *untestable*. The only way to see what a
foreign lens does is to bless it, at which point it is already law. Close that gap with a
**quarantine**: a sandboxed environment where untrusted, remote-authored schemas, resolvers, and
renderers actually RUN — bind, materialize, render — but where everything they produce is
**sequestered from the primary pool**. Dry-run a stranger's whole app against your real ground,
watch what it computes, and throw it all away if you don't like it.

The shape that wants to exist: **one-way glass.** The quarantine reads the primary store's
ground (or a snapshot of it) but writes only into its own pool; nothing crosses back without a
deliberate act. That act is **promotion**, and it comes in two distinct strengths:

- **Promote the law** — the operator blesses the schema/resolver/renderer itself into the
  primary store; it becomes bound like anything operator-registered. The quarantine was its
  probation.
- **Promote the outputs only** — the operator adopts specific deltas the quarantined thing
  produced (re-signed or endorsed as the operator's own claims) while the code that made them
  STAYS sequestered. "I like what it said, not what it is."

And maybe this is not a feature but **the default workflow**: everything remote-authored lands
in quarantine first, runs there, and blessing is always a promotion out of it — trust as a
pipeline with a visible staging area, instead of a boolean flipped in the dark.

The snapshot doctrine (above §21) is load-bearing here: the thing on probation is a fixed,
content-addressed, author-attested artifact — not a swarm of fragments that might resolve
differently tomorrow. Quarantine judges a snapshot; promotion promotes a snapshot.

Design questions:

1. **What is a quarantine at rest? — DECIDED as posture (Myk, 2026-07-12): a separate store,
   federating one-way inbound.** Stores are cheap, federation exists, discard = drop the store —
   and sequestration must not rest on every reader honoring a mark. The design stage PROVES it
   rather than debates it; if the proof fails, that is news — bring it back.
2. **The one-way glass, precisely.** Live-follow of the primary's ground vs a frozen snapshot;
   what "reads but never writes back" means when the substrate is grow-only union. (Honesty
   note from the 2026-07-12 gap sweep: Loam has no read-side capability slices today — the
   mount is the read boundary, §7 — so "what quarantined code may see" is all-or-nothing
   unless this design invents something narrower. Don't reference machinery that doesn't
   exist; decide whether to build it or accept all-or-nothing.)
3. **Promotion semantics on append-only ground.** Promoting outputs cannot move deltas — it
   re-signs or endorses them (provenance preserved: adopted-from-quarantine, by whom, when).
   Pin the exact claim shape; this is close kin to §20's migration re-signing.
4. **Promotion of law is registration** — does promoting a schema out of quarantine reuse the
   ordinary publish/register path (it should), and does the quarantine record survive as
   provenance on the blessed thing?
5. **Resource discipline** — quarantined code is the purity ladder's (§22) wild end running for
   real: caps on compute, lazy materializations, effectful resolvers calling out. The
   quarantine's budget must not degrade the primary store's doors.
6. **The workflow question — DECIDED (Myk, 2026-07-12): quarantine-first is the POSTURE** for
   all federated law, with inert-by-default as its degenerate no-quarantine case. The default
   flips only when the quarantine actually ships; both remain expressible forever.
7. **The renderer tie-in (§23)** — a quarantined renderer needs a host willing to mount it in a
   visibly-sequestered frame ("this is probation, its writes go nowhere") — the trust UI of the
   stock host.
8. **Erasure must reach the quarantine (gap sweep, 2026-07-12).** The quarantine holds a
   replica of primary ground; if tombstone + purge (§11) do not propagate into it, the
   quarantine becomes an erasure-EVASION vector — the forgotten bytes live on in the staging
   area, inside the operator's own walls. The one-way glass must carry the operator's
   tombstones IN even though nothing flows back out. Pin this with a test at design time; it
   is the §11 law arriving at §24, not an optional nicety.

---

## Hardening pass — namespacing, entity-IDs, brick-proofing, repair

_Queued; draft as a SPEC section for Myk's review before implementing. The corruption call is
made (below); what remains for his review is the section itself. See memory
`hardening-pass-design` and `localstorage-namespace-collision` (the brick bug that motivated
it)._

Draft a new SPEC section covering: backend namespace marking (a store owning its whole key
prefix must not brick when a stray non-delta key lands — see the tutorial's `healStrayKeys`
recovery); corrupt-row semantics — **DECIDED (Myk, 2026-07-12): quarantine the row, never the
store.** A corrupt or stray row is isolated and reported, boot proceeds, and `loam repair` lists
and resolves what's quarantined; in a grow-only union store absence is already a legal,
interpretable state (§13), so an isolated row reads as not-yet-synced — the store must never
brick; boot resilience; an entity-ID reserved-vs-user convention (so constitutional ids can't
collide with app ids); door resource budgets beyond the public ones (§12 caps strangers, but a
granted author's appends are unmetered — decide whether per-author quotas are law or deployment
config); and `loam repair` tooling. Then STOP for review.

---

## As-of reads — the temporal promise, queued or renounced

_Flagged by the 2026-07-12 gap sweep; unscheduled — after the §21–§24 arc. The SPEC's first
sentence calls the substrate TEMPORAL; §7 calls capabilities time-traveled; §19's tutorial copy
names "as-of replay" as explicitly out UNTIL BUILT — but no backlog item existed. The ground
already holds everything needed (timestamped deltas, dated negations, replayable
materializations). Scope it when its turn comes: an as-of parameter on `query` (resolve against
the ground as it stood at T), its interaction with erasure (purged is purged even in the past —
§11 wins), whether subscriptions can replay, and what a VersionedSchema pin means when the
reader also pins a time. Or renounce it into §13 as a boundary, stated proudly. Either is
honest; a promise with no backlog home was the only wrong state._

