# Current work

_The live checklist for the work in progress; cleared when a unit merges._

**Status: nothing in progress.** The cold-storage unit is complete and merged — PR #22 (the
mirror and the archive, 285/285) and the village's fire (phase10.mjs 4/4; the living village
burns the almanac's sqlite every 24th beat and replants it from the seed vault, watched live).
Licenses landed as PR #21 (MIT OR Apache-2.0, Myk's choice).

**To resume:** ask Myk what to build next, then open it here at the loop's stage 1.

**Named candidate for the next store unit** (from the cold-storage re-plan, not yet Myk's ask):
a hosted driver — libSQL/Turso drops in beside `SqliteBackend` (the Deploy section of the
README already promises the seam supports it). One writing gateway per store still holds;
a hosted driver would want `deltasSince`'s watermark negotiated server-side eventually.

**Shipped (2026-07-10):** `@bombadil/loam` is live on npm — v0.0.1 via the release workflow,
tokenless (OIDC trusted publishing, SLSA provenance). The NPM_TOKEN secret is deleted and the
token revoked. Releasing is `npm run release -- patch|minor|major` on clean main; the rest is
CI.
