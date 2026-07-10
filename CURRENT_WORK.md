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

## Unit 3 — The Reader's Republic (the demo)

The village dressed as what it is: a federated social network. Script (15 min, no slides):

1. **The feed** — five sovereign stores, posts flowing, live dashboard.
2. **The troll** — Mallory forges + strikes; three lenses disagree on screen; the roster
   closes the door live (`accepted: 0`).
3. **The stranger** — cinelog's alien dialect rendered in with provenance visible.
4. **The fire** — burn the almanac's sqlite mid-sentence; the vault replants it.
5. **The unsaying** — erase a claim; the network honors it; the hole is signed (unit 1).
6. **The mill** — the village's first ANIMATE store: a Runner attaches (the machinery shipped
   in v1 — `Runner`/`bindingDefinitionClaims`; the village has never exercised it), and an
   operator-blessed `DerivedFn` grinds the almanac's ground into flour — a living village
   digest emitted as derived deltas, signed, cited, recomputed on every pulse. Passive store,
   then the runner attaches, and the law wakes up on camera. The line: "smart contracts
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

Nothing started. Fresh session: read SPEC §11–§13, then open Unit 1 at loop stage 1 (plan →
tests first). The hosted driver (libSQL) stays queued behind these three.
