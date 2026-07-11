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

## Research notes (verified against rhizomatic 0.2 + the village, so 3a starts cold)

- **Policy JSON grammar** (`parsePolicy`): pick `{"pick":{"order":{"byTimestamp":"desc"}}}`;
  all `{"all":{"order":…}}`; merge `{"merge":"count"}` (fns incl. count/max/sum/and/or);
  absentAs `{"absentAs":{"const":false,"then":{…}}}`; chain is an ORDER:
  `{"order":{"chain":[{"byAuthorRank":["ed25519:…"]},{"byTimestamp":"desc"}]}}`.
- **Body/term JSON**: the canonical gather is the village's
  `group byTargetContext ∘ select hasPointer(targetEntity=root) ∘ mask drop` (see
  `_testing/schemas/*.json`); expand is `{"op":"expand","role":{"exact":"friend"},
  "schema":"Person","in":{…gather…}}` (`_testing/schemas/circle.json`).
- **Authors are `ed25519:<hex>`** (not did:key). `assembleGenesis({operatorSeed,
  registrations, grants})`; grants via `grantClaims(STORE_ENTITY, author, "write", op, ts)`.
- **Multi-pointer watch (lesson 4)**: append a signed delta with several pointers directly
  (signClaims) — no ClaimTemplates needed; "writes are claims" IS the lesson.
- **Lesson 10**: `gateway.queryPublic` / `subscribePublic` confirmed on the Gateway class
  (gateway.ts:1098/1111) — they ride the browser barrel via the class.
- **Finale wrapper**: `{ version, operator, seed, deltas }` — `parseOffer` reads only
  `.deltas`, so `loam pull` accepts it as-is (verified reading offer.ts).
- **Packets determinism**: fixed seeds like the village's (`SEEDS` pattern), fixed
  timestamps; `JSON.stringify` of `toWire` rows; regenerate must be byte-identical.
- **arc.test.ts finale**: use `run()` from src/cli/cli.js in-process (pattern:
  test/cli/pull.test.ts), tmp home, `init --seed` → `pull <file>` → `Gateway.open` over
  `storePath(home)` → same query → `_hex` equality.

**Left off here:** research done (grammar + surfaces verified). Next action: write
`scripts/gen-packets.mjs`, then `site/lessons.mjs`, then `test/site/arc.test.ts` (3a).
