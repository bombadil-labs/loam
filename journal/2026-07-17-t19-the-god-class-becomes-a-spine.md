## 2026-07-17 — T19: the god-class becomes a spine

Seven slices, seven PRs, zero behavior change — `gateway.ts` went from 2,166 lines holding every
concern the gateway has to a spine of ~950: the constructor, the static factories (`open`/`boot` —
the class's irreducible job is being born), `attachPersistence` and `reseat` (the write-through and
the re-birth), the gql-hooks wiring loom, the public-door caches, and a thin delegate for every
public method whose body now lives beside its vocabulary:

- **erasure · quarantine · promotion** → `erase.ts` / `quarantine-pool.ts` / `adopt.ts` (slice 1,
  #122 — carrying T16's corrected fan-out, as the edge demanded)
- **renderers & serving** → `renderers.ts` (slice 2, #124)
- **the §14 write verbs** → `mutate.ts` (slice 3, #125 — `retract`'s load-bearing
  retract-your-own comment moved verbatim)
- **reads & subscriptions** → `reads.ts` (slice 4, #126 — gather → resolve → apply → annotate as
  one legible pipeline)
- **the public declaration** → `public.ts` (slice 5, #127 — and the cache-backed readers stayed,
  with the reason written where the caches live: a veneer moved away from its cache lifecycle is
  indirection, not separation)
- **the ingest doors** → `ingest.ts` (slice 6, #128 — the two-door doctrine and the
  distinct-operator-seeds invariant promoted from a buried section comment to a module header)
- **lifecycle & binding** → `lifecycle.ts` (slice 7 — the most entangled, moved last against six
  known seams, exactly as the ticket ordered)

What held it safe, all seven times: the one-way surface rail (`frozen ⊆ prototype`, written before
slice 1, green through every slice); `npm run check` with the count read aloud (631 — the suite
grew only by the rail itself); and the village certified fresh per slice — byte-identical sweeps
for slices 1–2 against the pre-T20 baseline, the full 28/28 in numeric order from slice 3 on, once
the witness itself had been repaired.

The seam turned out to be the real product. Every member a module reaches is marked
`@internal — T19 seam (<module>)`, so the coupling that used to hide inside a shared `this` is now
greppable and named: `writeRoute` reaching `mutateEntity` (the renderer door genuinely mediates a
§14 write), the reads leaning on the materialization-naming trio, both ingest doors sharing the
`justPersisted` handshake. A future DI pass — named in the ticket as separate, possibly never —
would start from this map instead of an archaeology dig.

Found en route and ticketed, not fixed: T20, the village's fresh-run drift — the pure-move
discipline's demand for a clean-seed witness is what surfaced it, and repairing it (28/28) gave the
later slices a better regression net than the earlier ones had. The housekeeping the ticket
schedules for after landing — narrowing T2/T15/T18's `scope` arrays from `src/gateway/**` to the
concern modules they actually touch — is left for the restock that follows the merges, where
`merge-forecast` can re-certify the width honestly.
