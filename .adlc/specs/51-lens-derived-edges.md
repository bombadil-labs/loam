# §51 — Lens-derived edge mutations (working spec, T245)

The write side of a reference property is generated as the adjoint of the read program. The
hyperschema body already states, machine-readably, what a well-formed edge delta looks like — an
`expand` node with an exact role feeding a grouped prop. The generator reads that statement and
mints typed `link`/`unlink` mutations, so the introspected surface teaches the truth instead of
the string-fossil path. One declaration, both directions. Design settled by Myk's brief,
2026-08-25; the evidence is a live repro from the first cold MCP client.

## User stories

- Fable, a cold-connecting MCP client with introspection as its only documentation, opens the
  generated surface for `sync:experience` and sees `linksync_experience_experiencers(entity: ID!,
  target: ID!)` — and NO `experiencers: PrimitiveValue` argument to fossilize into. It calls the
  link mutation with two ids and reads back the experience with the person resolved as a nested
  view. No folklore, no `_claim`, no role names invented.
- Myk revokes nothing and migrates nothing: his existing schemas keep their surfaces until he
  republishes one with a `refs` block, and the string fossils already in his store keep resolving
  exactly as they do today.
- A schema author who declares a reference prop without its reciprocal still gets the link
  mutation, and the register response TELLS them the far side will not fold — loud at register
  time, soft at write time.

## Mechanism

### Detection (3.1)
Walking the hyperschema body at surface-generation time: each `expand` node
`{ "op": "expand", "role": {"exact": R}, "schema": S, ... }` whose expanded deltas feed a grouped
prop `P` (the root-side pointer carries target-context `P`) marks `P` as a REFERENCE PROP with
edge role `R` targeting schema `S`. A `prefix`/`inSet` role match marks the prop as a reference
for typing (3.5) but generates no link mutation — there is no single canonical role to author.

### Generated mutations (3.2)
For reference prop `P` with role `R` on schema `N` (query-field mangling `n`):
`link<n>_<P>(entity: ID!, target: ID!): <ViewType>!` and
`unlink<n>_<P>(entity: ID!, target: ID!): <ViewType>!`.
`link` authors one symmetric delta (3.3). `unlink` retracts the caller's OWN matching link
claim(s) — the `remove*` family's semantics: retraction is a claim, history survives. Both return
the re-resolved view.

### The authored delta (3.3)
`link<n>_<P>(entity: E, target: T)` authors one delta with two pointers:
`{ "role": R, at T, "context": C_reciprocal }` and `{ "role": R_reverse, at E, "context": P }`.
The root-side pointer's context is always `P` — that is what folds it into the prop.

### The reciprocal declaration (3.4)
One new optional envelope field:
```json
"refs": { "<P>": { "role": R, "reciprocal": { "role": R_reverse, "context": C_reciprocal } } }
```
Precedence for the reciprocal pair: (1) the explicit `refs` annotation; (2) bilateral derivation
from the target schema's own declarations — DEFERRED to a follow-up; (3) neither: the link
mutation still generates, the target-side pointer carries no context, and registration warns
`reciprocal context for <N>.<P> undeclared; link deltas will not fold on the <S> side` — where
`<S>` is the matched expand's declared `reading`, falling back to its `schema` ref (the reading
is the name a reader looks for the fold under; the program is a name sibling lenses share). A
`refs.role` declared with no matching `expand` in the body still marks the prop and generates the
mutations. Fence note: `refs` carries NAMES, not code — it rides a scoped registration exactly as
`roots`/`writable` do.

### Introspection teaches the truth (3.5)
`link`/`unlink` args are `ID!`. A reference prop LOSES its `PrimitiveValue` argument on the base
mutation — a prop is a reference or a primitive, never both; keeping the primitive argument
regenerates the fossil path. A prop in both `writable` and `refs` draws a registration warning
and `refs` wins. Typed nested view fields (`experiencers { name }`) are the DEFERRED stretch;
`ViewValue` rendering stays.

### Evolution and legacy (3.6)
Republishing with an added/changed `refs` regenerates the surface immediately (existing evolution
semantics). Existing primitive fossils keep resolving as strings under `all`/`pick` — the mixed
array in the live repro is correct behavior and must not break. No migration; repair stays manual.

## Non-goals
No write-time validation of raw deltas (the mask remains the trust boundary). No MCP tool-definition
changes. No `_claim` changes. No migration of primitive reference data. Bilateral derivation and
typed nested views land as follow-ups.

## Acceptance criteria

All against fixture stores (`mkdtempSync`/memory backends), never a live home. Myk's own
rehearsal against the live `sync:` container follows the deploy and is not a repo rail.

- (a) A registration carrying a `refs` block for a reference prop succeeds under a SCOPED register grant — no operator token; the fence treats `refs` as names. Verify: `test/gateway/edge-mutations.test.ts`.
- (b) Introspection after a `refs` registration serves `link<n>_<P>` and `unlink<n>_<P>` with `ID!` args, and the base mutation offers NO argument for the reference prop; declaring the prop in both `writable` and `refs` warns and `refs` wins. Verify: `test/gateway/edge-mutations.test.ts`.
- (c) The link mutation authors a delta whose pointer structure equals the hand-authored two-pointer `_claim` shape (delta level: roles, targets, contexts asserted on the raw delta), AND the root entity re-resolves with the target folded into the prop (object level: the view). Verify: `test/gateway/edge-mutations.test.ts`.
- (d) `unlink` retracts: the view drops the edge, the original delta AND the retraction survive in history (no purge), and a second author's link to the same pair is untouched (two-sided). Verify: `test/gateway/edge-mutations.test.ts`.
- (e) A reference prop with no reciprocal declaration: registration WARNS with the specified sentence, the link mutation still generates, the authored delta folds on the root side and carries no target-side context (both sides asserted). Verify: `test/gateway/edge-mutations.test.ts`.
- (f) `_claim` is byte-for-byte untouched as a surface, and a raw `_claim` edge still folds exactly as before (bystander). Verify: `test/gateway/edge-mutations.test.ts`.
- (g) Evolution: a schema registered WITHOUT `refs`, exercised, then republished WITH `refs` serves the new mutations immediately; a pre-existing primitive fossil on the same prop keeps resolving in the mixed array (the repro's exact state, pinned). Verify: `test/gateway/edge-mutations.test.ts`.
- (h) A `prefix`/`inSet` role expand: the prop is typed as a reference (no primitive argument), and NO link mutation is generated. Verify: `test/gateway/edge-mutations.test.ts`.

## Provenance (working)
Myk's brief in chat, 2026-08-25 evening. Ticket T245. Spec section 51 claimed per the
cross-session ledger (T244/§50 are the stock-graph session's).
