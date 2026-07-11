# Current work — Sprint 3: the interactive tutorial (SPEC §16)

_Cycle stage: 2 (tests first, sub-step 3a). Branch: `tutorial`. Sprints 1 (browser store,
PR #51) and 2 (continuity, PR #53) are merged; read SPEC §16 whole before touching this._

**Success criteria.** A GitHub Pages static site teaches Loam by handing the visitor a real
in-page store: eleven lessons over the media+circle two-store domain, every completion checked
by a REAL READ of the learner's store, View | Ground | GraphQL panes side by side, cold-
apprehensible copy (the acceptance bar), ending in export → `npm i -g @bombadil/loam` →
`loam init --seed` + `loam pull` + `loam serve` → the page matches `_hex` hash-for-hash.
Anti-rot: `test/site/arc.test.ts` drives every lesson headless in CI, including the finale
round trip.

## Sub-steps (each is a PR-sized slice)

### 3a — packets + the lesson arc, headless (in progress)

- [ ] `scripts/gen-packets.mjs` — deterministic (fixed seeds, fixed timestamps): emits
      `site/packets/circle.json` (the foreign Person store: Alice, Bob, friends — signed under
      the circle operator) and `site/packets/adversary.json` (the forged title claim for
      lesson 7). Committed data; regenerating is byte-identical.
- [ ] `site/lessons.mjs` — the arc as DATA + FUNCTIONS, UI-free: for each of the 11 lessons
      (SPEC §16 arc): `{ id, title, copy, perform(ctx), check(ctx) → boolean }` where ctx
      holds the learner's gateway + storage + packets. `check` reads the STORE (query or
      ground predicate), never UI state. The media-store schemas (Film/Book/Watch policies
      exactly as §16 sketches) live here too.
- [ ] `test/site/arc.test.ts` — boots a store headless (MemStorage shim), drives lessons 1–10
      through the same `perform`/`check` functions the UI will call, asserts every check green
      IN ORDER, then lesson 11: export `{ version, operator, seed, deltas }` → `loam init
      --seed` + `loam pull` (run() in-process, tmp home) → boot/serve → `_hex` match.
- [ ] Gate green → PR → one careful review → merge.

### 3b — the page

- [ ] `site/index.html` + `site/app.mjs` + `site/style.css` — zero framework; the store is
      the state, the UI subscribes. Left: lesson copy + progress (re-verified from the ground
      on every boot). Right: View | Ground | GraphQL panes. Console = the GraphQL pane.
      Boots on REAL localStorage (`LocalStorageBackend("tutorial")`), seed at its own key.
- [ ] `scripts/build-site.mjs` — esbuild `site/app.mjs` (importing `src/browser/index.ts`
      same-commit), copy static + packets → `site-dist/` (never committed).
- [ ] Verify in the Browser pane (preview_start against site-dist) — every lesson clickable
      end-to-end, both themes, mobile width.
- [ ] Gate green → PR → review → merge.

### 3c — ship it

- [ ] `.github/workflows/pages.yml` — build-site → upload-pages-artifact → deploy-pages.
- [ ] The cold-apprehensibility editing pass over all copy (the bar: a stranger who has never
      seen Loam). README gains the tutorial link.
- [ ] Village ledger + JOURNAL entries; re-plan; close the three-sprint arc.

## Standing decisions for this sprint

- The finale export carries the seed ON PURPOSE (disposable tutorial data; the site says
  plainly that real data keeps its seed in custody). `loam pull` already accepts the wrapper —
  `parseOffer` reads only `.deltas`.
- Lesson 10 needs the gateway's anonymous read surface (`queryPublic` / `subscribePublic` /
  `NothingPublic`) — the barrel exports the Gateway whole, so they ride already; verify in 3a.
- No jsdom anywhere: headless tests use the MemStorage shim; the page uses real localStorage.

**Left off here:** sprint 3 opened; about to write gen-packets + lessons + arc test (3a).
