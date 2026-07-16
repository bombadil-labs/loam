## 2026-07-09 — Step 1: The rhizomatic spike (PR #2)

Thirty tests (27 spike + 3 smoke) against the real `@bombadil/rhizomatic@0.1.0`, spanning four
of SPEC §2's claim clusters. **The substrate is what the SPEC says it is.** Confirmed:

- **Schemas are data.** `publishSchemaClaims → loadSchema` round-trips; evolution is append
  (newest definition wins, body and all); deprecation is negation (`loadSchema` throws "no
  surviving schema definition"); `SCHEMA_SCHEMA` round-trips through its own machinery — the
  metacircular seed holds. Schema refs recurse: `expand` nests a child `HView` per ref'd schema,
  `collectRefs` returns typed refs (`{kind: "name", name}`), and `resolveView` recurses through
  expansions — with the child view honestly showing the back-edge that led there.
- **Resolution is policy pluralism.** One gathered `HView`, many truths: `pick byAuthorRank`
  yields 30 or 34 depending on whom you trust; `all` unions; `merge` reduces; `absentAs` fills
  silence with a constant; `byPred` ranks matching claims first; same policy + same deltas in
  any order → the same `viewCanonicalHex`.
- **The reactor is honest.** Materializations stay current per ingest and agree with batch
  evaluation (the incremental-equivalence contract); `subscribe` pushes `MaterializationChange`
  whose `newHex` matches independently computed ground truth; registration after ingest
  backfills; multiple subscribers all hear; **for root-anchored terms** irrelevant deltas cause
  no event and no re-evaluation (`evalCountOf` flat — note: non-anchored terms dispatch broadly,
  over-match is allowed, so gateway materializations should stay root-anchored); deltas whose
  content address does not match are rejected without trace; arrival order cannot change the
  materialized truth even within one
  bucket; **negation flows through the live read** (the negated value vanishes from the resolved
  view and subscribers are told).
- **The function substrate is complete.** Install → fire → emit works; emissions are signed by
  the derived author, ride the raw stream, and carry `rhizomatic.derived.by/from/under`
  provenance naming the exact function and binding; `supersede` keeps exactly the **latest
  emission set** live (one live claim per pointer-list the function returns — a multi-output
  function leaves several); `verifyPureDerivation` reproduces the emission from the recorded
  input hex and rejects an altered function; a budget-exhausted binding suspends observably and
  attributably (a signed suspension claim naming the binding) and stops emitting.

Differences from SPEC §2 — refinements, no contradictions (SPEC corrected):

- `MaterializationChange` also carries `materialization` (the name), not just root/props/ids/hex.
- `subscribeRaw` exists alongside `subscribe` — the every-accepted-delta stream, firing exactly
  once per accepted delta (not for duplicates or rejects) and including derivation emissions:
  the natural write-through hook for step 2's persistence tier.
- `ingest` accepts **unsigned** deltas (content-address verified; bad signatures rejected). Loam's
  gateway must therefore enforce its own signature requirements — the substrate won't.
- `conflicts` surfaces a property only when ≥ 2 distinct values contend; an agreed single value
  resolves to absent. Every `Order` chain ends in an implicit `lexById` tiebreak — resolution is
  total and deterministic.
- Exported type names confirmed: `HView`, `DerivedFn` (CLAUDE.md vocabulary note aligned).

Novel learning: **terms and policies are built via the JSON profile** (`parseTerm` /
`parsePolicy` / `parsePred`), so the gateway (step 3) can accept them straight off the wire —
the serialization layer Loam needs already exists and is conformance-vectored. Grammar caution:
the nesting key is `in` for `select`/`mask`/`group`/`expand`/`resolve`/`prune`, but `fix` takes
`schema`/`entity`(/`bindings`) and `union` takes `left`/`right` — `in` is not universal.
