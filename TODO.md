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

## Reserved §21 — Shippable renderers: schemas AND their consumers, verified end-to-end

_Handed over by Myk 2026-07-11. **NOT YET SCOPED — this opens at the design stage.** Draft the
SPEC section answering the questions below, then STOP for Myk before writing implementation
code. See memory `renderer-task`._

Loam already persists GraphQL schemas as deltas. Add a way to **define and push _renderers_** —
consumers of those schemas — as deltas too, so a "Loam app developer" ships ONE bundle of deltas
holding **both the schema and its renderers**, and Loam **verifies at push time that the whole
thing works end-to-end** rather than hoping at runtime. A renderer might be a React component (or
a set), a text format, whatever. The bundle just needs to be **mounted**; Loam could ship a
**stock React host** against which React renderers are **guaranteed to work** ("raw Loam + a
React app").

The design questions to answer BEFORE any code (this is the real work):

- **What _is_ a renderer delta?** Source, compiled artifact, or a content-addressed reference?
  What is signed, and what does the signature attest to?
- **What does "works end-to-end" mean, and how is it _proven at push time_** rather than
  asserted? A renderer declares the schema(s)/fields it consumes; push-time verification checks
  those against the registered schema surface (the SurfaceGenerator seam, §17, is the natural
  anchor) and REFUSES a mismatch at the door. Pin down exactly which compatibility relation.
- **Versioning (§17 law).** Renderers are born versioned, append-only; a renderer pinned to
  schema version vN keeps working forever, and evolving the schema can't silently break a
  shipped renderer. Work out how a renderer names the schema version it targets and what happens
  when that version is struck.
- **Trust/security for shipping _executable_ consumers** — the sharpest edge. A renderer delta
  can carry code that runs in a host: who may push one, whose renderers a host will mount,
  sandboxing, the capability story. Federation makes it acute — a foreign renderer over the wire
  must be inert-by-default like foreign law (§8/§12) unless the operator blesses it.
- **The stock React host** — the contract a React renderer implements so the shipped host mounts
  any conformant one; the "raw Loam + React app" deliverable.

Closest existing machinery: SPEC §17 (surfaces are materializations) — renderers are the read
side of the same story. Use a specialized review panel (substrate-semantics · capability-security
· correctness-API), not one generalist.

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

