## 14. Write semantics — mutation is the dual of resolution

Reading is `resolve : Schema → HView → View` (§4): a field's value is not stored, it is COMPUTED
per-property by its Policy over a bucket of gathered deltas. Writing is the **dual**. There are
exactly two primitives, and everything a surface offers is one of them, parameterized by the field's
Policy:

- **assert** — append a contributing delta (a signed fact, with standing, §7).
- **retract** — negate YOUR OWN contributing deltas (rhizomatic negation, §2; honored at the mask
  stage of the gather, §4).

**Clearing is retraction, and it resolves to absence — never to a null value.** A View already
represents "no value" natively: a Policy with nothing to say returns an internal absent sentinel, and
resolution OMITS that key (a missing key reads as `null` at the surface). So removal needs no new
value in the algebra — retract your contributing deltas, the bucket empties, the Policy goes absent,
the key vanishes, and the reader's `absentAs` decides what that absence RENDERS as (a cleared
`watered` under `absentAs(false)` reads `false`, not `null`). Removal arrives without null-the-hole
ever riding on a reference: the null-ness lives in the lens, explicit and per-field. Hoare's mistake
sidestepped by construction, not by discipline.

**One mechanism, correct across every Policy — because the read side already does the Policy work.**
`clear` gathers the field's bucket, negates the caller's own surviving entries, and re-resolves; the
Policy does the rest. A `pick` falls to the next survivor; an `all` list loses your tag; a `merge`
withdraws your addend and the reduction recomputes; a `conflicts` set recontends by the same
construction; a field only you spoke for goes absent. The write side needs no per-Policy branch:
writing is the dual of resolution, so resolution IS the write semantics.

**Retract-your-own is the floor AND the ceiling** (Myk, 2026-07-12). A clear negates only deltas the
caller authored; it never touches another author's contribution. To keep OTHERS' claims out of a
view you narrow the schema **Policy** for that field — filtering is resolution's job, done at read
time, per lens. You do NOT achieve it by authoring a negation against a delta you did not sign:
negation is a systemic act (it reshapes the ground for every reader whose lens honors it), and
bending it to shape one view invites the exact footgun of an over-broad schema that pulls in a delta
relevant elsewhere, "cleared" in confusion, and thereby negated for the whole world. Whose fact it
is, and whose negation binds under a given lens, are two different questions; the write surface keeps
them apart by construction.

**The doors.** GraphQL exposes `clear<Type>(entity, fields: [String!]!)`; REST maps retraction to
its honest verb — `DELETE /rest/vN/<Schema>/<entity>` (a JSON array of field names in the body, or
an empty body to clear every prop). Both run the same hook, the same standing check, and the same
refusals as every other write — one ground, one registration, the same view through either door.
Clearing is grow-only and idempotent: it appends signed negations, and re-clearing an
already-cleared field adds nothing (its entries are already negated).

**Remove one, not just clear the field.** `clear` withdraws every one of your contributions to a
field; `remove` withdraws a specific VALUE — the one tag you added, a particular `merge` addend —
leaving the rest of the field, yours and everyone's, standing. It is the same retract-your-own
mechanism with a value predicate: negate only your own deltas in the field whose claimed value is one
named. GraphQL exposes `remove<Type>(entity, field, values)`; the REST door takes an object DELETE
body, `{ field: [values] }`, beside the array form that clears whole fields. Trying to remove a value
you did not author is a no-op — retract-your-own holds down to the single value.

**Writability is declared, and it disciplines the door.** A registration MAY carry a `writable` list
(Loam metadata, beside the claim templates of §5, additive on the wire); when present, ONLY those
fields accept a surface write — assert, clear, AND remove refuse the rest with a reason, and GraphQL
does not even offer a read-only field as a mutation argument. Silence leaves every field writable (the
permissive default). It disciplines the SURFACE, never the ground: the resolution algebra is
untouched, so content-addressing and portability are unaffected, and two instances may declare
different writability for one schema without diverging on a resolved View. (The same reason merge fns
are a closed vocabulary — resolution must be a universal function of the data — is why write
DISCIPLINE, which is not resolution, may be local.) The global immutable-by-default posture — silence
meaning "you may not" — would flip today's permissive default and stays a future breaking change.

**Real limitations, stated plainly (the §13 register):**

- **Clear is per-reader.** A retraction binds only for readers whose lens honors your negation (trust
  masks, §7). "Cleared" is your TESTIMONY that you withdraw the fact, not a global guarantee the
  field is empty for everyone. Truth is a lens; so is emptiness.
- **You clear what you said, not what the world said.** You retract your OWN contributions; a fresh
  (or freshly federated) assertion repopulates the field — correctly. "Clear my favorite_color" means
  "withdraw my claim," never "no one may state it."
- **Absence is unknown, not affirmed-empty.** Retraction yields "no one is saying," distinct from
  "affirmatively none." An app that must tell them apart uses an agreed sentinel value (a normal
  assertion) today; a first-class null VALUE — distinct from absence — is a `Primitive` change in
  rhizomatic (frozen: a conversation, not a Loam workaround), out of scope here.
- **Writability is front-door discipline, not a field lock.** A hand-signed or federated delta may
  still assert into any context; the store gathers and resolves it, because the ground is open and
  entities are unowned (§7, "authors, not owners"). A reader who wants a guarantee enforces it with a
  lens. Writability disciplines the surface; lenses discipline the truth.
- **Retraction negates whole deltas.** Clearing a field negates the caller's contributing _deltas_,
  not individual pointers. A single per-prop or `_claim` write is one delta per contribution, so this
  is invisible in practice — but a hand-authored multi-pointer delta that contributes to a cleared
  field AND carries an unrelated pointer is retracted whole. Author one delta per fact you may want to
  withdraw independently (the surface's own writes already do).

Relational **edges** as first-class `link` / `sever` have since landed as an amendment (below). Two
narrower additions remain on the backlog (ADLC tickets in `.adlc/tickets.json`): **read-only derived
fields**, re-scoped to arrive with §22's synthetic resolvers (read-only by construction, refused a
write with a reason); and the **immutable-by-default flip** — silence meaning *you may not* — which
rides §21's migration wave. What ships here is the whole read side's dual: **a way to remove — clear a
field, remove a value, or lock one shut — and it is all retraction and declaration, never a null on a
reference.**

### Amendment — edge verbs: `link` and `sever`

The write surface speaks the relation directly. **`link`** asserts an edge — the same per-property
write shape the wire already carries, its value pointer made an ENTITY target that the gather's
`expand` follows into the child's view — and **`sever`** retracts your own such edges (all of them, or
only those pointing at named targets), the exact retract-your-own reach `clear` / `remove` already
have. They are pure surface sugar over `assert` / `retract` of a shape already on the wire, so nothing
new lands and no migration rides them. The surface reads the **published hyperschema gather** — not
the resolution Schema — to learn which fields are edges: a body with no `expand` resolves no edges, so
it is offered neither verb and no entity-pointer write at all, while a primitive field still takes a
primitive. `writable` disciplines edges exactly as it disciplines value writes. This is wave A of the
§14 amendment; wave B (the immutable-by-default flip) still waits on §21's wave.

**Provenance.** [#73](https://github.com/bombadil-labs/loam/pull/73) — writing as the dual of
resolution. `Gateway.retract` (shared by `clear`/`remove`) negates the caller's own contributions via
rhizomatic negation and re-resolves to what survives, or to absence; `clear<Type>` / REST `DELETE`
(array body) clear whole fields, `remove<Type>` / REST `DELETE` (object body) withdraw specific
values, and an optional registration `writable` list disciplines which fields the surface writes at
all. Verified across `pick` / `all` / `merge` / `absentAs`, author-scoped and idempotent, both doors
in agreement. The open "clear-others" question was resolved **retract-your-own** (Myk, 2026-07-12):
shaping a view against others' claims is the schema Policy's job, not a negation's. Migrated from
TODO §14. Edge verbs `link` / `sever` landed as wave A of the amendment —
[#80](https://github.com/bombadil-labs/loam/pull/80) (pure sugar over `assert` / `retract`; `edgeRoles`
reads the published hyperschema gather; 8 honest round-trip tests, no on-wire change, no migration).
Still on the backlog: the immutable-by-default flip (rides §21's wave) and the derived-field refusal
(ships with §22's synthetic resolvers).
