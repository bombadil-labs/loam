# Current work — the road to the Republic

_The live checklist. Done work is cleared (the JOURNAL holds the history); this file is what's
queued and in flight._

**Context (2026-07-10):** Myk has an investor call (fringe-tech, web3-adjacent) and wants a
knock-her-socks-off demo built OVER Loam — the village as a playable, federated society. The
night session red-teamed the paradigm and designed the arc; SPEC §11–§13 carry the actionable
versions. **Units 1, 2, and 3a are merged.** Unit 3b (the player) is next and unblocked —
everything it needs (the public door, the browser client, the non-custodial `/append`) shipped
with Unit 2.

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
- **Unit 2 — The open door (SPEC §12, PR #43).** Public reads as data: an operator-signed
  declaration at `loam:public` opens named registered schemas to tokenless query + subscribe;
  anonymous execution runs against a restricted GraphQL schema with NO Mutation type (writes
  are a validation impossibility); refusals are uniform (closed = absent, in body and cost —
  the open set is cached, dropped once per write); CORS everywhere; per-door budgets
  (`maxPublicWatches` / `maxPublicStreams`) so a stranger can never consume the authenticated
  surface's capacity. `@bombadil/loam/client` ships as one self-contained browser bundle
  (rhizomatic's `node:http` edge aliased to a stub — zero `node:` specifiers, pinned by test):
  keygen in-page, local signing, non-custodial `/append`, fetch-SSE. 361/361; phase13 6/6;
  the dashboard reads the almanac directly, tokenless, and survives the crash act on
  EventSource's own reconnect.

## Unit 3b — The player — DONE (pending PR merge)

The welcome flow is the constitution as gameplay, live: name → key minted in-page
(localStorage; it never travels) → signed petition delta knocks at the viewer's `/petition`
gate → the operator grants standing, lands the petition, **evolves the Dossier roll** (a
newcomer must become a registered root for the mill to grind them — the found learning) and
rehangs the wheel. The page's gate token is TRANSPORT only (phase14.1: before the grant, the
same claim is refused at `/append`). Acts: tend bio / attend the gathering / join the
screening — each one signed delta through the non-custodial door, visible tokenless.
phase14 5/5; verified live (Isolde joined, wrote, attended; the crash replanted her whole
life mid-session and her next write landed clean). No library changes — Unit 2's surface was
sufficient, which was the point.

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
8. **Write yourself in** — she mints a villager and walks into the world. _(3b ✓ — the
   "write yourself in" panel: knock, grant, roll, flour)_
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
- **Village hygiene:** homes were reset and re-baselined with Unit 2's village PR (phase0 6/6
  fresh). Act pacing remains the known cost (the mill re-grinds a growing ground per ingest;
  the presence value drags its derivation provenance through every query — visible on the
  public door too) — SPEC §13 vertical-scale honesty in miniature; a lighter pulse query or an
  index tier someday.
- **Substrate note for Myk:** rhizomatic's root export pulls its `node:http` peer transport and
  lacks `sideEffects: false` / a browser-safe subpath — the client bundle works around it with
  an aliased stub. A `@bombadil/rhizomatic/core` subpath would retire the workaround; PR-worthy
  someday, not urgent.
- **Queued behind the units:** a hosted `StoreBackend` driver (libSQL/Turso) — the seam supports
  it; buildable when a deploy needs it.
