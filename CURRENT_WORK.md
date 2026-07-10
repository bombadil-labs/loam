# Current work — the road to the Republic

_The live checklist. Done work is cleared (the JOURNAL holds the history); this file is what's
queued and in flight._

**Context (2026-07-10):** Myk has an investor call (fringe-tech, web3-adjacent) and wants a
knock-her-socks-off demo built OVER Loam — the village as a playable, federated society. The
night session red-teamed the paradigm and designed the arc; SPEC §11–§13 carry the actionable
versions. **Unit 2 is IN FLIGHT** (cycle stage 1→2: plan written, tests next); Units 1 and 3a
are merged.

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

## Unit 2 — The open door: public reads + browser client (SPEC §12) — IN FLIGHT

**Security surface — worth Myk's eyes before/while building:** anonymous reads and the
non-custodial `/append` door. Review in the neutral correctness register.

**Success criteria (the contract):**

1. An operator-signed declaration at `loam:public` (context `loam.public`) names registered
   schemas readable WITHOUT a token — query + subscribe only. Revocation is one negation,
   live on the next request. Ungoverned stores expose nothing publicly (no lawful voice).
2. Anonymous requests execute against a **restricted GraphQL schema** — only the public
   schemas' query + subscription fields, NO mutation type at all (an anonymous mutation must
   be a validation impossibility, not a policed string — `hooks.mutate` with no actor signs
   as the operator, so mutations must be structurally unreachable). Introspection over the
   restricted schema is a feature: it reveals only the public shapes.
3. No mount-name oracle: to an anonymous caller, a mount with nothing public answers exactly
   like a mount that does not exist (the same 401). A presented-but-wrong token is 401
   always — bad credentials never downgrade to anonymous.
4. Serve answers CORS: `access-control-allow-origin: *` on responses and an OPTIONS
   preflight (bearer tokens are explicit headers, never ambient — `*` leaks no authority).
5. `@bombadil/loam/client` subpath export, browser-safe: keygen in-page
   (`crypto.getRandomValues`), local signing (non-custodial — the seed never leaves the
   page), `/append` writes, GraphQL query + fetch-based SSE subscribe. The shipped artifact
   is a **prebundled ESM file** with zero `node:` specifiers, asserted by test.
6. The village dashboard reads through the public door — no token in the page.

**Spike results (2026-07-10, this session):** rhizomatic's root index re-exports `./http.js`
(→ `node:http`) and its exports map exposes only `"."`; rhizomatic lacks `sideEffects:false`,
so tree-shaking alone does NOT drop the import. GREEN path, verified end-to-end: esbuild
bundle with `node:http` aliased to a throwing stub → 0 `node:` refs, ~97KB ESM, executes.
(Substrate note for Myk: a browser-safe subpath export in rhizomatic would make the stub
unnecessary — PR-worthy someday, not needed now.)

**Sub-tasks:**

- [x] `src/gateway/public.ts` — `publicClaims` / `publicDefect` / `readPublicSchemas`
      (modeled on trust.ts: lawful reads, operator-only, union of surviving declarations);
      `publicDefect` wired into `authorize` so malformed declarations are refused at every door.
- [x] gql.ts — `buildGqlSchema` grows a read-only variant (query + subscription, no Mutation).
- [x] Gateway — `queryPublic` / `subscribePublic` over a cached restricted schema (rebuilt
      when the public set or the bound registrations move).
- [x] http.ts — anonymous path: resolve mount quietly, serve graphql/subscribe through the
      public surface or answer the uniform 401; CORS headers + OPTIONS preflight.
- [x] `src/client/index.ts` — `mintSeed`, `authorForSeed` re-export, `loamClient({ url,
      token?, seed? })` with `query` / `subscribe` (fetch-SSE) / `sign` / `append` / `claim`.
- [x] Build: `scripts/build-client.mjs` (esbuild, alias node:http→stub, platform browser);
      `npm run build` runs tsc then the client bundle; esbuild added as an explicit devDep.
- [x] package.json exports gains `"./client"`; pack.test.ts re-pinned.
- [x] Tests first, all of it: law (declare/revoke/malformed/ungoverned), restricted surface
      (public field answers; non-public field fails validation; mutation ops fail; introspection
      scoped), transport (anonymous 200 / uniform 401 / bad-token 401 / SSE / CORS), client
      (real server round-trip: keygen → grant standing → local sign → /append → public read
      → SSE), bundle (zero `node:` + executes). **Gate: 355/355** (was 320).
- [ ] Review (stage 5, one careful agent) → resolve → merge; JOURNAL entry.
- [ ] Village (step 7): almanac schemas declared public; dashboard drops its read token.

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
