# The Village — Loam's living demonstration

Four (and counting) federated Loam stores, a cast of villagers, and a browser dashboard —
a small society that exercises everything Loam claims, end to end, over real HTTP. It began
as an ephemeral field test; it graduated (Myk, 2026-07-09) into a **living demonstration
that grows with every PR**: the loop's stage 7 (see `../../CLAUDE.md`) extends the village to
exercise each new behavior, and logs it in the ledger below.

Nothing here is product, and nothing here gates the build. `homes/` (sqlite stores and
operator seeds) is untracked and disposable — delete it and the phases rebuild the world.

## The cast

| identity    | who                                          | writes on      |
| ----------- | -------------------------------------------- | -------------- |
| **Wren**    | gardener; keeps the village commons          | commons        |
| **Miles**   | cinephile; logs every screening              | reel, commons  |
| **Odile**   | beekeeper; keeps a frank apiary journal      | hive, commons  |
| **Petra**   | newcomer; arrives mid-saga                   | commons (late) |
| **Mallory** | no standing anywhere; supplies the adversary | nothing, ever  |

## The stores

- **commons** (:4401) — the social graph: `Person`, `Circle` (friends expanded through
  Person). Registered via the **CLI**.
- **reel** (:4402) — Miles's screening log: `Film`, `Screening` (the schema-evolution target),
  `FilmNight`, its own `Person`. Registered via **HTTP /register**. Pulls the commons.
- **hive** (:4403) — Odile's apiary: `Colony` (with frank `grumbles`), `Gathering`. Registered
  via **MCP**. Federates through an **offered lens** — the grumbles never leave home.
- **almanac** (:4404) — the confluence: pulls everyone, writes nothing, serves `Dossier`,
  `Presence`, `TrustedDossier`, `GuardedDossier` — one gathered ground, many lenses. The
  dashboard reads here.

Person entities are the only shared vocabulary; everything else composes by federation.

## Run it

```sh
node demos/village/phase0.mjs   # groundwork: homes, operators, registrations (all 3 surfaces)
node demos/village/phase1.mjs   # …through phase23.mjs — each phase is a runnable act with checks
node demos/village/village.mjs  # the living village: all stores + pulse + simulator + dashboard
                           #   → watch it at http://127.0.0.1:4400
```

`PLAN.md` is the original saga's tracking document (51/51 checks) plus field notes — the finds
there (resolution eliding the anchor pointer, `_hex` covering the whole view, the byAuthorRank
tie surprise) drove real Loam and rhizomatic changes.

**The fresh-run ritual.** The standing `homes/` are the village's living world — long-lived,
untracked, and comfortable. That comfort can hide drift: a schema change that only bites a store
registered from scratch will never surface against homes that predate it (this happened — the §14
immutable-by-default flip left every schema file without its `writable` list, and the standing
homes masked it for weeks; ticket T20 was the repair). So before trusting the village as a
regression net — a refactor slice, a serving-surface change — run it from a clean seed, in
numeric order:

```sh
rm -rf demos/village/homes
for i in $(seq 0 23); do node demos/village/phase$i.mjs; done
node demos/village/phase-bytes.mjs && node demos/village/phase-pinned.mjs \
  && node demos/village/phase-guestbook.mjs && node demos/village/phase-quarantine.mjs
```

All 28 acts green from fresh, in order, is the bar (certified 2026-07-16). The standing-homes
workflow stays — it is the living world — but it is the demo, not the witness.

## Growing a new store (demo item 7)

`grow.mjs` bootstraps a new sovereign store into the running village — its own home and
operator, a schema registered over HTTP, a scribe with write standing, optional seed facts,
and an entry in `homes/peers.json`. The village's pulse re-reads that file every beat, so the
almanac pulls the newcomer on its next beat and narrates first contact in the event log.

```sh
node demos/village/grow.mjs sightings --port 4406 \
  --schema demos/village/schemas/sighting.json --claims sightings-facts.json
```

- **The schema file** is the same shape `gen-schemas.mjs` emits (see any `schemas/*.json`):
  a `name` (UpperCamel, singular), the canonical gather body (copy it verbatim — only the
  policy and roots vary store to store), a `policy` whose `props` name the GraphQL fields
  (`pick` latest resolves to a value; `all` to a list), and `roots` — the entity ids held
  live.
- **The claims file** is triples, each becoming one signed delta from the store's scribe:
  `[{ "at": "sighting:1", "context": "species", "value": "heron" }]`. Timestamps are fixed,
  so re-running dedups by content address.
- The grown store is sovereign like the founders: its own operator, its own law, its own
  port (default 4406; pick the next free one for a second store). What the village renders
  of it is the almanac's lens choice, like everything else — to surface a foreign vocabulary
  in the dossiers, add a translation (the cinelog pattern in `village.mjs`).
- `^C` stops the process; the data stays in its home, and the peers entry survives for the
  next run.

`phase16.mjs` drives this whole path headless (spawning `grow.mjs` as a child, as the demo
does) and asserts the three claims — schema answers live, peers.json entry written, one pull
lands the facts in the almanac. Run it like any phase: `node demos/village/phase16.mjs`.

**The `grow-a-store` skill** (`demos/village/skills/grow-a-store/SKILL.md`) is a short pointer at
this section — the recipe demo-Claude follows when asked to "build a store for X" mid-meeting.
It lives here because it belongs to the demo; to make it an active Claude Code skill on a
machine, copy `demos/village/skills/grow-a-store/` into that repo's `.claude/skills/` (which is
gitignored, so the active copy stays local while this canonical one ships).

## What it demonstrates — the ledger

_(one entry per PR that grew the village; newest last)_

- **The founding saga** (steps 0–9 era, PLAN.md phases 0–7, 51/51): registration through all
  three surfaces; capabilities and their refusals; SSE snapshots/patches with hex chains; many
  schemas over one ground; live schema evolution under a watching subscriber with old/new
  shapes served concurrently; byte-identical replay of old ground under old law; lensed
  federation (grumbles stay home); the trust duel (pick-latest falls for Mallory's forgery,
  byAuthorRank does not); four-store convergence audits; cold restarts; the adversarial sweep.
- **PR #17 — rhizomatic 0.2.0 lenses** (phase8.mjs): `TrustedDossier` upgraded to
  `chain[byAuthorRank, byTimestamp]` — it now shows the trusted author's **latest** word
  (the founding saga's field-note bug, fixed by the substrate we asked for). New
  `GuardedDossier` on the almanac built from `governedGatherBody(operator)`: Mallory
  **strikes** Wren's bio delta by federation — the plain `Dossier` goes blank (the heckler's
  veto, visible), while `GuardedDossier` keeps the bio (stranger strikes are inert under the
  governed lens). The village simulator gains the strike act; the dashboard's trust duel now
  distinguishes forged-value from erased-value attacks.
- **PR #18 — trust is data**: Mallory's arc grows two acts. After Wren heals the record, the
  almanac's operator **declares a roster with one delta** (the villagers and the three peer
  operators) — and Mallory's very next forgery **bounces at the door** (`accepted: 0`,
  narrated in the event log); then the almanac reopens, an aggregator by choice. The same
  roster that gates the door is readable as an eval-side lens (`trustRosterPred`) — one
  source of truth, demonstrated live.
- **PR #19 — normalization, and THE GAUNTLET**: the village gains its fifth store — `cinelog`
  (:4405), Sasha's app, speaking a dialect no villager knows (`film_watched`/`viewer`/`on`).
  The open almanac pulls it whole; one operator-signed **translation spec** renders every
  entry into the village's tongue; and Wren's dossier now shows a screening **recorded by a
  stranger's app**, provenance visible in the resolved view itself (`origin: cinelog`,
  `translates: <source id>`). The roster flipped mid-run and the pulse refused the stranger;
  flipped back and the backlog normalized (phase9.mjs, 4/4). In the living village, every
  pulse now ends with a translation pass, narrated in the event log. The arc's thesis,
  demonstrated: anyone may write, in any tongue — the reader decides everything, and
  understands more than it was told.
- **PR #22 — cold storage: THE CRASH** (phase10.mjs, 4/4): the almanac now keeps a **seed
  vault** (`homes/almanac/vault` — an `ArchiveBackend` behind a `MirrorBackend`): every
  append lands hot and cold in one motion, one file per delta, named by its content address.
  The living village gains the crash act (every 24th beat): the almanac's sqlite **is lost
  mid-story** — and the reopen heals from the vault before the gateway reads.
  Watched live: `💥 the almanac's disk fails — 187 deltas of hot store, gone in an instant` →
  `🌱 the seed vault replants the almanac — 187 deltas restored, every dossier intact`; the
  dossier watchers resubscribe, the pulse resumes, the dashboard barely blinks. Phase 10's
  quiet perfection: the bio that survived the crash word-for-word was Mallory's old forgery —
  the vault preserves *everything* and leaves judgment to the lenses, exactly as a store of
  record must.
- **The mill — the village's first ANIMATE store** (phase11.mjs, 4/4 twice — re-runnable):
  the v1 runner machinery, exercised in the open air at last. The almanac's operator blesses
  ONE derived function (`fn:grind`); a new villager, **the miller**, attaches a Runner; and
  village life grinds into flour — a 🌾 `presence` line on every dossier card, derived,
  signed by the miller, superseding per villager (keyed emission), durable without the
  runner. The crash act now REHANGS THE WHEEL after replanting (a Runner is process machinery,
  not ground). Verified live in the browser: three cards carrying moving flour, and the
  translated cinelog chips now show their provenance — `stalker ⇠ cinelog`. Found and fixed
  along the way: `readBindingDefinitions` now resolves latest-per-binding (a re-blessed
  recipe crashed attach with a duplicate install), and the reference emit-mode lesson —
  wholesale `supersede` erases OTHER roots' flour; per-subject output wants `keyed`.
- **PR #36 — THE UNSAYING (erasure, SPEC §11)** (phase12.mjs, 4/4 twice): Wren speaks in
  haste and asks the almanac to unsay it — and because **erasure is the instance operator's
  alone** (destructive, so maximally gated), the almanac's operator, as the controller, honors
  the request. The bytes are cleared from every tier (the vault's heal is tombstone-guarded on
  every path), the dossier reverts, the **signed hole** remains (who asked, when, which id —
  never what), and the door refuses the id's return even though the commons still holds the
  original and offers it back on every pulse — sovereignty both ways, watched live: `🕳️ the
  almanac's operator honors it — the bytes are cleared from every tier, the signed hole
  remains, and the door will refuse its return`. The erase re-seats the
  almanac's reactor; the mill wheel is rehung after, like the crash.
- **THE PLAYABLE VILLAGE (Unit 3a — the theater)**: `dashboard.html` is now a 2D canvas
  village game, driven entirely by the same SSE stream it always spoke. Buildings — the reel
  barn, the hive, the commons garden, the almanac hall (with a mill wheel that turns when the
  store is animate, and the seed vault beside it), and the cinelog hut beyond the palisade —
  sit on a green field; villager sprites walk to a building when an act fires there (the actor
  and place are inferred server-side in `tell()` and ride each event), speak the event in a
  bubble, then drift home. The federation pulse beats in the header; the crash shakes the hall;
  a refused crossing flashes the gate. **Click any villager** to open their dossier: the
  three-lens trust duel (plain bio vs. trusted vs. guarded) and the mill's 🌾 presence line,
  live. Movement is theater; the acts are ground — the game is a lens over the same deltas, and
  nothing about the village changes to support it. (Verified live in the browser.)
- **PR #43 — THE OPEN DOOR (Unit 2, SPEC §12)** (phase13.mjs, 6/6): the almanac becomes a
  store a stranger's browser can simply read. One operator-signed declaration at
  `loam:public` opens the three dossier lenses to tokenless query + subscribe; the dashboard
  now reads the almanac **directly** — native EventSource against
  `:4404/almanac/subscribe`, CORS-served, **no token anywhere in the page** and no proxy for
  the data (the viewer keeps only the theater: events, pulse, trust duel, flour). The
  anonymous surface is a smaller world with no Mutation type at all; a never-declared lens
  (`Presence`) is invisible even to introspection; one negation closes the door and closed
  reads exactly like absent. Phase 13 also walks the SHIPPED browser client
  (`dist/client`, the bundle) through the non-custodial door: a new villager mints a seed
  in-page, the operator grants standing, and the claim rides **Mallory's** transport token —
  landing under the newcomer's own signature, readable back tokenless. Watched live: the
  crash act replants the almanac and the page's EventSources reconnect through the open door
  on their own, dossiers intact. (Hygiene in passing: the homes were reset and re-baselined;
  gen-schemas now carries the presence field the mill's evolution promises; phase0's operator
  count follows the store roster; mixed-encoding narration strings repaired.)
- **THE PLAYER (Unit 3b)** (phase14.mjs, 5/5): the welcome flow is the constitution as
  gameplay. The page grows a **"write yourself in"** panel: name → a key minted in-page
  (localStorage keeps it; it never travels) → a signed **petition delta** knocks at the
  viewer's `/petition` gate. The knock is real — before the grant, the same claim is refused
  at `/append` (the page's gate token is TRANSPORT, and transport lends nothing). The operator
  grants standing, lands the petition as the record of asking, and — joining is
  constitutional twice over — **evolves the Dossier registration's roots** (one append, data,
  vault-durable) and rehangs the mill on the new generation, so the wheel grinds the newcomer
  exactly as it grinds the founders. From there: tend your bio, attend the gathering by
  arriving, join a screening — each act one signed delta through the non-custodial door, each
  visible tokenless on your dossier card, your sprite walking the acts. Watched live: Isolde
  knocked, wrote, attended; the crash act lost 172 deltas mid-session and the vault replanted
  her whole life — grant, petition, bio, flour — and her NEXT write landed as if nothing had
  happened. A returning visitor knocks again idempotently (same key, same author, same
  dossier).
- **MULTIPLAYER IS FEDERATION (Unit 3c — the sock-knocker)** (phase15.mjs, 5/5): two
  villagers, two DIFFERENT stores, no game-server authority — Ana writes on the almanac, Ben
  on the commons; one pulse and the union holds them both, and two independent tokenless
  readers render it identically, `_hex` for `_hex` (the content address IS the agreement).
  Then THE TAKE-HOME: a fresh store, HER OWN operator, one pull — 200+ deltas arrive and the
  village's law binds NOTHING on her machine (no surface at all, by the same lawful-reads
  rule that keeps federation safe); she registers her own Dossier lens and the whole village
  answers through HER law, her villager included. Sovereignty both ways, sharpened: the
  almanac's open-door declaration rode the pull and sits in her ground as data — and her door
  stays closed until she says otherwise. Found along the way: the living village's forgery
  arc can leave the almanac ROSTERED between runs, and the phase's first pull obeyed it —
  trust-as-data enforcing itself across process lifetimes; the phase now states its own
  posture (one `open` declaration) instead of inheriting the last drama's.
- **THE TAB (SPEC §15, PR #51)** (phase17.mjs, 5/5): a wanderer passes the village with no
  server, no home directory, no port — a browser tab. The phase drives the SHIPPED store
  artifact (`dist/browser/index.js`, `@bombadil/loam/browser`) against a localStorage origin:
  a governed store boots inside the bundle (genesis → register → claim; Mallory refused at the
  door, as everywhere); one `pullFrom` brings the commons over real HTTP — 34 deltas cross and
  the village's law binds NOTHING (no Person surface until the wanderer registers her own lens,
  and then the village answers through HER law); the tab closes and a second one on the same
  origin remembers everything — notes, pulled ground, both lenses, no register() call anywhere;
  and erasure reaches the page — tombstone → purge → removeItem, the note's key physically gone
  from the origin, the door refusing its return, the seed key (never a delta) untouched. The
  same Gateway the village runs on ports, on a different driver — a leaf or an aggregator,
  never a hub, exactly as §15 states proudly.
- **THE TAKE-HOME COMPLETES (SPEC §15 continuity, PR #53)** (phase18.mjs, 4/4 on first run):
  phase 17's wanderer takes her notebook home. The tab freezes itself with `exportOffer` —
  the exact bytes `/federate` would serve — and `loam init --seed` + `loam pull` land the
  file in a laptop home holding HER seed. The counters tell the §15 story by themselves:
  the first pull reports **3 accepted, of 4 offered** — the fourth delta is the operator
  marker, already present by content address, because the laptop's genesis and the tab's
  genesis are THE SAME DELTA (genesis is pure; the CLI store IS the browser store). Served
  from the laptop, the notebook answers through the imported law — no register() anywhere —
  and the view matches the tab **`_hex` for `_hex`**. A second pull accepts 0 of 4: union is
  union. A store born in a browser, served from a laptop; nothing re-signed, nothing lost.
- **TWO DOORS, ONE TRUTH (SPEC §17, PRs #59–#62)** (phase19.mjs, 4/4 twice — re-runnable
  by law: the operator clears its stage by striking stale versions, the same instrument the
  finale demonstrates): the almanac answers REST beside GraphQL from the same registrations.
  A live OpenAPI document names its lenses; the same view crosses both doors _hex for _hex;
  evolution mints v2 while v1 stays answerable — one tags fact, two resolutions (the old
  lens's DEFAULT answers a scalar where the new lens's ALL answers a list), two content
  addresses, both true under their law; and withdrawal is the operator striking the
  registration delta — 410 Gone by its true name on the operator's door, a uniform 404 to
  the anonymous window, because history is not anonymous. The surface seam beneath it
  (SurfaceGenerator, SPEC §17) is what the tutorial's two-doors beat will stand on.
- **THE TUTORIAL (SPEC §16, PRs #54/#55/#56)** — not a village act but its public-facing
  sibling, recorded here because the arc reprises what the village proves: `site/` ships a
  GitHub Pages tutorial where a stranger boots a REAL governed store in their browser and
  walks eleven lessons — sovereignty, facts-before-schema, lenses, the multi-pointer claim,
  retraction/absence/aggregates, live evolution, the adversary and the trust chain, erasure,
  federation (the bundled circle store, foreign law inert), the open door, and the take-home
  finale (`loam pull` of the page's own export, `_hex` for `_hex`). Every lesson's completion
  is a real read of the learner's store (`test/site/arc.test.ts` drives the whole arc headless
  in CI); the page was walked end to end in a real browser, homecoming recorded. The village
  stays the internal proving ground; the tutorial is the door strangers enter by.
- **GROW AN APP LIVE (demo item 7)** (phase16.mjs, 3/3): the confluence is open-ended now —
  the pulse re-reads `homes/peers.json` every beat, and `grow.mjs` puts a whole new sovereign
  store on the map in one command (see "Growing a new store" above). Watched live: `sightings`
  grew on :4406 with its own operator, registered `Sighting` over its running surface, seeded
  five facts from a triples file, and the village narrated first contact — `🌱 a new store
  joins the confluence: sightings` — with the grey heron in the almanac's ground one beat
  later. phase16 drives the same path headless — spawning `grow.mjs` as a child, exactly as
  the demo does — and confirms the grown store answers its own `Grove` schema immediately,
  registers itself in `homes/peers.json`, and one pull lands its facts in the almanac's
  ground. Joining the village is running a command, not editing the village.
- **CLEARING IS RETRACTION (SPEC §14, PR #73)** (phase20.mjs, 5/5 twice — re-runnable: the act
  resets its own commons stage, genesis re-lands): two residents keep a shared
  `Board` on the commons — `notes` unions every voice, `headline` is latest-wins. Wren withdraws
  their OWN note and miles's still stands: retract-your-own is scoped, a clear never touches
  another author's claim (to keep others out of a view you narrow the Policy, not the ground).
  Miles then clears through the REST door's honest verb — `DELETE /rest/v1/Board/board:commons` —
  and the list empties to ABSENCE (null at the surface), until a fresh word repopulates it:
  "withdraw my claim", never "no one may speak here". And a `pick` `headline`, cleared, resolves
  to absence too — null on the answer, no null ever written onto a reference. Then the amendment:
  **`remove`** withdraws the ONE note miles names by value (the rest of the list, wren's included,
  untouched — and miles cannot remove wren's), and a **`writable`** `Ledger` opens `amount` to
  writes while `memo` is read-only at the door — assert and clear both refused, though the ground
  stays open. Removal and write-discipline, at last, through the surface — the dual of reading:
  negate your own contributions, let the Policy re-resolve.
- **THE SCHEMA IS A CITIZEN (SPEC §21 slice 2)** (phase21.mjs, 4/4, re-runnable — clears its own
  Ledger21 stage): the resolution Schema stops riding inline in the registration and becomes a
  first-class entity in the ground. Registering `Ledger21` on the almanac plants a living
  `schema:Ledger21` node — read straight back out of the store as a domain object, `{amount}` and
  all, no longer a blob buried in a delta — and a frozen, content-addressed VersionedSchema snapshot
  (`schema:Ledger21@<hash>`) beside it. Evolve the lens (add `memo`) and a NEW snapshot is minted while
  the OLD one still loads, undisturbed: two readings coexist, neither struck — backwards-compatibility
  as a property of content addressing, not a courtesy the operator remembers. And it lands where it
  counts, through the REST door: `/rest/v1/` answers `memo` as a scalar (v1's DEFAULT over the same
  fact) where `/rest/v2/` answers it as a list — each version resolving against its OWN frozen
  snapshot, which IS §17's per-version freezing, now standing on named, pinnable entities. (Genesis
  itself changed shape here: a registration is five deltas now — marker aside, hyperschema + living
  Schema + snapshot + binding — checked in phase0.3b.) The demonstrable §21 story so far; coexisting
  lenses and the `name@hash` URL wait for the coexistence slice.
- **THE LENS COMPUTES (SPEC §22, rung a)** (phase22.mjs, 4/4, re-runnable — clears its own Ledger22
  stage): a Policy adjudicates WHICH claims survive; a custom resolver decides what they MEAN. The
  almanac registers a `Ledger22` whose `amount` carries a bucket-pure resolver, and the field's value
  becomes a computation over the whole bucket — the SUM of three entries (140), where the Policy's
  pick-latest would answer 90. The resolver is directly-runnable ESM riding the binding; the door
  advertises the field it actually serves (OpenAPI types `amount` a number, §22.6). Then the two edges
  that make it honest: erase one entry and the sum RE-RUNS to 130 — the memo keys on the surviving
  bucket, so the cache forgets exactly when the ground does (§22.5/§11), never handing back a value
  distilled from forgotten bytes; and change ONLY the resolver (sum → count) and a new version mints
  while v1 keeps its own reading — `/rest/v1` still SUMS (130) where `/rest/v2` COUNTS (2) over one
  ground, a resolver frozen with its version (§22.4). The higher rungs and synthetics are refused at
  the door; v1 runs the operator's own code, the sandbox for untrusted law waiting on §24.
- **PUSH DELTAS, GET SOFTWARE (SPEC §23, v1)** (phase23.mjs, 4/4, re-runnable — clears its own Card23
  stage): a store carries its schema, its doors, and its law; §23 gives it its own FACE. The almanac
  registers a `Card23` lens, lays a card's worth of facts, and PUSHES A RENDERER — a UI unit, as deltas,
  bound to a schema and a route — and then a plain `GET /almanac/app/card23/<entity>` returns HTML
  rendered from the store's own live view: no build, no deploy, the database is the deployment. Then the
  beats that make it real: the anonymous door serves the face only once the operator declares the lens
  public (401 → 200, §17 read discipline at the screen); re-pushing the renderer EVOLVES the face live
  (one ground, new pixels — a ✦ and a blockquote appear); and an app never outlives its source (§23.6) —
  strike its bindings and the route goes dark (404). The renderer is a headless `(node) => html` bundle,
  executed server-side through the same door projection GraphQL and REST resolve through — a whole new
  surface, no new authority machinery. The live browser React host, write-enabled faces, the ocap
  sandbox, and binary assets are §23's later slices.
- **A FACE MADE OF BYTES (SPEC §23.7)** (phase-bytes.mjs, 3/3, re-runnable — clears its own Portrait
  stage): renderers paint pixels, and some pixels ARE bytes. The almanac registers a `Portrait` lens with
  an `avatar` image fact (a `bytes` target), pushes a renderer that paints an `<img>` whose `src` points at
  the BYTE-DOOR, and a `GET /almanac/app/portrait/<entity>` returns HTML carrying that `<img src>`. A view's
  bytes leaf crosses every door as the self-describing envelope `{ mime, ref, base64url? }`, so the renderer
  builds the URL from `ref` and never touches a `Uint8Array`. Following that `<img src>` — `GET
  /almanac/bytes/<ref>?from=Portrait/<entity>` — returns the raw image bytes with `image/png`, by PROOF OF
  READ: the door re-resolves the lens under the caller's own access and serves the bytes only because the
  view actually contains them (no ref→bytes oracle, no store scan). Then §11 arrives at the screen: erase the
  avatar fact and the byte-door 404s by construction — the door never cached, so forgotten bytes cannot
  outlive their ground.
- **A DECLARATION IS PUBLICATION (SPEC §23.8)** (phase-pinned.mjs, 3/3, re-runnable — clears its own Notice
  stage): §17 keeps the anonymous door to a lens's LATEST version, because an anonymous @hash probe was a
  version-existence oracle — but a renderer PINS a version, and a public pinned route wants a stranger. The
  almanac registers a `Notice` lens, EVOLVES it to v2 (so "v1" and "the latest" differ), pins a renderer to
  v1, and declares that pin public with `declarePublic(["Notice@v1"])`. The anonymous door then serves the
  v1-pinned route — but only after the declaration: a declaration is publication (the operator chose to
  reveal exactly that version), not a probe (every other version stays 404). The full door serves the pin
  regardless; and withdrawing the declared version darkens the anonymous route by construction (§23.6), a
  uniform 404 with no withdrawn-vs-never oracle. The pin is frozen to the version's content address at
  declare time, so it never slides.
- **EVERY RENDERED ROUTE IS NOW SANDBOXED (SPEC §23.9)** — no new act; a property that now holds under all
  three renderer acts above. Each render runs in a Node `worker_threads` Worker with a hard timeout +
  memory limits (`src/gateway/render-worker.ts`), so a hanging or heavy bundle folds to a clean 500 and
  every other route keeps answering — the anonymous door can no longer be wedged by an infinite-loop
  bundle. The renders in phase23 / phase-bytes / phase-pinned all cross that boundary now. Honest scope: a
  Worker bounds the hang/crash/memory, not fs/net — true object-capability isolation is §24's work.
- **A FACE THAT WRITES (SPEC §23.3)** (phase-guestbook.mjs, 2/2, re-runnable — clears its own guestbook
  stage): §23 v1 renderers only read; this closes the loop. The almanac mounts a guestbook whose renderer
  paints an HTML `<form>`, and an ANONYMOUS visitor POSTs a message over plain HTTP. The store signs the
  resulting delta as a per-renderer PEN — a granted-author identity provisioned in the store's config, never
  the visitor's key — so provenance shows the mediating code, and the re-rendered page shows the new entry.
  Then §6's two keys made visible: REVOKE the pen's grant, and the very same form writes nothing
  (provisioning is custody; the grant is authorization) — while the entry it already wrote stays on the
  record, still attributed to the pen. The anonymous write lands only because the operator did all three:
  declared the lens public, provisioned the pen's seed, and granted it write standing (§12 — no anonymous
  writes by default). The user's-own-pen (non-custodial) variant awaits the browser host.
- **ONE GATHER, MANY READINGS (SPEC §21.7)** (phase-coexistence.mjs, 3/3, re-runnable): the symmetry
  §4 promised, finally served — the almanac's Townbook gather carries TWO living lenses at once: the
  broad latest-wins reading, and FirstImpressions, the archival oldest-wins sibling that keeps the
  first thing anyone said. They serve simultaneously (the pre-§21.7 registry EVICTED the elder), evolve
  on their own clocks (the archive drops its field; the broad lens never flinches), and the anonymous
  door opens lens by lens — Townbook is declared public, FirstImpressions stays the town's own.
- **THE SCOPE IS A QUERY (SPEC §27.6)** (phase-membership.mjs, 4/4, re-runnable): membership stops
  being a config file. The operator stands up a TRIAL POOL over a hand-picked scope said as algebra —
  the trial ledger's claims MINUS the drafts, a difference over a select — watches the pulse
  re-evaluate the same Term live (new entries cross, new drafts stay home), proves §24.8's erasure
  reaches byte-for-byte through the Term-scoped glass, and drops the trial wholesale. select/watch
  are the first-class doors; the quarantine's admit predicate is the same knob's degenerate form.
- **THE DOOR THAT SAYS BUSY (SPEC §23.9)** (phase-rendercap.mjs, 3/3, re-runnable): the public
  square's rendered notice board meets a crowd — six anonymous readers against a cap of two workers.
  The door serves what it can, refuses the rest with a clean "busy" that names no route, lens, or
  entity, returns every slot when a render finishes (four polite readers in a row all served), and
  the operator's token door renders past the cap — the discipline is the anonymous fan's alone.
- **A PLACE WHERE UNTRUSTED LAW MAY BIND (SPEC §24, slice 1)** (phase-quarantine.mjs, 6/6, re-runnable):
  today foreign law is inert-by-default — safe, but untestable. The quarantine closes that gap. The almanac
  stands up a QUARANTINE POOL — a second store over its own ground, seeded ONE-WAY from the primary — that
  resolves the primary's LIVING ground (a real lens over real ground, where a stranger's whole app could run
  sequestered). Then the invariants that make it trustworthy: the glass is ONE-WAY (a write inside the pool
  never reaches the primary — sandbox writes go INTO the sandbox, nowhere else); §11 reaches THROUGH the
  glass (erase a fact in the primary and the byte is gone from the quarantine too, so a forgotten record can
  never hide in a staging area inside the operator's own walls — §24.8, the non-negotiable law); and DROP is
  consequence-free (discard the whole pool and the primary's coherence is untouched — its title still reads
  true). Then the T16 correction ([#120](https://github.com/bombadil-labs/loam/pull/120)): the fan-out
  RE-DERIVES ITS OWN REACH. The operator CLOSES the almanac's trust door — the exact posture where the old
  fan-out went silent — and nests a pool inside a pool (P → Q → R); one erase in the primary and the byte is
  gone from every tier of the tree, content-string-at-rest: trust policy is admission configuration, erasure
  is LAW, and depth is no shelter. Promotion (the door OUT), the resource envelope, the sequestered renderer
  frame, and the full ocap are §24's later slices.
- **AN `expand` NAMES THE CHILD'S READING (rhizomatic 0.8, issue #23)** (ticket T25): the village's
  `Circle` and `FilmNight` both `expand` a role into a child's view — a friend's Person view, a
  night's Film view. Before 0.8 that child was resolved through the PARENT's Schema, a coincidence
  that held only while their fields aligned; now the gather body names the child's own `reading`
  (`Person`, `Film`), so `gen-schemas.mjs` names every resolution Schema after its hyperschema and
  `expandThrough` emits the reading. The fresh-sweep certifies it end-to-end (circle and film-night
  green), and every store that held a pre-0.8 expand body is carried forward by the §20
  `expand-reading` migration. Host-level resolvers reaching those children is the next step (T26).
