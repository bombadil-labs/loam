# Current work — the road to the Republic

_The live checklist. Done work is cleared (the JOURNAL holds the history); this file is what's
queued and in flight._

**Context (2026-07-10):** Myk has an investor call (fringe-tech, web3-adjacent) and wants a
knock-her-socks-off demo built OVER Loam — the village as a playable, federated society. The
night session red-teamed the paradigm and designed the arc; SPEC §11–§13 carry the actionable
versions. **Nothing is in flight right now** — Units 1 and 3a are merged; Unit 2 is next and
unblocked.

## Done & merged

- **Unit 1 — Erasure (SPEC §11).** Operator-only: only the instance operator may order a record
  removed (destructive → maximally gated at both doors). Tombstones at `loam:erasure`, the
  `purge` seam primitive, `Gateway.erase` (manifest → purge every tier → tombstone → re-seat),
  the door refuses erased ids, forgiveness = striking the tombstone, degrees compose from
  erase + append, heal is tombstone-guarded. 320/320; the village's **unsaying** demonstrates it.
- **Unit 3a — The playable village (the theater).** `_testing/dashboard.html` is a 2D canvas
  game driven by the live SSE stream: buildings, walking sprites, speech bubbles, the federation
  pulse, the turning mill wheel, the crash shake, the gate-refusal flash, click-to-dossier with
  the three-lens duel + presence. Movement is theater; the acts are ground.

## Unit 2 — The open door: public reads + browser client (SPEC §12) — NEXT

Browser-crypto spike is **GREEN** (rhizomatic's signing/hashing are pure `@noble` JS,
browser-safe, no substrate change needed — import the primitives, not `Peer`). **Security
surface — worth Myk's eyes before/while building:** anonymous reads and the non-custodial
`/append` door.

- [ ] Public-read policy as data at `loam.public` (operator-signed, per-schema): query +
      subscribe tokenless on named schemas; every write path stays gated; revocable by one
      negation, live next request. Serve adds CORS for public mounts.
- [ ] `@bombadil/loam/client` subpath export: keygen in-page, local signing, `/append` writes,
      GraphQL query + SSE wrappers. Zero node-only deps (bundle without `node:http`).
- [ ] Village: the dashboard reads the almanac through the public door (no token in the page).

## Unit 3b — The player (needs Unit 2)

Mint a villager in-page (keys in localStorage, signed locally, written via `/append`). **The
welcome flow is the constitution as gameplay:** knock at the palisade gate → petition delta →
the operator grants standing → you may write. Walk to the commons and tend your bio; log a film;
attend a gathering by arriving. The mill grinds your presence like anyone else's.

## Unit 3c — Multiplayer is federation (the sock-knocker)

Two browsers, two villagers, no game-server authority — claims federate, clients render the
union. She takes the village home on her laptop with herself still in it. Stretch: as-of reads
scrub the village's history like a replay.

## The demo script (in-game; 15 min, no slides)

1. **The feed** — five sovereign stores, the village alive. _(3a ✓)_
2. **The troll** — Mallory forges + strikes; three lenses disagree; the roster shuts the door
   live (`accepted: 0`). _(3a ✓)_
3. **The stranger** — cinelog's alien dialect rendered in with provenance visible. _(3a ✓)_
4. **The crash** — the almanac's disk fails mid-story; the seed vault replants it. _(3a ✓)_
5. **The unsaying** — the operator honors an erasure request; the network's door refuses the
   id's return; the hole is signed. _(Unit 1 ✓)_
6. **The mill** — the almanac is animate; a blessed function grinds the ground into flour. "Smart
   contracts without execution risk — the contract is a lens, re-runnable to the byte." _(✓)_
7. **Grow an app live** — mid-meeting, ask Claude to build a new store for whatever she names
   (schemas + renderer); it federates in before the coffee refills. _(needs a quick MCP/skill path)_
8. **Write yourself in** — she mints a villager and walks into the world. _(needs 3b)_
9. **The kicker** — `npm i -g @bombadil/loam` on her laptop; one pull; the whole republic is
   hers, offline, through any lens she writes. _(✓ — it's published)_

## Pitch spine (rehearsed answers in SPEC §13 + the journal)

Consensus was the wrong abstraction — unforgeable evidence + conflict-free merge + truth as an
auditable lens choice. Every objection ("scale? disk? coordination? integrations?") has the same
shape of answer: we deleted the central thing, and the load went to the edges, where it's cheap.
The agentic-decade killer line: **writing grants no authority** — a million agents may write, and
nobody has to believe them.

## Standing notes

- **Classifier constraint (real, operational):** the erasure/deletion domain and the adversarial
  demo vocabulary reliably trip Fable's safety classifier — it's the subject, not the words.
  Safety-sensitive units (erasure; likely Unit 2's public-read/auth surface) are best done on
  Opus, or in a session where that friction is understood.
- **Village hygiene:** `_testing/homes/` is disposable and bloated from many runs (phase 7's
  whole-run reconciliation drifts against it — reset the homes to re-baseline). Act pacing has
  slowed (~25s/act: the mill re-grinds a growing ground per ingest; the pulse presence query
  hauls the evidence hex) — SPEC §13 vertical-scale honesty in miniature; a lighter pulse query
  or an index tier someday.
- **Queued behind the units:** a hosted `StoreBackend` driver (libSQL/Turso) — the seam supports
  it; buildable when a deploy needs it.
