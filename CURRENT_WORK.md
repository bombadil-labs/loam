# Current work — SPEC §14: write semantics (clearing is retraction)

_Branch `spec-14-write-semantics`. Migrates TODO §14 → SPEC §14. The open "clear-others" question is
**resolved** (Myk, 2026-07-12): **retract-your-own only.** To keep OTHERS' claims out of a view you
filter them in the schema **Policy**, never by authoring a negation against a delta you didn't sign —
negation is a systemic act, view-shaping is a lens act, and conflating them invites "I over-scoped my
schema, cleared it, and negated something that mattered elsewhere." So the original plan stands._

## Success criteria

The write side finally knows what the read side always knew: a field is not a settable slot, it is a
bucket resolved per-Policy. There is now a way through the surface to **remove** a value, and it is
**retraction**, not `set(null)`:

- **`clear` is a first-class surface op** — negate the caller's OWN surviving contributions in a
  field's gathered bucket. One mechanism, Policy-correct across `pick` / `all` / `conflicts` /
  `merge` / `absentAs` **by construction** (resolution does the Policy work): pick → next survivor,
  all → your tags gone, merge → your addend withdrawn, conflicts → recomputed; if you were the only
  voice → **absence**, which the reader renders per `absentAs` (null-ness lives in the lens, never on
  a reference).
- **Retract-your-own is the floor AND the ceiling** — a clear never touches another author's
  contribution; you cannot clear a field you never wrote; the surface refuses a field the schema
  doesn't resolve (a quiet no-op reads as "cleared" when it cleared nothing).
- **Grow-only + idempotent** — clear appends signed negations; re-clearing an already-cleared field
  adds nothing (already-negated entries are skipped).
- **The §13-register limitations hold, honestly** — clear is per-reader (binds only for lenses that
  honor your negation); a fresh/federated assertion repopulates ("withdraw my claim", never "no one
  may state it"); absence is unknown, not affirmed-empty.
- **Both doors, in agreement** — GraphQL `clear<Type>(entity, fields: [String!]!)` and REST
  `DELETE /rest/vN/<Schema>/<entity>` (body = field names; empty body = all props). Same hook, same
  standing, same refusals — one ground, one registration, _hex for _hex.

## Sub-tasks

1. [x] **Tests first** — `test/gateway/clear.test.ts` (11: retract-your-own across pick/all/merge;
   scoped to author; unknown-field refusal; idempotent; fresh assert repopulates; absentAs renders;
   seedless refusal; stranger no-op). REST `DELETE` parity in `test/surface/rest.test.ts` (3).
2. [x] **Write seam** — `SurfaceHooks.clear`; `Gateway.clearEntity` via `gather()` +
   `makeNegationClaims` + `signClaims`, appended through `append` (standing). Refuses unknown fields.
3. [x] **GraphQL door** — `clear<Type>(entity, fields)` mutation field (gql.ts).
4. [x] **REST door** — `DELETE /rest/vN/<Schema>/<entity>` in `handleRest` + OpenAPI `delete` op +
   http.ts body-read for DELETE + CORS. (MCP left as-is — its tool set predates this; a follow-up.)
5. [x] **Green** — `npm run check`: **464 tests** (was 451, +13), format/lint/type/build clean.
6. [x] **PR + SPEC migration** — SPEC §14 written (built core + the retract-your-own decision +
   rationale + honest limitations), Provenance #73; TODO §14 trimmed to the now-UNBLOCKED per-Policy
   verb amendment; README + village ledger updated.
7. [ ] **Review** — one careful correctness pass (auth/standing; clear never touches a foreign delta;
   pinned/latest version-skew on the REST DELETE).
8. [x] **Village** — `phase20.mjs` (3/3): shared Board, retract-your-own scoped, REST DELETE →
   absence → repopulate, pick → null. Ledger entry added.
9. [ ] **Journal**.

_Left off: open PR #73, run the review agent, then journal._
