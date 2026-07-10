# Current work — the road to the Republic (queued 2026-07-10, from the night session)

_The live checklist for the work in progress; cleared when a unit merges._

**Context:** Myk has an investor call (fringe-tech, web3-adjacent) and wants a
knock-her-socks-off demo built OVER Loam. The night session red-teamed the paradigm and
designed the answers; SPEC §11–§13 now carry the actionable versions. Three units, in order —
each through the full loop (tests first, one review agent in a neutral register, village
stage, journal). **Unit 1 starts at stage 1 below.**

## Unit 1 — Erasure: degrees of forgetting (SPEC §11)

The strongest demo beat AND the hardest objection, answered in one unit: "watch an immutable
system forget — precisely, provably, with a signed hole."

Success criteria (from SPEC §11 — read it first):

- [ ] Tombstone claims at `loam:erasure` (`eraseClaims` helper + defect validation like
      trust's); authority = original author OR operator; lawful reads bind.
- [ ] `StoreBackend.purge(ids)` on the seam — a named exception to grow-only; implemented by
      memory, sqlite, archive (delete the fan file), mirror (both sides).
- [ ] `heal()` never resurrects a tombstoned id — the fire in reverse. Test this FIRST; it's
      where the bugs hide.
- [ ] Admission (federate + append) refuses tombstoned ids forever.
- [ ] `Gateway.erase(id)`: verify authority → manifest (blast radius: materializations touching
      the id, provenance citations) → purge all tiers → tombstone → re-materialize.
- [ ] Degrees: full erasure; anonymous reassertion (request-carries-replacement, timestamp
      inheritance, NO on-record link); sealed authorship (`hash(salt‖author)` pointer); partial
      redaction. The ladder is purge + tombstone + reassert — never in-place mutation.
- [ ] Federated: tombstones travel; a peer honoring the author's erasure authority purges on
      pull; compliance testable by asking for the id.
- [ ] Village: **the unsaying** — a villager erases a claim; the network honors it; the
      dossiers thin; the signed hole is visible in the event log.

## Unit 2 — The open door: public reads + browser client (SPEC §12)

- [ ] SPIKE FIRST: does rhizomatic's signing/hashing run in a browser? If not: rhizomatic
      issue + conversation with Myk before building around it.
- [ ] Public-read claims at `loam.public` (operator-signed, per-schema); query/subscribe
      tokenless on named schemas; writes stay gated; CORS on public mounts.
- [ ] `@bombadil/loam/client` subpath export: keygen, local signing, `/append` writes,
      query + SSE wrappers. Zero node-only deps.
- [ ] Village: the dashboard reads the almanac through the public door (no token in the page).

## Unit 3 — The Village, playable (decided 2026-07-10, ~2:30am: the village outgrew the
## dashboard)

**Myk's call:** the village renders as a 2D browser game — little characters moving around,
doing what the simulator already does; the user controls a villager and PARTICIPATES; Loam
holds all of it. The design decision that keeps it honest:

**MOVEMENT IS THEATER; ACTS ARE GROUND.** Characters walking is client-side animation — no
per-tick deltas, ever. Everything a character DOES is already a signed delta: Wren at the
commons garden IS her bio mutation; Miles at the barn IS a screening claim; Odile's grumble
visibly stays home (the offered lens as dramaturgy); arrival at a gathering is an attend
claim — presence-as-testimony at human frequency. There is no separate game state: **the game
is a lens over the ground** — the same deltas could back a terminal feed or a newspaper, and
saying so on camera IS the demo.

- **3a — the theater** (no library dependencies; buildable any time): a single-file,
  no-build, no-CDN canvas client replacing/joining dashboard.html. Map: commons garden, reel
  barn, hive, almanac hall (+ vault + mill wheel that turns when animate), cinelog hut beyond
  the palisade. Act broadcasts gain `{actor, place}` so sprites walk BEFORE the event lands;
  speech bubbles = event log lines; the fire renders as fire and the replanting as replanting;
  Mallory is a visible skulker whose forgeries bounce AT THE GATE (`accepted: 0` as theater).
  Click a villager → their dossier, three-lens duel and 🌾 presence included.
- **3b — the player** (needs Unit 2, the open door + browser client): mint a villager
  in-page (keys in localStorage, signed locally, written via `/append` — non-custodial). The
  WELCOME FLOW IS THE CONSTITUTION AS GAMEPLAY: knock at the palisade gate → petition delta →
  the operator grants standing → you may write. Walk to the commons and tend your bio; log a
  film at the reel; attend a gathering by arriving. The mill grinds your presence like anyone
  else's.
- **3c — multiplayer is federation** (the sock-knocker): two browsers, two villagers, no game
  server authority — claims federate, clients render the union. She takes the village home on
  her laptop WITH HERSELF STILL IN IT. Stretch: as-of reads scrub the village's history like
  a replay.

The demo script, now IN-GAME (15 min, no slides):

1. **The feed** — five sovereign stores, posts flowing, live dashboard.
2. **The troll** — Mallory forges + strikes; three lenses disagree on screen; the roster
   closes the door live (`accepted: 0`).
3. **The stranger** — cinelog's alien dialect rendered in with provenance visible.
4. **The fire** — burn the almanac's sqlite mid-sentence; the vault replants it.
5. **The unsaying** — erase a claim; the network honors it; the hole is signed (unit 1).
6. **The mill** — ✅ SHIPPED AHEAD (PR #32, phase11.mjs 4/4 twice): the almanac is the
   village's first ANIMATE store — the operator blesses `fn:grind`, THE MILLER attaches a
   Runner, and every dossier carries a live 🌾 presence line; the fire act rehangs the wheel.
   SPEC §6 records the reference deployment pattern. The line stands: "smart contracts
   without execution risk — the contract is a lens, and anyone can re-run it to the byte."
7. **Grow an app live** — mid-meeting, ask Claude to build a new store for whatever she
   names (schemas + renderer via MCP/skill); it federates in before the coffee refills.
8. **The kicker** — `npm i -g @bombadil/loam` on her laptop; one pull; the whole republic is
   hers, offline, through any lens she writes.

Pitch spine (rehearsed answers live in SPEC §13 + the journal): consensus was the wrong
abstraction — unforgeable evidence + conflict-free merge + truth as an auditable lens choice.
Every objection ("scale? disk? coordination? integrations?") has the same shape of answer: we
deleted the central thing, and the load went to the edges, where it's cheap. In the agentic
decade, the killer line: **writing grants no authority** — a million agents may write, and
nobody has to believe them.

## Left off here

**Unit 1 (erasure) IN PROGRESS — the seam slice first** (started 2026-07-10 ~3am). The unit
ships as two PRs: (1) the SEAM — `StoreBackend.purge(ids)` on all four drivers (mechanical,
law-free; re-append after purge is ALLOWED at the backend — refusal-of-return is gateway law),
`MirrorBackend.purge` (both sides), `heal(exclude?)` (skips excluded ids in both directions
AND purges excluded stragglers found on either side — heal finishes the forgetting); (2) the
LAW — tombstones at `loam:erasure`, `Gateway.erase` (authority → manifest → purge → tombstone
→ reactor rebuild), admission composes tombstones, degrees (anonymous reassertion / sealed
authorship / redaction), federation of erasure requests, the village's unsaying. SPEC §11 is
the contract; read it first. LAW-SLICE DESIGN (decided): src/gateway/erase.ts modeled on trust.ts — ERASE_ENTITY loam:erasure, CTX_ERASE loam.erasure; eraseClaims(targetId, targetAuthor, author, ts) carries role erases → delta-kind ref + role spoken-by → primitive (the TARGET author, recorded at erase time BECAUSE the target will be purged and unverifiable later); eraseDefect validates shape at the door AND, when the target is still present, that spoken-by matches the target real author and the tombstone author is operator-or-that-author (authority verified while evidence exists); readTombstones(reactor, operator) → Set<id>: operator tombstones bind + self-erasures (tombstone.author === its spoken-by, trusted because the door verified it at append). admitFor composes readTombstones. Gateway.erase(id): authority → manifest (deltas citing the id + materializations holding it) → backend.purge (mirror reaches vault) → append tombstone → rebuild reactor from backend. cli.ts serve passes readTombstones to heal(exclude). Degrees (anonymous reassertion w/ embedded replacement, sealed authorship, redaction) are thin helpers over erase+append. Tests: test/gateway/erase.test.ts; trust.test.ts is the fixture pattern.
 SEAM SLICE DONE (PR #34, 302/302): purge on all four drivers, heal(exclude) with straggler-finishing, archive purge hunts every fan. NEXT: the LAW slice — tombstones at loam:erasure (trust-style claims+defect validation), Gateway.erase (authority → manifest → purge → tombstone → reactor rebuild), admission composes tombstones, degrees, federation, the village unsaying. Law-slice PR gets the review agent (seam was self-reviewed: contract-tested mechanical extension).

After Unit 1: Unit 2 (open door + browser client), Unit 3 (playable village; 3a theater is
dependency-free). Hosted driver (libSQL) queued behind these.
