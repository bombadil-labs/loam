# The Village — Loam's living demonstration

Four (and counting) federated Loam stores, a cast of villagers, and a browser dashboard —
a small society that exercises everything Loam claims, end to end, over real HTTP. It began
as an ephemeral field test; it graduated (Myk, 2026-07-09) into a **living demonstration
that grows with every PR**: the loop's stage 7 (see `../CLAUDE.md`) extends the village to
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
node _testing/phase0.mjs   # groundwork: homes, operators, registrations (all 3 surfaces)
node _testing/phase1.mjs   # …through phase8.mjs — each phase is a runnable act with checks
node _testing/village.mjs  # the living village: all stores + pulse + simulator + dashboard
                           #   → watch it at http://127.0.0.1:4400
```

`PLAN.md` is the original saga's tracking document (51/51 checks) plus field notes — the finds
there (resolution eliding the anchor pointer, `_hex` covering the whole view, the byAuthorRank
tie surprise) drove real Loam and rhizomatic changes.

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
