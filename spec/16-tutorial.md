## 16. The interactive tutorial — learn Loam by growing one

The browser peer (§15) makes a real store cheap to hand a stranger, so the tutorial hands them
one and gets out of the way. It ships as a GitHub Pages static site: no signup, no server, no
install until the last step. The learner boots a live governed store in the page and performs
real tasks against it; every lesson's completion is checked by a REAL READ of their store (a
predicate over a query or the ground), never a quiz answer. The right-hand pane — **View |
Ground | GraphQL** — teaches §4's gather/resolve split by simply existing: the same store shown
as its resolved answer, its raw signed deltas, and a live console, side by side.

**It stands alone.** A stranger arriving at the URL has never seen Loam, has run nothing locally,
and knows none of this document. Every concept is taught from zero; the cast and narrative are
the tutorial's own (Alice, Bob, a self-explanatory adversary); no lesson leans on another the
learner skipped, and nothing is installed until the finale. The acceptance bar is that the
writing is apprehensible cold — not only that the code runs. (Internally: the arc reprises
patterns the village (`demos/village`) already proves, so the mechanics are exercised and sound;
the village is never named or assumed on the site.)

**Two stores, because federation is the point.** The learner owns a **media log** (films and
books; a watch is an event with a date, a rating, and GUESTS). A second, bundled store — **the
circle** (Alice, Bob, and friends, pre-signed under their own operator) — describes people. A
guest on a watch is a bare id (`person:alice`) that means nothing in the media store alone; it
lights up with a name and relationships only once the learner federates the circle. "Alice was
just an id until you pulled the store that knows her" is federation taught in one gesture, and it
falls out of the domain rather than being staged.

- **The domain, sketched.** `media` (learner is operator): `Film` (`title` — a `pick` that becomes
  a trust-`chain` in the adversary lesson; `rating` — a `pick`, clearable to absence; `tags` — an
  `all`, added mid-tutorial; `timesWatched` — a `merge count`; `lastWatched` — a `merge max`;
  `watches` — an `expand` into the watch events); `Book` (`pagesRead` — a `merge sum`; `finished`
  — `absentAs false`); `Watch` (a multi-pointer claim template filing into the film's history, the
  timeline, and each guest's card at once). `circle` (bundled, foreign): `Person` with `name` and
  `friends` (an `expand`). The learner may file a private `note` about a guest in their OWN store —
  the target the erasure lesson later removes.

- **The arc — four acts, eleven lessons.** Sovereignty: (1) mint a seed and boot a store — you are
  the operator, no account asked; (2) a fact is a signed delta that lands before any schema exists
  — the inspector shows `id = hash(claims)` and shatters it on a one-byte edit; (3) register a
  schema and the orphaned fact lights up as a View — nothing migrated, a lens was ground and the
  ground answered. The living record: (4) writes are claims — one multi-pointer watch files into a
  film and every guest at once; (5) retraction resolves to absence and aggregates cannot be
  set — clearing a rating empties the key, and a "set timesWatched" is shown for what it is
  today: one more counted claim, the count ticking up by one (when §14's write semantics land,
  this beat upgrades to a refusal with a reason — the lesson teaches whichever truth is
  shipped); (6)
  evolution is append — add `tags` live under a watching subscription that never disconnects.
  Other people: (7) trust and the adversary — a bundled forged claim wins under `pick byTimestamp`
  and loses under a trust `chain`, the forgery still in the ground, `_hviewHex` equal and `_hex`
  divergent; (8) erasure (§11) — a guest asks you to forget a private note; you walk manifest →
  purge → signed tombstone, and the door refuses the id's return; (9) federation — pull the circle,
  and your guests gain names and friendships while the circle's own law stays inert; (10) the open
  door (§12) — a tokenless "stranger at the window", refused all along, reads your public
  films-watched lens the moment you declare it, and only that. The door out: (11) the finale —
  export, `npm i -g @bombadil/loam`, `loam init --seed` + `loam pull`, `loam serve`, and the page
  fetches your localhost store and matches `_hex` hash-for-hash: not a copy, the same store, now
  durable and yours to federate.

- **The finale carries the seed, on purpose.** The export is `{ version, operator, seed, deltas }`
  and the seed rides in the file — because this is disposable tutorial data and the point is to SEE
  the store make the transit intact, the local store proving itself the same store by content
  address (§15's same-operator path). The site says plainly what §15 says: real data keeps its seed
  in the user's own custody; this convenience is the tutorial's alone. If a browser cannot reach
  `http://127.0.0.1` from an https page (Chromium's Private Network Access may refuse), the learner
  pastes the local `_hex` by hand and watches it match — carrying the hash across by hand is, if
  anything, the better lesson.

- **Progress is the store; the checks are real.** There is no progress database to drift: on every
  visit the page reboots the store from localStorage and re-verifies each lesson from the ground
  itself. The only way to "cheat" a check is to append the very deltas the lesson teaches, through
  the console — which is the curriculum entered by a side door, and the copy celebrates it. It is a
  tutorial, not an exam: a green mark never lies about the store's contents, and that is all it
  promises.

- **Architecture.** The site lives in this repo under `demos/tutorial/` (so it imports the same-commit
  browser bundle — version skew is impossible, and CI runs the whole arc as a test), built by
  esbuild like the client bundle and deployed by a `pages.yml` GitHub Actions workflow
  (`upload-pages-artifact` → `deploy-pages`; nothing built is committed, but the bundled packets —
  the circle, the adversary — are data and ARE committed, regenerated byte-identically from fixed
  seeds and timestamps). Zero framework: the store is the state and the UI is a subscriber, so a
  framework would plant a second source of truth precisely where the product's thesis is that there
  is one. The anti-rot guarantee is a test — `test/site/arc.test.ts` boots a store headless, drives
  each lesson through the same functions the UI calls, and asserts every check green in order,
  including the export → `init --seed` → `pull` → `_hex`-match round trip, so the finale's
  hash-for-hash claim is pinned in CI forever.

- **Dependencies on §15 (called out so the sprints sequence right):** the `dist/browser` bundle
  must expose the in-process anonymous read surface (`queryPublic` / `subscribePublic` /
  `NothingPublic` — already in the gateway) for lesson 10, and the `loam pull` verb for lesson 11.

**Provenance.** Landed as the MVP — [#54](https://github.com/bombadil-labs/loam/pull/54) (the eleven-lesson arc as data and functions), [#55](https://github.com/bombadil-labs/loam/pull/55) (the zero-framework theater: View / Ground / GraphQL), [#56](https://github.com/bombadil-labs/loam/pull/56) (the Pages workflow, the cold-reader copy pass). Lives in `demos/tutorial/`, anti-rot pinned by `test/site/arc.test.ts`. Superseded by the sixteen-lesson v2 arc (§19); kept here as the MVP's record, including the review catch that a vacuously-green finale check became a signed homecoming claim the check reads back.
