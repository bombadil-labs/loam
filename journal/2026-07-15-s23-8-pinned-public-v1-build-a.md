## 2026-07-15 — §23.8 pinned-public, v1 build: a declaration is publication, not a probe

The second of the four §23 build slices (stacked on T9). §17 deliberately narrowed the anonymous door to
a lens's LATEST version, because an anonymous `@hash` probe was a registration-existence oracle. But a
renderer PINS a version (§23.6), and village-as-a-URL wants a stranger reading that pinned route. §23.8's
reconciliation is a distinction §17 half-stated: a probe is DISCOVERY, a declaration is PUBLICATION. When
the operator names `Name@vN` in `loam.public`, they chose to reveal exactly that version — so the anonymous
door may serve it, and every other `@hash` stays 404.

The build kept the blast radius small by NOT changing `readPublicSchemas`'s return type: it still yields a
flat `Set<string>`, and a pin is simply the string `Name@<deltaId>` (a `@` distinguishes it from a bare
name). Two predicates — `Gateway.isPublicLatest` / `isPublicPin` — read it, and `surface("public")`'s
bare-name filter is untouched, so GraphQL/REST latest exposure stays exactly bare-name-gated. The new
operator-only `Gateway.declarePublic` freezes each `Name@vN` to the version's content address at declare
time (the same filter-then-index-then-take-deltaId `publishRenderer` uses), so the pin never slides when an
earlier version is withdrawn. `serveRoute`'s pinned branch now serves the anonymous door IFF that pin is
declared; the full door serves any surviving registered version.

Two decisions worth recording. (1) `hasPublicSurface` had to learn about pins — a pin-only store (no
bare-name lens) still has an open anonymous door for its pinned route, and the gate that guards the whole
anonymous door keyed only on the bare-latest GraphQL surface. Loosening it to "any declaration, bare or
pinned" is correct: the operator published the pin, so revealing that something is public here is the
intent, not a leak. (2) The REST symmetry exposed a latent bug in the version-resolution's `isLatest`
flag. It meant "last in the door's family list," but once the public family can be truncated to a single
DECLARED PIN, that pin wrongly looked like "the latest" and took the warm `hooks.resolve` path — which
needs a live surface a pin-only store doesn't have (404). The fix corrected `isLatest` to its true meaning:
the version is the store's CURRENT latest AND the door's live surface actually serves that lens; a declared
pin otherwise answers through `resolvePinned`, which needs no live surface. That is a strictly more correct
definition on every door, not just the new path.

Learning: an additive "the operator may reveal more" feature still has to be audited as a door-widening —
the questions are the same §12/§17 ones (does an undeclared thing stay 404? does the withdrawn-vs-never
distinction stay full-door-only?), and the answers held (every undeclared `@hash` is a uniform 404; the 410
is still full-door-only). And a truncated version family is a sharp edge: any code that inferred "latest"
from list position was resting on the family being complete, which the public door no longer guarantees.

Known composition follow-up (documented in spec/23 §23.8): a pin-only public store does not yet serve its
pinned view's BYTES through the §23.7 byte-door, because `serveBytes` uses the bare public surface — which
is more-restrictive, not a leak; a future refinement teaches the byte-door the pinned-public set.

`npm run check` green — 591 tests (test/gateway/pinned-public.test.ts 10: rails a–e — declare-then-serve,
undeclared-pin-404, bare-serves-latest-only, withdraw-darkens, full-door-regardless — plus the declare-time
freeze, the operator-only and no-such-version guards, and the REST `@<deltaId>` public symmetry). Village
act demos/village/phase-pinned.mjs (A DECLARATION IS PUBLICATION, 3/3). Additive/non-breaking (a bare-name
declaration is the old behavior) → no §20 migration. A §12/§17 constitutional amendment to the anonymous
door → Myk's merge (P6), opened stacked on T9.
