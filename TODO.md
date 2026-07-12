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
- **derived fields are read-only — BLOCKED, do not build.** When rhizomatic grows resolve-time
  computed fields, the surface refuses a write to one with a reason — there is no backing delta to
  assert or retract. Blocked on the derived-field Policy vocabulary, which is a rhizomatic
  conversation (Myk's, in that repo), not a Loam workaround. §22's rung (e) reaches this same wall
  from the other side — one conversation unblocks both; until it happens, neither moves.
- **the immutable-by-default flip — DECISION, Myk's alone.** Shipped `writable` is opt-in
  RESTRICTION: absent → every field writable (today's permissive default). §14's original intent
  was the inverse — silence means "you may not." Flipping is a **breaking change**: every existing
  registration (village, tutorial, tests) needs a `writable` list or goes read-only, so it ships a
  §20 migration and every registration update in the same PR — and only after Myk says the word in
  chat. Until then the permissive default is correct behavior, not a bug to fix in passing.

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

1. Does the Schema become a first-class entity — its own id, its own deltas, resolvable like any
   domain node — with registration demoted to a BINDING (this hyperschema + this schema + these
   roots, served here)? The hyperschema half already works exactly this way.
2. What is a VersionedSchema at rest — the registration delta itself (today's de-facto answer),
   or a distinct snapshot entity, so a version can exist, be named, and be pinned WITHOUT being
   served? _The snapshot doctrine (above) frames this: a version is a reified snapshot of a
   coherent whole, related to its kin by supersession — settled. What the design stage still
   decides is only WHERE it lives; the doctrine's pin-without-serving pull favors the distinct
   snapshot entity. Prove it._
3. Many-to-many unlocking: the `registration:<schemaEntity>` keying and the name-unique registry
   both assume 1:1. A surface type then needs a name of its own, apart from the hyperschema's —
   what names a lens?
4. Where do `roots` belong on the ladder? The probe established they are a LIVENESS declaration
   (which entities stay hot), not a scope — which smells like a property of the binding/serving
   layer, not of the Schema.
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

1. Override or replacement — confirm `resolve` is optional atop an intact Policy (recommended),
   not a second resolution system beside it. One near-synonym here would violate the vocabulary
   rule; naming needs care.
2. Relation to rhizomatic's **`DerivedFn`** — derived fields compute NEW values from other
   fields; `resolve` re-represents THIS field's bucket; and rung (e) synthetics are new fields
   with no bucket at all, which is DerivedFn territory by another road. One concept or two?
   The §14-amendment item already marks derived fields blocked on a rhizomatic conversation;
   don't fork the vocabulary before that conversation happens.
3. Which rungs does v1 admit, and is the rung part of the signed schema definition (so a reader
   knows what kind of lens it is trusting)?
4. **What is a resolver at rest? — RESOLVED (Myk, 2026-07-12): the snapshot doctrine (above).**
   A resolver at rest is a delta asserting the content-addressed bytes of a named, versioned,
   coherent unit; the signature attests exactly the bytes that run; history is supersession
   claims; diff is a lens, never a storage format. The design stage TRANSCRIBES this into the
   SPEC §22 draft as a standalone subsection titled for reuse — §23 inherits it verbatim. One
   residue stays open: **source vs built artifact** (what the operator can AUDIT vs what the
   host can RUN — plausibly both, paired or superseding); settle that residue in the
   transcription, nothing else is left to invent.
5. Interaction with `writable` (§14): does a resolved field stay writable with an honest
   "round-trip not guaranteed" posture (recommended — writes hit the bucket, which is still
   real), or do rungs (c)/(d) default read-only like derived fields? Rung (e) is not a
   question: no bucket, no write — the surface refuses with a reason.
6. The caching/invalidation contract per rung — what does the gateway promise, and where does
   memoization live?
7. Is the resolver part of the lens identity — does changing a resolver constitute a new schema
   version under §17's append-only law? (§21's VersionedSchema question, arriving from the
   other side.)

**Guidance for the design stage (the posture, so it needn't be rediscovered):** recommend rung
(a) only for v1 unless Myk widens it — every higher rung spends a promise (caching, determinism,
federation replay) and nothing pending needs more than (a) to exist. Rung (e) is DESIGN-ONLY
until the DerivedFn conversation (question 2) happens in rhizomatic — describe it fully in the
SPEC draft, build none of it (the §14-amendment's derived-fields bullet is the same wall). And
question 4 (code at rest) is already resolved — the snapshot doctrine — so the design stage
transcribes, not invents: a standalone subsection written for reuse, its one open residue
(source vs artifact) settled inline; §23 inherits it verbatim.

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
  first — everything else is downstream of it.
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
  mounts, the sandbox story. Federation makes it acute; inert-by-default is the floor.
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

1. **What is a quarantine at rest?** A separate store that federates one-way inbound (stores are
   cheap, federation exists, and discard = drop the store — the machinery may already be 90%
   built), or a marked slice inside the primary store (one store to operate, but sequestration
   now rests on every reader honoring the mark)? The separate-store answer smells right; prove
   it.
2. **The one-way glass, precisely.** Live-follow of the primary's ground vs a frozen snapshot;
   whether quarantined code may even SEE capability-restricted slices; what "reads but never
   writes back" means when the substrate is grow-only union.
3. **Promotion semantics on append-only ground.** Promoting outputs cannot move deltas — it
   re-signs or endorses them (provenance preserved: adopted-from-quarantine, by whom, when).
   Pin the exact claim shape; this is close kin to §20's migration re-signing.
4. **Promotion of law is registration** — does promoting a schema out of quarantine reuse the
   ordinary publish/register path (it should), and does the quarantine record survive as
   provenance on the blessed thing?
5. **Resource discipline** — quarantined code is the purity ladder's (§22) wild end running for
   real: caps on compute, lazy materializations, effectful resolvers calling out. The
   quarantine's budget must not degrade the primary store's doors.
6. **The workflow question (Myk's "maybe this becomes default")** — is quarantine-first the
   POSTURE for all federated law, with the current inert-by-default as merely its degenerate
   no-quarantine case? Decide the default; both must remain expressible.
7. **The renderer tie-in (§23)** — a quarantined renderer needs a host willing to mount it in a
   visibly-sequestered frame ("this is probation, its writes go nowhere") — the trust UI of the
   stock host.

---

## Hardening pass — namespacing, entity-IDs, brick-proofing, repair

_Queued; draft as a SPEC section for Myk's review before implementing —
**quarantine-vs-refuse for corruption is his call.** See memory `hardening-pass-design` and
`localstorage-namespace-collision` (the brick bug that motivated it)._

Draft a new SPEC section covering: backend namespace marking (a store owning its whole key
prefix must not brick when a stray non-delta key lands — see the tutorial's `healStrayKeys`
recovery); quarantine-vs-refuse semantics for a corrupt row on read (refuse-the-store vs
isolate-the-row — Myk decides); boot resilience; an entity-ID reserved-vs-user convention (so
constitutional ids can't collide with app ids); and `loam repair` tooling. Then STOP for review.

