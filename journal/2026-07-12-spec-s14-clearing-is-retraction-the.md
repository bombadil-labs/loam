## 2026-07-12 — SPEC §14 — clearing is retraction, the dual of resolution (PR #73)

Reading computes a field per-Policy over a bucket of gathered deltas; writing is the dual, and until
now the surface didn't know it — you could set a value but never REMOVE one ("set to null" was never
wired, and the naive fix, negate the winning delta, doesn't hold against union). This lands the
load-bearing half: **clear is retraction.** `Gateway.clearEntity` gathers a field's bucket, negates
the caller's OWN surviving contributions (`makeNegationClaims` + `signClaims`, appended through the
same standing-checked path as any write), and re-resolves. ONE mechanism, correct across every Policy
because the read side already does the Policy work — a `pick` falls to the next survivor, an `all`
list loses your tag, a `merge` withdraws your addend, and a field only you spoke for goes absent,
rendered per its `absentAs` so the null-ness lives in the lens, never on a reference. No per-Policy
branch: writing is the dual of resolution, so resolution IS the write semantics.

The blocker was the "clear-others" question; Myk resolved it **retract-your-own only**: shaping a
view against others' claims is the schema Policy's job (filter at read time, per lens), NOT a
negation's — negation is a systemic act, and bending it to shape one view is the "over-broad schema →
cleared in confusion → negated for the whole world" footgun. That decision sharpened the section: it
names where the boundary lives instead of hedging. Both doors: GraphQL `clear<Type>(entity, fields)`,
and the REST door's honest verb `DELETE /rest/vN/<Schema>/<entity>`. TODO §14 migrated to SPEC §14;
the unbuilt per-Policy verb polish stays in TODO as a now-unblocked amendment. Village phase20 (3/3
twice) exercises it end to end. 465 tests green.

Learnings: (1) A one-agent correctness review earned its keep — it caught a HIGH bug a green test
masked: my `replace_all` edit to the DELETE body-read matched only the public door's indentation, so
the AUTHENTICATED REST door silently dropped the DELETE body and every field-scoped clear became
clear-all. The REST test didn't see it because the writer had only ever written one field, so
"clear height" and "clear all" were indistinguishable. Fix + a two-field test that can tell them
apart. The lesson: a test whose fixture can't distinguish the correct behavior from the bug is not a
test of that behavior. (2) The retract-your-own invariant rests on ONE check — `claims.author ===
author` in the gather filter (`append`'s authorize only proves the negation's author holds write
standing, not that the target is theirs); it now carries a load-bearing comment so no refactor
loosens it. (3) Validate an unknown field at the DOOR (against the version it addressed — latest for
GraphQL, pinned for REST), not deep in `clearEntity` against the latest schema — otherwise clearing
an older REST version whose lens named a since-dropped field throws instead of retracting real ground.

### §14 amendment, same PR — remove-one + writability (Myk: "one more commit")

The amendment was unblocked and the mechanism already sat there, so it rode PR #73 too. `clearEntity`
and a new `removeEntity` now share one private `retract(name, entity, seed, keep)` core — clear passes
`keep = field ∈ fields`, remove passes `keep = field === f && the delta carries a "value" pointer in
the wanted set`. Value-scoped retraction is thus the same retract-your-own with a predicate: withdraw
the ONE tag you added or a specific `merge` addend, the rest of the field standing, and removing a
value you did not author is a no-op. `remove<Type>(entity, field, values)` on GraphQL; an object
`DELETE` body `{ field: [values] }` on REST, beside the array form that clears whole fields.

Writability is an optional `writable` string[] on the registration — additive on the wire (a new
`writable` primitive pointer, no migration: old registrations lack it and stay permissive), threaded
exactly like `mutations` (Registration → RegistrationInput → registrationClaims → survivingCandidates
→ Registered, plus register()/publishRegistration()). Enforcement is CENTRAL — one `assertWritable`
guard in the gateway's `mutateEntity`/`clearEntity`/`removeEntity`, so both doors inherit it through
the hooks; GraphQL additionally trims read-only props out of the per-prop mutation args, and the
OpenAPI write-body drops them, so the surfaces tell the truth about what they write. 473 tests green;
village phase20 grew to 5/5.

Design calls worth recording: (1) we deliberately did NOT build "merge refuses `set`" — a per-prop
assert on a `merge` field is honest contribution (an addend), and refusing it would remove working
behavior to force a rename; the useful half of that bullet is `remove` (withdraw a specific addend).
(2) Writability shipped as opt-in RESTRICTION, not §14's original immutable-by-default: flipping the
default would make every existing registration read-only overnight — a breaking change needing a
migration and Myk's call, so it stays in TODO. (3) Central enforcement over per-door: putting
`assertWritable` in the three gateway write methods means a new door can never forget it, and the
door-level trims (GraphQL args, OpenAPI body) are honesty on top, not the gate.
