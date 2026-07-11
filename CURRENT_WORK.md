# Current work

_The live checklist. Empty means nothing is queued — the resume protocol (see `CLAUDE.md`) is
then to ask Myk what to build next, and open it here at cycle stage 1._

**Nothing in flight (2026-07-11, overnight run).** The road to shipping — all three sprints —
is **complete and merged**:

1. **The browser store (SPEC §15)** — PR #51 (+#52): `LocalStorageBackend` as the sixth
   contract witness, `@bombadil/loam/browser` boots a whole governed store in a tab; village
   phase17 ("the tab", 5/5).
2. **Continuity (SPEC §15)** — PR #53: `exportOffer`/`parseOffer` byte-identical to the
   `/federate` door, `loam pull <url|file>`, same-operator law-binds `_hex`-for-`_hex`;
   village phase18 ("the take-home", 4/4 — "3 accepted of 4 offered" IS the identity proof).
3. **The tutorial (SPEC §16)** — PRs #54/#55/#56: eleven lessons over a real in-page store,
   every green a real read (CI-pinned arc incl. the finale round trip), the page walked end
   to end in a real browser, pages.yml ready.

**Human steps waiting on Myk:**
- Enable GitHub Pages for the repo (Settings → Pages → Source: GitHub Actions) — pages.yml is
  inert until then; the README already links https://bombadil-labs.github.io/loam/.
- The npm publish button remains Myk's (package still `"private": true`… — see standing
  decisions in CLAUDE.md).

**Designed candidates, not queued** (from the pre-sprint list): write semantics (SPEC §14 —
lesson 5 of the tutorial upgrades to "refused with a reason" when it lands); as-of replay;
hosted `StoreBackend` (libSQL/Turso); renderer-generation for grown stores.
