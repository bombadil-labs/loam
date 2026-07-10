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
  haste and **unsays it** — her own authority, her own words. The bytes are cleared from every tier
  (the vault's heal is tombstone-guarded on every path), the dossier reverts, the **signed
  hole** remains (who asked, when, which id — never what), and the door refuses the id's
  return even though the commons still holds the original and offers it back on every pulse
  — sovereignty both ways, watched live: `🕳️ …and UNSAYS it — the bytes are cleared from every tier,
  the signed hole remains, and the door will refuse its return`. The erase re-seats the
  almanac's reactor; the mill wheel is rehung after, like the crash.
