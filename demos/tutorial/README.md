# The tutorial — learn Loam by growing one (SPEC §16)

Deployed at <https://bombadil-labs.github.io/loam/> by `.github/workflows/pages.yml` on every
push to main. No signup, no server, nothing installed until the last step: the page boots a
real governed store in the visitor's browser and teaches by doing.

- **`lessons.mjs`** — the whole curriculum as data + functions: eleven lessons, each with
  `perform(ctx)` (what the lesson does) and `check(ctx)` (a REAL read of the learner's store —
  never a quiz answer). The page and the CI test drive exactly this module.
- **`app.mjs` / `index.html` / `style.css`** — the theater: zero framework, the store is the
  state and the page is a subscriber. View | Ground | GraphQL panes, the one-byte-shatters
  inspector, and the finale's homecoming (`_hex` for `_hex` against the learner's own
  `loam serve`).
- **`packets/`** — the bundled world (the circle, the adversary): committed data, regenerated
  byte-identically by `scripts/gen-packets.mjs` (`--check` gates drift in CI).
- **`lessons.d.mts`** — types for the test; the module itself stays plain JS.

Build locally: `node scripts/build-site.mjs` then `node scripts/serve-site.mjs` →
<http://127.0.0.1:4173/>. The anti-rot guarantee is `test/site/arc.test.ts`: every lesson
green in order, the revisit re-verified from the ground, and the export → `loam pull` →
`_hex`-match finale, all in CI.
