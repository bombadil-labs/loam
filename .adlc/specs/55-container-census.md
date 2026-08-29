# §55 — The container census: physical, linked, and dark

**Working spec (P1 instrument). Settled in chat 2026-08-29: Myk asked for the metrics, the
design answers landed in the same conversation, and his blessing covers plan, implementation,
merges, and the release.** Realizes T254.

## User stories

Myk opens a container's page and reads three numbers before the member list: how many deltas
LIVE here (physical — this container's own attached store), how many are LINKED here (selected
out of the primary by this container's membership), and how many of the data deltas are DARK —
belonging to no hyperview, gatherable by no registered lens. Three numbers tell him whether
the container is a real place, a reading, or a graveyard.

Rae's diary container shows dark 0: every viewing resolves through the diary lens. A container
that collected an agent's experiments shows dark 47, and that number is the to-do it looks
like — register a reading or let the soup be named soup.

The store's own law never alarms: container declarations, grants, tombstones are their own
bucket, not darkness.

## Positions

1. **Physical vs linked falls out of the posture model.** A separate-posture container (and
   every inbox pool) holds residents in its own attached store — those count PHYSICAL. A
   shared-posture container holds nothing; its membership Term selects primary-ground deltas —
   those count LINKED. A container's census reports its own posture's bucket; a parent whose
   gather composes inbox pools reports the pool contributions as physical-elsewhere (named by
   pool), never silently merged. A primary delta selected by two sibling memberships counts in
   each — right per container; only a store-total would dedupe, and v1 draws none.
2. **Dark is decided by the surviving-lens context union.** The listing door already maintains
   it (`listingContexts` over `groupPrograms` — H6-safe: a superseded binding's contexts light
   nothing). A DATA-class member (the §49 classifier) none of whose entity-pointer contexts
   appears in any surviving program's union is DARK. This is an approximation in the safe
   direction and the surface says so: a Term can filter a delta whose context matches, so true
   darkness is undercounted — an advisory metric must never over-alarm.
3. **Law is a bucket, not darkness.** Members classing law/trust/erasure are counted apart.
   A store's constitution is not soup.
4. **The census renders on the DETAIL page** — the page that already pays the scope read. The
   dashboard tree stays byte-unchanged: annotating every node eagerly multiplies the attention
   panel's bill (§49.3's stated cost), and the swept-index follow-on is where that becomes
   affordable. Deferred, stated.

## Acceptance criteria

1. PHYSICAL VS LINKED. A separate container's residents count physical; a shared container's
   selected members count linked; each census total equals its scope read's member count —
   verified by `test/gateway/container-census.test.ts`.
2. DARK, TWO-SIDED. A data-class member no surviving lens reads counts dark; a member a
   registered lens gathers does not; law/trust/erasure members land in the vocabulary bucket,
   never dark; a SUPERSEDED binding's contexts light nothing — verified by
   `test/gateway/container-census.test.ts`.
3. THE PAGE. The container detail page renders physical, linked, dark and the vocabulary
   bucket with `data-census-*` markers, and names the dark count's safe-direction
   approximation in its own words; the dashboard tree markup is byte-unchanged — verified by
   `test/server/admin-census.test.ts`.

## Open questions

None — the design was settled in the conversation that asked for it.

**Provenance.** Drafted 2026-08-29 from Myk's chat framing and the settled answers; §49's
classifier and the listing door's context union are the load-bearing precedents.
