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

## Reserved §14 — Write semantics: mutation is the dual of resolution

_Designed 2026-07-10 (originally SPEC §14). **BLOCKED on an open question** (the clear-others
question below) — resolve with Myk before implementation. When it lands, this migrates back to
SPEC §14 with a Provenance footer._

_Vocabulary (0.3.0): a **Policy** is a single property's rule — `pick` / `all` / `merge` /
`conflicts` / `absentAs`; the whole `{ props, default }` resolution program a field belongs to is a
**Schema**. This section is precisely about each field's write discipline following its Policy, so it
reads natively under the new names — "Policy" below always means the per-property rule._

Reading is `resolve : Schema → HView → View` (§4): a field's value is not stored, it is
COMPUTED per-property by its Policy over a bucket of gathered deltas. Writing is the **dual**,
and today does not know it — the mutation surface (§5) appends a `(subject/context, value)`
delta uniformly, as if every field were a settable single slot, which is true only of `pick`.
The read side knows a field may be a selection, an aggregate, a conflict set, an `expand`ed
subtree, or (later) a derivation; the write side pretends otherwise. The symptom is `null`:
there is no way through the surface to REMOVE a value, because "set to null" was never wired —
and the naive fix (negate the winning delta) does not hold against union (a field is many
deltas across many stores; you can negate only the ones you can see). This section makes
writing as policy-aware as reading.

**Two primitives; everything else is sugar.** Every mutation is one of:

- **assert** — append a contributing delta (a signed fact, with standing, §7).
- **retract** — negate YOUR OWN contributing deltas (rhizomatic negation, §2; honored at the
  mask stage of the gather, §4).

`set`, `add`, `remove`, `clear`, `unset` are these two, parameterized by the field's Policy.
There is no universal "set" and no universal "clear"; each Policy kind **induces** its own
write discipline, or declines one.

**Clearing is retraction, and it resolves to absence — never to a null value.** A View already
represents "no value" natively: a Policy with nothing to say returns an internal ABSENT
sentinel, and `resolveView` OMITS that key from the View (a missing key reads as `null` at the
surface). So removal needs no new value in the algebra — retract your contributing deltas, the
bucket empties, the Policy goes absent, the key vanishes; the reader's `absentAs` decides what
that absence RENDERS as. Removal arrives without null-the-hole ever riding on a reference: the
null-ness lives in the lens, explicit and per-field. Hoare's mistake sidestepped by
construction, not by discipline.

**Each Policy kind induces its write semantics:**

- **`pick`** — _assert_ to set (the new fact wins by the field's order); _retract-your-own_ to
  clear (the next surviving delta steps up; if none, absence).
- **`all` / `conflicts`** — _assert_ to add; _retract_ a specific delta to remove one;
  _retract-all-yours_ to clear your contribution.
- **`merge`** — _assert_ an **addend** and _retract_ an addend; there is **no** "set the
  aggregate." You cannot invert `sum` to a chosen total; the surface refuses "set" as a
  category error and offers only contribution.
- **`absentAs`** — writes pass through to the inner `then`; the `constant` is a read-time
  fallback, never a written value.
- **expanded / relational** (an `expand`ed edge, §4) — _assert_ the **edge** to link; _retract_
  the edge to sever (the nested subtree drops from the view). You never write INTO the nested
  entity's resolved value — that is its own Schema over its own ground.
- **derived** (future resolve-time computed fields) — **read-only**: no backing assertion
  exists to write or retract.
- **default** — **immutable** unless a field opts into a write discipline. The store learns;
  silence about writability means "you may not," not "you may set anything."

Writability is declared in the registration (Loam-level metadata, beside the claim templates of
§5), **not** in the rhizomatic `Schema`. It disciplines the mutation SURFACE, never the ground:
the resolution algebra is untouched, so content-addressing and portability are unaffected, and
two instances may declare different writability for one schema without ever diverging on a
resolved View. (The same reason merge fns are a closed vocabulary — resolution must be a
universal function of the data — is why write DISCIPLINE, which is not resolution, may be
local.)

**In practice.**

- _`favorite_color` (`pick`)_ — `set(blue)` asserts; `clear()` retracts your blue → absence →
  renders `null` (or whatever `absentAs` says).
- _`tags` (`all`)_ — `add(t)` asserts; `remove(t)` retracts that assertion; `clear()` retracts
  all of yours.
- _`score` (`merge sum`)_ — `contribute(+5)` asserts an addend; `withdraw(+5)` retracts it;
  there is no `setScore` — the total is whatever the addends sum to.
- _`hometown` (`expand`ed edge)_ — `move(city)` asserts a new edge (retract the old if
  single-valued); `clear()` retracts the edge, and the nested `City { … }` drops from the view.
- _`full_name` (derived)_ — read-only; a mutation is refused with a reason.

**Real limitations, stated plainly (the §13 register):**

- **Clear is per-reader.** A retraction binds only for readers whose lens honors your negation
  (trust masks, §7). "Cleared" is your TESTIMONY that you withdraw the fact, not a global
  guarantee the field is empty for everyone. Truth is a lens; so is emptiness.
- **You clear what you said, not what the world said.** You retract your OWN contributions;
  you cannot negate assertions you cannot see or did not author, and a fresh (or freshly
  federated) assertion repopulates the field — correctly. "Clear my favorite_color" means
  "withdraw my claim," never "no one may state it."

  > **OPEN — resolve before this work begins (Myk, 2026-07-11).** The bullet above is likely
  > too strong. It holds when the lens admits only your own contributions — but when a field's
  > Policy draws on OTHERS' claims (an `all` list, a `merge`, a `conflicts` set, a `pick` whose
  > order can seat another author), retracting only your own deltas leaves the field populated
  > by theirs, so "clear" has not cleared. A binding clear would have to negate those foreign
  > contributions too — which the substrate already permits: an authored negation may reference
  > a delta you did not sign, and whether it BINDS is the reader's lawful-negation/trust
  > decision (§7), the very machinery erasure (§11) runs on. The rule conflates two things —
  > whose fact it is, and whose negation binds under a given lens. Questions to settle first:
  > does "clear" mean personal withdrawal (retract-your-own) or lens-scoped suppression of every
  > admitted contributor; WHO may negate another's delta (operator-only, or a granted moderator,
  > §7); and how far that suppression reaches under federation (a re-federated assertion
  > repopulates unless a standing, tombstone-style negation holds the line). Until resolved,
  > treat retract-your-own as the floor, not the ceiling.
- **Absence is unknown, not affirmed-empty.** Retraction yields "no one is saying," distinct
  from "affirmatively none." An app that must tell them apart uses an agreed sentinel value (a
  normal assertion) today; a first-class null VALUE — distinct from absence, and defined for
  every merge fn — is a `Primitive` change in rhizomatic (frozen: a conversation, not a Loam
  workaround), deliberately out of scope here.
- **Aggregates and derived fields are structurally non-clearable — and that is correct.** There
  is no inverse of `sum` to null, and no backing delta beneath a computation. The surface
  refuses them rather than pretending — the write side finally telling the truth the read side
  always knew.
- **Writability is front-door discipline, not a field lock.** A hand-signed or federated delta
  may still assert into a "read-only" context; the store gathers and resolves it, because the
  ground is open and entities are unowned (§7, "authors, not owners"). A reader who wants the
  guarantee enforces it with a lens — e.g. a mask admitting only the deriving author for a
  derived context. Writability disciplines the surface; lenses discipline the truth.

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

