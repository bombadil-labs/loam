# Journal

_Append-only record: one entry per completed step (or notable event) — what was done, why it went that way, and any novel learning. Newest last._

## 2026-07-09 — Open decisions resolved; sprint begins

Myk resolved both standing questions at the start of a three-day build sprint:

- **Multi-tenancy (§7): full.** v1 treats tenant isolation as a first-class construct — genesis
  schemas and gateway enforcement carry it from the start, not as a later graft.
- **Chorus (§10): reference-only.** Read its plumbing as a design guide; write Loam's code clean,
  against Loam's tests. SPEC §10 is now a reference inventory, not an extraction inventory.
- **Cadence:** run the loop autonomously until the plan's steps are secured, then regroup.

Also verified at sprint start: `@bombadil/rhizomatic@0.1.0` is live on npm (published 2026-07-06),
and its export surface matches SPEC §2 name-for-name — the spike (step 1) will confirm semantics.

## 2026-07-09 — Step 0: Scaffold (PR #1)

The ground is prepared: a TS/ESM project standing on the real `@bombadil/rhizomatic@0.1.0` from
npm, with a five-stage gate (`prettier` → type-aware `eslint` → `tsc --noEmit` → `tsc -p
tsconfig.build.json` → `vitest`) held by CI on ubuntu and windows. The smoke test signs three
deltas with a fixed seed and walks them through content addressing, `DeltaSet` dedup, and
overlapping union merges in both orders.

Learnings worth keeping:

- **vitest 4, not 2.** rhizomatic pins vitest ^2; that chain (vite/esbuild) carries five audit
  findings including a critical. v4 audits clean and nothing in our usage differs. Don't inherit
  a toolchain pin out of sympathy.
- **The adversarial review earned its keep on a "trivial" step.** Eight finder angles on a
  scaffold produced ten real fixes — the sharpest: `build` (declaration emit) was exercised by
  nothing, so TS2742-class breakage would have merged green until step 8; and non-type-aware
  eslint would have let a floating promise into step 2's async store seam. Review the boring PRs.
- **Tell the truth in `engines`.** The tooling's real floor is node 22.13 (eslint-visitor-keys);
  `>=22` was a comfortable lie. Note: the local dev machine runs node 22.0.0 — it works, but
  npm warns; an upgrade would quiet it.
- **A merge test with an empty set proves nothing.** Order-blindness is only falsifiable with
  two overlapping non-empty sets compared in both orders.

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
  over-match is allowed, so gateway materializations should stay root-anchored); forgeries are
  rejected without trace; arrival order cannot change the materialized truth even within one
  bucket; **negation flows through the live read** (the negated value vanishes from the resolved
  view and subscribers are told).
- **The function substrate is complete.** Install → fire → emit works; emissions are signed by
  the derived author, ride the raw stream, and carry `rhizomatic.derived.by/from/under`
  provenance naming the exact function and binding; `supersede` keeps exactly the **latest
  emission set** live (one live claim per pointer-list the function returns — a multi-output
  function leaves several); `verifyPureDerivation` reproduces the emission from the recorded
  input hex and rejects a tampered function; a budget-exhausted binding suspends observably and
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

## 2026-07-09 — Step 2: Persistence tier (PR #3)

The async `StoreBackend` seam — `append` (idempotent by id), `deltasSince` (order-free watermark
read), `close` — with two witnesses behind one parameterized contract suite: `MemoryBackend`
(a `DeltaSet` keeping its promises immediately) and `SqliteBackend` (better-sqlite3: `UNIQUE(id)`
as the CRDT dedup, WAL + busy-timeout, one `IMMEDIATE` transaction per batch, durable-after-
commit). Delta-level only — chorus's `refresh`/`persist` agent ergonomics were its shape, not
Loam's. 45/45 green.

Learnings worth keeping:

- **The async facade must be `async`.** Promise-returning methods wrapping sync internals leak
  synchronous throws (SQLITE_BUSY, closed handles) past every `.catch` unless the method itself
  is `async` — the keyword is load-bearing. The type-aware `require-await` lint fights this
  pattern; a file-scoped disable naming the reason is the honest resolution.
- **Stores canonicalize on the way in and fsck on the way out.** A forged id is refused as a
  rejection (both drivers, one `canonicalDelta` gate); a stored row that no longer recomputes to
  its id is corruption and reads reject — never laundered into a differently-addressed delta.
  JSON cannot say `-0`, so the canonical form (which the id already agrees with — canonical CBOR
  collapses `-0`) is what every driver returns: driver substitution stays byte-identical.
- **Durable driver is better-sqlite3, not `node:sqlite`**: the local dev machine's node 22.0.0
  predates `node:sqlite` (22.5+). The seam keeps libSQL/node:sqlite additive for step 8. (An
  upgrade to node ≥22.13 would also quiet the engines warnings.)
- The review's single-agent format (per the new budget rule) caught seven real findings,
  including two the multi-agent panels' style of sweep might have — the leaner loop holds.

## 2026-07-09 — Step 3: Read gateway (PR #4)

The first genuinely novel code: a `Gateway` fronting one `StoreBackend` (boot-replay,
raw-stream write-through, `loadSchema` meta-resolved via `SCHEMA_SCHEMA`, per-root live
materializations) serving GraphQL **derived from (HyperSchema, Policy)** — the policy's props
name the fields, each `PropPolicy` kind names its GraphQL shape, and every view carries
`_entity` / `_hex` (the content-addressed snapshot) / `_view` (the whole resolved view). Reads
go through `resolveView` over the live materialization, falling back to batch eval for
unwatched roots. 61/61 green.

Learnings worth keeping:

- **Chorus reflected; Loam derives.** Chorus's `gql.ts` had to reflect its schema out of the
  data because its vocabulary was open. Loam's policy IS the field contract — reflection is
  unnecessary, and the GraphQL surface is a pure function of what's registered, not of what
  happens to be stored. (`_view` covers the dynamic remainder.)
- **Failure design is most of the gateway.** The single review agent confirmed the happy path
  and found seven failure-path defects: a permanently-rejected write queue that silently
  dropped later writes and wedged `close()`; `register()` latching a refused schema and
  poisoning every later call; `loadSchema` persisting deltas before proving they define a
  schema (append-only stores forgive nothing); `absentAs` typed by its inner policy when its
  constant is a bare primitive (graphql-js throws "Expected Iterable" exactly when the default
  should speak); silent GraphQL name shadowing. The pattern for all five fixes: **validate
  everything that can refuse before any state changes, latch the first persistence failure,
  refuse new work while degraded, and always release resources on close.**
- **Collision checks must live outside lazy thunks** — a check inside a GraphQL `fields`
  thunk fires at first use, not at build; `register()` must refuse at registration time.

## 2026-07-09 — Step 4: Mutations + subscriptions (PR #5)

The gateway learned to write and to watch. `mutate`: one field per schema, one argument per
policy prop; each provided argument becomes a signed property-claim delta through the same
validated write-through path, and the response is the re-resolved view. A seedless gateway
refuses to write. `subscribe`: an initial snapshot, then one patch per relevant change
(`_fromHex → _hex`, `_changed`, fields re-resolved), on a lazily-created cached materialization
per (schema, entity). 76/76 green.

Learnings worth keeping:

- **A suspended async generator cannot be left.** `return()` on a generator parked on a pending
  promise waits for that promise — a subscription built on one hangs whoever tries to leave.
  The `Channel` implements the AsyncGenerator protocol directly, so `return()` always lands.
  The same rule forced the graphql-subscribe wrapper to be a pass-through object, not a
  generator.
- **Backpressure is coalescence, not growth.** A slow reader holds at most one pending patch;
  the merge keeps the hex chain honest (`pending.fromHex → incoming.hex`) and unions the
  changed-sets. Three writes against a parked reader arrive as one truthful patch.
- **Sinks fire inside the writer's ingest.** A subscriber whose re-resolution throws must fail
  its own stream and detach — never abort the fan-out or make the mutation look failed when the
  delta already landed.
- **The review caught three quiet lies**: a patch whose view didn't move (HView changed, View
  identical — now silence); `close()` stranding parked readers (now every channel ends first);
  and `${name}@${entity}` lazy-mat names colliding with legitimate schema names (lazy names now
  live in a NUL alphabet schemas are refused entry to; `__proto__` props are refused for the
  plain-object-setter trap).
