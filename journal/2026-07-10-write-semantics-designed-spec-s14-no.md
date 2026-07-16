## 2026-07-10 — Write semantics designed (SPEC §14); no code

A long design conversation with Myk, starting from "what does it mean to set a field to null?"
and ending in a new normative section. No implementation — the spec now carries the idea; a
sprint can pick it up.

The chain of the argument, worth preserving because it is the paradigm reasoning about itself:

- **Today "set to null" is a no-op** (the mutation resolver drops null; `Primitive` excludes
  it) — and Myk's instinct that it "negates the blue delta" is the naive fix that does not
  hold against union: a field is many deltas across many stores; you can negate only the ones
  you can see, and a pull repopulates it.
- **The deeper truth: rhizomatic cannot "clear" a field in general**, because a field's value
  is not stored — it is a per-field policy function over a bucket, and arbitrary functions have
  no inverse. Clearing is definable only where the policy is a SELECTION with a defined empty;
  `merge`/aggregate and derived fields have no slot to clear. That is not a gap — it is the
  reader (the policy) deciding everything, including whether "empty" is reachable.
- **The actual bug is an asymmetry:** the read surface is policy-rich, the write surface is
  policy-blind (it assumes every field is a `pick` slot). The fix is not a null value — it is
  making WRITES the dual of resolution.
- **The resolution: clearing is retraction → absence, and absence already exists.** `resolveView`
  omits an absent key; the surface reads a missing key as null; `absentAs` is the reader's knob
  for what absence renders as. So removal needs no `null`/`None` value anywhere a reference can
  carry it — Hoare's billion-dollar mistake sidestepped by construction. And it needs **no
  rhizomatic change**: negation + the mask stage + omission already compose.

§14 records this in the maximally general form Myk asked for: two universal primitives (assert /
retract), each policy kind INDUCING its own write discipline (or declining one — `merge`
contributes addends but rejects "set the aggregate"; derived is read-only; default is
immutable), writability declared Loam-side (surface discipline, not a field lock, not a
resolution change — so portability is untouched), plus worked examples and the honest limits
(clear is per-reader; you clear what you said not what the world said; absence ≠ affirmed-empty;
aggregates/derived are structurally non-clearable and that is correct). The one thing genuinely
out of scope and deferred to a rhizomatic conversation: a first-class null VALUE distinct from
absence (a `Primitive` change touching every merge fn).

Two learnings from the substrate tour that section rests on, both previously under-documented:
`merge`'s `fn` is a CLOSED string vocabulary (max/min/sum/count/and/or/concatSorted), not a
Loam extension point — because policies are DATA (content-addressed, federated), resolution must
be a universal function or the "same View everywhere" invariant dies; Loam grows behavior by
DERIVATION (the Runner emits deltas) and expressiveness by COMPOSITION (chain orders, absentAs,
trust masks), never by teaching the resolver new tricks. And HViews are genuinely ARBORESCENT
(`HVEntry { delta, negated, expanded?: Map<pointerIndex, HView> }`), the `expand` term driving
recursion, the village's `Circle` (friends through Person) the live proof — so clearing a
relational field is retracting the EDGE, and you never write into a nested entity's own
resolved value.
