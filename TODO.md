# Loam — the backlog

_Unbuilt and partially-designed spec steps live here, not in [SPEC.md](SPEC.md). SPEC.md is the
record of what **is** — grown only by a landing PR, every section carrying a `**Provenance.**`
footer. An item here is drafted, refined, and argued over freely; when its work lands, **the same
PR deletes it from this file and writes the finished section into SPEC.md** with its provenance
footer. That keeps the spec honest (only shipped design) and this list honest (only pending
design). Reserved section numbers are noted so a landed item slots back into place without
renumbering the sections that already reference each other._

Ordering is rough priority, top-first; Myk sets it. Each item says what it needs before code.

---

## §14 amendment — the remaining write verbs (edges, derived, and the default flip)

_Most of write semantics **landed** in SPEC §14
([#73](https://github.com/bombadil-labs/loam/pull/73)): the two primitives (assert / retract), `clear`
(retract-your-own → absence), `remove` (value-scoped retract), and optional `writable` declaration —
both doors. The open "clear-others" question is **resolved**: retract-your-own is the floor and the
ceiling; shaping a view against others' claims is the schema **Policy's** job, not a negation's (Myk,
2026-07-12). What remains are two narrow surface verbs and one posture decision. When they land they
are an **amendment appended to SPEC §14**, not a new section._

- **expanded / relational edges as first-class verbs.** The uniform `clear`/`remove` already negate
  edge deltas; name them — `link` (assert the edge) and `sever` (retract it) — so the write surface
  speaks the relation, and never pretends you write INTO the nested entity's resolved value (that is
  its own Schema over its own ground). The real work: the `expand` that marks a field as an edge lives
  in the **hyperschema's gather body**, not the Schema, so the surface must learn to read the body to
  know which fields are edges (and offer entity-pointer, not primitive-value, writes for them).
- **derived fields are read-only.** When rhizomatic grows resolve-time computed fields, the surface
  refuses a write to one with a reason — there is no backing delta to assert or retract. **Blocked**
  on the derived-field Policy vocabulary, which is a rhizomatic conversation, not a Loam workaround.
- **the immutable-by-default flip (a decision for Myk).** Shipped `writable` is opt-in RESTRICTION:
  absent → every field writable (today's permissive default). §14's original intent was the inverse —
  silence means "you may not." Flipping the default is a **breaking change**: every existing
  registration (village, tutorial, tests) would need a `writable` list or go read-only, so it needs a
  migration and Myk's call on whether the stricter posture is worth it. Left as opt-in until then.

---

## Reserved §21 — Custom resolvers: the last step of the lens becomes programmable

_Proposed by Myk 2026-07-12; musings + open questions appended by Claude the same night. **NOT
YET SCOPED — opens at the design stage.** Lands before renderers (§22) because it settles the
"code shipped as deltas" question renderers inherit._

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

**Open questions for the design stage:**

1. Override or replacement — confirm `resolve` is optional atop an intact Policy (recommended),
   not a second resolution system beside it. One near-synonym here would violate the vocabulary
   rule; naming needs care.
2. Relation to rhizomatic's **`DerivedFn`** — derived fields compute NEW values from other
   fields; `resolve` re-represents THIS field's bucket. One concept or two? The §14-amendment
   item already marks derived fields blocked on a rhizomatic conversation; don't fork the
   vocabulary before that conversation happens.
3. Which rungs does v1 admit, and is the rung part of the signed schema definition (so a reader
   knows what kind of lens it is trusting)?
4. **What is a resolver at rest?** It is code shipped as deltas — source, artifact, or
   content-addressed reference; what the signature attests. This is EXACTLY the renderer
   question (§22); answer it once, here, and let renderers inherit the doctrine.
5. Interaction with `writable` (§14): does a resolved field stay writable with an honest
   "round-trip not guaranteed" posture (recommended — writes hit the bucket, which is still
   real), or do rungs (c)/(d) default read-only like derived fields?
6. The caching/invalidation contract per rung — what does the gateway promise, and where does
   memoization live?
7. Is the resolver part of the lens identity — does changing a resolver constitute a new schema
   version under §17's append-only law?

---

## Reserved §22 — Renderers: push deltas, get software

_Handed over by Myk 2026-07-11; reframed 2026-07-12. **NOT YET SCOPED — opens at the design
stage.** Draft the SPEC section, then STOP for Myk before implementation code. Depends on §21
(resolvers) settling the executable-delta doctrine. See memory `renderer-task`._

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
- **What a renderer delta IS** — inherited from §21's resolver doctrine (source vs artifact vs
  content-addressed ref; what the signature attests). One answer for both kinds of shipped code.
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

Closest existing machinery: SPEC §17 — renderers are the read side of the same story. Use a
specialized review panel (substrate-semantics · capability-security · correctness-API), not one
generalist.

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

