## 9. Constraints & invariants

- **Append-only, everything** — including materializations: a snapshot is never mutated; recompute
  yields a new snapshot (new id, new timestamp). Nothing is edited; the store only learns.
- **Content-addressed identity** — the same delta/snapshot is the same everywhere; merge is union;
  two resolutions over the same deltas converge to the same hash.
- **Object-capability always** — no ambient authority in the gateway, functions, or federation.
- **rhizomatic is frozen** — the one live candidate for a substrate change is a resolution reduction
  `Policy`/`Order`/`MergeFn` cannot express (unlikely; confirm in the spike). Any real need is a
  PR + conversation with Myk, never an edit from here.
- **Vocabulary reconciles to rhizomatic** — `HyperSchema`, `HView`, `View`, `Schema`, `Policy`,
  `DerivedFn`, `BindingSpec`. Metaphor lives in the product name (Loam), never in the load-bearing nouns.
- **If Loam ever ingests a legacy EAV store** (e.g. Chorus's current one): the honest path is an
  opt-in streaming transform that **appends** typed deltas, signs as the migrator, cites the source
  deltas (provenance), and never re-signs as the original authors.

**Provenance.** Foundational — no single landing PR; these are the invariants every step (0–14) is tested against, not a feature any one of them introduced. Append-only, content-addressed identity is enforced in `src/store/canon.ts` and every `StoreBackend` driver (`src/store/*.ts`); object-capability discipline lives in the gateway's `authorize` seam (`src/gateway/`). The rhizomatic-frozen and vocabulary-reconciliation rules are process, not code — held by CLAUDE.md and this SPEC. Full narrative in the [Journal](JOURNAL.md).
