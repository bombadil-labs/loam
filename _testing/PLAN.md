# The Village — a full-ecosystem field test of Loam

_Ephemeral. This directory is a proving ground, not product: it is never committed, and it is
deleted when the saga ends. The plan below is the tracking document — check items off as they
pass, log surprises in the Field Notes at the bottom._

The claim under test: **a small society of independent, self-governed stores — each with its
own operator, its own schemas, its own people — can grow, overlap, evolve their shapes live,
and federate into a coherent whole, with nothing ever breaking and nothing ever forgotten.**
If Loam works the way we want, a write in one app surfaces in another app's live subscription
across a federation boundary, an evolved schema serves new readers while old streams keep
their promised shape, and the same deltas resolve to the same hash on every store that holds
them. It should _really work_.

---

## 1. The cast

Every person is a self-sovereign ed25519 identity (a seed their app holds). Every store has
its **own** operator seed — never shared; two stores sharing an operator trust each other's
constitution completely, and we test that they don't have to.

| identity   | who they are                                   | seeds writes on        |
| ---------- | ---------------------------------------------- | ---------------------- |
| **Wren**   | the gardener; keeps the village commons        | commons                |
| **Miles**  | the cinephile; logs every screening            | reel, commons          |
| **Odile**  | the beekeeper; keeps a frank apiary journal    | hive, commons          |
| **Petra**  | the newcomer; arrives mid-saga (phase 6)       | commons (late)         |
| **Mallory**| no standing anywhere; supplies the adversarial | nothing, ever          |

Shared vocabulary: person entities (`person:wren`, `person:miles`, `person:odile`,
`person:petra`) are minted on the commons and **referenced** by every other app — this is the
"limited eventual overlap." Films (`film:*`) live on the reel; gatherings (`gathering:*`) on
the hive.

## 2. The stores and their apps

Four stores, four sqlite homes under `_testing/homes/`, four HTTP mounts on localhost.

### 2.1 `commons` — the village social graph (port 4401)

- **Tenant** `tenant:village`; all four people granted `write` (Petra's grant lands in phase 6).
- **Schemas** (note: each store registers through a DIFFERENT surface, so all three paths get
  exercised):
  - `Person` — gather-by-target-context at a person root. Policy: `name`/`bio` pick-latest,
    `follows` all-asc. **Registered via `loam register` (CLI, offline, before serve).**
  - `Circle` — a person with their `friend`-role edges **expanded through `Person`** (the
    nested-hyperview recursion). **Registered via `POST /register` (HTTP, live, post-serve —
    the additive replay path).**
- **Writes**: profiles are self-authored (Wren writes Wren); follows are signed edges.

### 2.2 `reel` — Miles's screening log (port 4402)

- **Tenant** `tenant:reel`; Miles granted `write`.
- **Schemas** — **registered via `POST /register` (HTTP)**:
  - `Film` — `title`/`year`/`director`, pick-latest.
  - `Screening` — rooted at `screening:*`: `film` (entity pointer), `date`, `venue`, `rating`
    pick-latest, `note` pick-latest, `with` (entity pointers at person entities) all-asc.
    **This is the evolution target** (phase 4).
  - `Person` — same body JSON as the commons' Person, registered under reel's OWN operator
    (foreign registrations are inert by design — each store blesses its own law; the
    definition FILE is shared, the binding is local).
  - `FilmNight` — a screening with its `film` edge expanded through `Film` (nesting again,
    different domain).
- **Federation in**: reel pulls `commons` so its expanded companions resolve with real names —
  a person's profile, written on the commons, read inside Miles's app.

### 2.3 `hive` — Odile's apiary journal (port 4403)

- **Tenant** `tenant:apiary`; Odile granted `write`.
- **Schemas** — **registered via MCP `loam_register` (the third surface)**:
  - `Colony` — `queen`/`frames`/`yield` pick-latest, plus `grumbles` (Odile's frank private
    notes) all-asc.
  - `Gathering` — a harvest day: `date`, `honey` (jars), `attendee` entity pointers at person
    entities, all-asc.
- **Offered lens**: the hive PUBLISHES only what it means to — gatherings and colony yields
  cross the federation boundary; the `grumbles` context **stays home**. (The lens test.)

### 2.4 `almanac` — the village almanac, the confluence (port 4404)

- **Pulls** commons + reel + hive on a pulse cadence (`pulse.mjs`, an anti-entropy tick every
  ~2s while the saga runs). Never writes domain data of its own — it is a reader that serves.
- **Schemas**, its own operator's law over the MERGED ground:
  - `Dossier` — rooted at person entities; ONE gather that unions a person's whole village
    life: profile claims (commons), screening companionships (reel), gathering attendance
    (hive). The confluence schema.
  - `Presence` — the SAME body as `Dossier`, a minimal policy (just `name` + `_hex`). One
    hyperview shape, two schemas/policies over the same roots — "many lenses, one ground."
  - `TrustedDossier` — same body again, but `bio` resolved `byAuthorRank` ranking the villagers
    above all others. **The trust-lens test**: Mallory's federated forgery of Wren's bio is
    NEWER (wins under pick-latest in `Dossier`) but LOSES under `TrustedDossier` — same
    deltas, two policies, two truths, the reader chooses. Trust is a lens, not a verdict.
- **Serves** GraphQL + SSE: the "complex state reflecting updates from everything." The saga's
  centerpiece subscriber watches `dossier(entity: "person:wren")` here.

### 2.5 The overlap map (what flows where)

```
                    ┌──────────┐  person refs   ┌──────────┐
                    │ commons  │◄───────────────│   reel   │
                    │ (people, │    (reads       │ (films,  │
                    │ follows) │     names)      │screenings)│
                    └────┬─────┘                 └────┬─────┘
                         │ pull                       │ pull
                         ▼                            ▼
                    ┌─────────────────────────────────────┐
                    │              almanac                │
                    │  Dossier / Presence / TrustedDossier│
                    │  (SSE subscribers live here)        │
                    └─────────────────────────────────────┘
                         ▲ pull (lensed: no grumbles)
                    ┌────┴─────┐
                    │   hive   │ (colonies, gatherings, person refs)
                    └──────────┘
```

A screening logged on the reel with Wren in the `with` list → pulse → almanac → the Wren
dossier stream patches. A gathering on the hive with Petra → pulse → the Petra dossier
patches. Nobody told the almanac about either app's internals; the person entities are the
only shared vocabulary. Stigmergy.

---

## 3. The phases

Isolated basics first; the full living ecosystem last. **Every check is falsifiable** — a
check passes on observed output, never on "no error." Track with the boxes; a failed check
gets a Field Note and either a fix (if ours) or a filed issue (if Loam's).

### Phase 0 — Groundwork

- [x] 0.1 `npm run build` green; `_testing/` scaffolding in place (harness, schema files)
- [x] 0.2 Four homes minted (`loam init`), four DISTINCT operators confirmed (no two alike)
- [x] 0.3 `Person` registered on commons via **CLI** before serve; `loam store` shows exactly
      marker + definition + reference (3 deltas)
- [x] 0.4 All four stores serve; junk token 401 on every mount; operator introspection works
- [x] 0.5 Reel/hive/almanac schemas registered via **HTTP** and **MCP** respectively; each
      answers queries on its new types immediately (no restart)

### Phase 1 — Isolated read/write, per store

- [x] 1.1 Commons: tenancies + grants land; Wren self-authors her profile over HTTP as her
      token; read-back exact (name, bio, `_hex` present)
- [x] 1.2 Commons: Miles and Odile author profiles; `follows` edges land; `Circle` expands a
      person's friends WITH their profile data (nested hyperview over live data)
- [x] 1.3 Reel: Miles registers films and logs a solo screening; read-back exact; `FilmNight`
      nests the film inside the screening
- [x] 1.4 Reel: a screening `with` Wren + Odile (person refs into another store's vocabulary —
      locally just pointers; names resolve after phase 5's pull)
- [x] 1.5 Hive: Odile logs colony status including a frank `grumble`, and a gathering with
      attendees; read-back exact
- [x] 1.6 AuthZ negatives, each store: Mallory's token (where minted) refused with the
      no-surviving-grant refusal; actor tokens cannot write outside their tenant; non-operator
      cannot POST /register (403); operator-only /federate (403 for actors)
- [x] 1.7 Determinism: the same query twice → identical `_hex`; a write → new `_hex`

### Phase 2 — Live views (single store)

- [x] 2.1 SSE on commons: subscribe to Wren's Person; snapshot frame carries current state,
      `_fromHex null`
- [x] 2.2 A bio update patches the stream: `_fromHex` = prior `_hex`, `_changed` = ["bio"],
      exactly one frame per change
- [x] 2.3 Two concurrent subscribers (Wren's Person + Miles's Person) each see only their
      entity's changes
- [x] 2.4 A no-op write (same value re-claimed → same resolved view) produces NO frame
      (silence, not a no-op patch) — verified with a genuinely view-identical re-claim
- [x] 2.5 Reel SSE: subscribe to a screening; a rating revision patches with the hex chain

### Phase 3 — Many schemas, one ground

- [x] 3.1 Almanac (local test entity `person:zephyr`, lazy-materialization path): `Dossier`
      and `Presence` (same body, different policies) both answer at the same root; `Presence`'s
      GraphQL surface is the strict subset
- [x] 3.2 One write moves BOTH views: after a single new delta, both `_hex`es change, and the
      two views stay mutually consistent (Presence.name === Dossier.name)
- [x] 3.3 Commons: `Person` and `Circle` over the same person — one follows-edge write patches
      both a Person subscriber (follows list) and a Circle subscriber (expanded friend)
- [x] 3.4 Two subscribers on the SAME entity through DIFFERENT schemas receive their own
      correctly-shaped frames from one underlying delta

### Phase 4 — The schema lifecycle (create → use → evolve → both at once)

The heart of the cutover. On the reel, live, while a subscriber watches:

- [x] 4.1 Pin: record Wren-companioned screening's `_hex` under Screening v1, AND copy the
      reel's sqlite file aside (`reel-at-T.sqlite`) — a snapshot of the ground itself
- [x] 4.2 Open an SSE stream on a screening under v1 (fields incl. `note`)
- [x] 4.3 **Evolve**: republish `Screening` at the SAME entity — v2 body drops the `note`
      context from the gather and the policy adds `rewatch`; via POST /register on the
      running server → 200, no restart
- [x] 4.4 New readers see v2: `note` unanswerable, `rewatch` queryable; old data still
      resolves (what v2 gathers, v2 answers from ALL history)
- [x] 4.5 The pre-evolution stream from 4.2 KEEPS its v1 shape: a new write patches it and
      the frame still carries `note` (captured policy + captured materialization)
- [x] 4.6 **Both at once**: `ScreeningClassic` (v1's law at its own entity) and `Screening`
      (v2) serve CONCURRENTLY over the same deltas, each correctly
- [x] 4.7 **Nothing ever breaks**: the phase-start sqlite copy under v1 law reproduced the
      recorded `_hex` byte-identically
- [x] 4.8 **Deprecation**: negated definition → type gone on rebuild; deltas all remain
      (GraphQL even asks "Did you mean screening?")
- [x] 4.9 **Revival**: negate the negation; the type returns, data intact
- [x] 4.10 Identical republish of Screening v2 → no rebind (generation stable via
      `materializationFor` probe)

### Phase 5 — Federation, pairwise

- [x] 5.1 Almanac pulls commons: 26 accepted; re-pull accepts 0 (idempotent); person
      profiles resolve on the almanac under ITS schemas
- [x] 5.2 Foreign law inert: commons' registration deltas SIT in the almanac's store (delta
      accounting proves they crossed) yet bind nothing — no Circle type on the almanac
- [x] 5.3 Reel pulls commons: person profiles resolve inside reel's own `Person` view
- [x] 5.4 Hive → almanac WITH the offered lens: gatherings and yields cross (holds 21, offers
      20); the grumble is nowhere on the almanac; Wren's dossier shows harvest-1 attendance
- [x] 5.5 Convergence: `person:odile` (whose deltas fully crossed) resolves to an IDENTICAL
      `_hex` on reel and almanac under identical law — same deltas, any machine
- [x] 5.6 Verification at the boundary: a forged id and an unsigned delta rejected; the honest
      neighbor in the same batch lands

### Phase 6 — The living ecosystem

All four stores up, the pulse running, subscribers parked on the almanac. The saga:

- [x] 6.1 A subscriber watches `dossier(entity: "person:wren")` on the ALMANAC over SSE
- [x] 6.2 Miles logs a screening on the REEL `with` Wren → within one pulse the almanac
      subscriber receives a patch, `_changed = ["companioned"]`. **The headline check passed:
      a write in one app, a live patch in another, across federation**
- [x] 6.3 Wren updates her bio on the COMMONS → the same stream patches again (two apps, one
      dossier)
- [x] 6.4 **Petra arrives**: live grant on commons; profile (commons) + harvest-2 attendance
      (hive) compose in one fresh dossier stream
- [x] 6.5 Schema evolution DURING federation: reel's definitions crossed as data; the
      almanac's own surface never rebinds (generation stable, no `screening` type)
- [x] 6.6 Mallory's NEWER forged bio: union admits it; `Dossier` (pick-latest) shows the
      raccoon; `TrustedDossier` (byAuthorRank) keeps Wren's word. Same ground, reader's lens
- [x] 6.7 The four-store audit: commons(30) ⊆ almanac(136), reel(99) ⊆ almanac, hive-offered
      (23) ⊆ almanac; odile's `_hex` converges reel↔almanac post-saga
- [x] 6.8 Cold almanac restart: schemas replay from deltas, same dossier `_hex`, streams
      reopen

### Phase 7 — The adversarial sweep (ecosystem standing)

- [x] 7.1 Mallory's self-signed admin grant federates into every store: admitted as data,
      governs nowhere (her writes still refused on all four)
- [x] 7.2 Mallory federates a schema DEFINITION at the almanac's own `schema:Dossier` entity
      (newer timestamp): the almanac's surface is unmoved, now and across a restart
- [x] 7.3 Foreign negation: Mallory negates the commons' Person definition delta (federated
      in): binds nothing; the commons still serves Person after a full replay
- [x] 7.4 A poisoned registration (canonical but unmaterializable body) is refused at POST
      /register with a plain reason and NOTHING persists (delta count unchanged)
- [x] 7.5 Final reconciliation: subsets hold; every store still answers its whole prior life;
      the record: commons 32, reel 100, hive 25 (24 offered), almanac 139

### Phase 8 — the 0.2.0 lenses (PR #17; the village is a LIVING demonstration now — see README.md)

- [x] 8.1 The almanac evolves live to the new law: TrustedDossier republished with
      `chain[byAuthorRank, byTimestamp]`; GuardedDossier (governedGatherBody + chain) registered
      at runtime with the almanac's own operator in its trust mask
- [x] 8.2 The founding field-note bug, fixed where it was found: TrustedDossier now shows the
      trusted author's LATEST word against a newer forgery
- [x] 8.3 The heckler's veto ends at the governed lens: Mallory STRIKES Wren's bio delta by
      federation — the plain Dossier forgets; GuardedDossier holds the words (and out-ranks the
      forgery: mask and order guard DIFFERENT attacks — erasure vs fabrication)
- [x] The living village gains the strike act (forge → strike → Wren speaks again) and the
      dashboard's third trust line ("and the guarded record holds: …"); the cast's standing is
      self-constituted at boot (homes rebuilt under the authors-not-owners law)

### Phase 9 — THE GAUNTLET (PR #19; the arc closes)

- [x] 9.1 A FIFTH store: cinelog (:4405), Sasha's app, an alien dialect (film_watched /
      viewer / on), its own operator, no village vocabulary anywhere
- [x] 9.2 The OPEN almanac pulls the stranger whole; the translation spec is published as one
      operator-signed delta; the local lens cannot yet see the foreign shape
- [x] 9.3 One translate() pass: Wren's dossier gains a screening RECORDED BY A STRANGER'S APP —
      the resolved view itself carries the provenance (origin: cinelog, translates: <source>)
- [x] 9.4 The roster flips mid-run (pulse refuses the stranger, accepted 0); flips back
      (backlog crosses); translation resumes. 4/4
- [x] The living village gains cinelog + Sasha's acts; every pulse ends with a translation
      pass, narrated in the event log

### Teardown

- [ ] T.1 Kill all servers; delete `_testing/` (this file's last act is its own deletion)
- [ ] T.2 Anything Loam-worthy learned → summarized to Myk (JOURNAL/SPEC/issue as he directs)

---

## 4. Mechanics

- **Layout**: `_testing/PLAN.md` (this file) · `harness.mjs` (spin/serve/gql/sse/mcp/pull
  helpers + `check()` tally) · `schemas/*.json` (register files) · `phase0.mjs` … `phase7.mjs`
  (one runnable act per phase, each idempotent-ish and resumable) · `pulse.mjs` (the
  federation tick) · `homes/` (the four sqlite homes; disposable).
- **Ports** 4401–4404, bound 127.0.0.1. Tokens per store: one operator token + one token per
  resident actor (the custody model: the server signs for its people).
- **Single-writer rule**: CLI registration happens before a store's serve; live registrations
  go over HTTP/MCP only.
- **Progress**: run a phase → check its boxes here → append a Field Note for anything
  surprising (even if it passed). The boxes are the state; any session can resume from them.
- **Nothing in `_testing/` is ever committed.** The repo's only record of this saga is
  whatever learning graduates to JOURNAL/SPEC/issues via Myk.

## 5. Field notes

_(append-only, dated, newest last)_

- 2026-07-09 — Plan written. Nothing run yet. Prior art: the v1 field test (21/21) covered
  single-store basics, MCP, two-store federation, persistence; this saga's new ground is the
  multi-app overlap, live evolution under subscribers, lensed federation, the trust lens, and
  the four-store confluence.
- 2026-07-09 — **Saga complete: 51/51 checks across all eight phases.** Every headline
  property held. Teardown deferred pending Myk's review. Notes of substance:
  1. **`_hex` covers the whole resolved view, not the GraphQL projection.** `Presence` and
     `Dossier` (same body, same `default`) produce IDENTICAL `_hex` — the default policy
     resolves unnamed buckets into the view even when no field exposes them. Correct, but
     surprising: two "different" lenses hash alike unless their policies actually resolve
     differently. Doc-worthy nuance.
  2. **`byAuthorRank` cannot say "trusted, then latest."** Among same-rank entries the
     implicit `lexById` tiebreak picks — NOT recency: TrustedDossier returned an OLDER Wren
     bio ("forager of chanterelles"), not her latest. rhizomatic's `Order` only composes
     through `byPred.then`; `byAuthorRank` has no `then`. A "rank, then byTimestamp" order is
     inexpressible today. **Substrate observation for Myk** (rhizomatic is frozen; this is a
     candidate for the PR-and-conversation path).
  3. **Duplicate edges are honest union.** A re-run of phase 4 appended the same
     companionship twice (fresh timestamps → distinct deltas) → `all`-policy lists show it
     twice. Apps wanting idempotent edges should fix timestamps (content-address dedup); a
     `distinct`-flavored reduction doesn't exist. Pattern worth a README note someday.
  4. **GraphQL mutations are primitives-only; RELATIONS need hand-signed deltas.** Every edge
     (follows, companioned, attended, film-of) had to be appended through the library. The
     http.ts custody comment already envisions a raw-append endpoint; this saga is the
     concrete case for it (or for entity-ref mutation args).
  5. **Cross-vocabulary references require local re-tenanting.** On the reel, Miles's
     companion deltas touch `person:*` entities, so the reel's operator had to member them
     into `tenant:reel` first. Correct by design (each operator decides what its residents
     may annotate) — but it's a non-obvious integration step that deserves documentation.
  6. **`Gateway.boot` has no options passthrough** — a store with an `offeredLens` must use
     the `open` + append-genesis dance. Small API gap.
  7. Harness-only: undici's keep-alive pool hands back dead sockets when a store restarts on
     the same port — `connection: close` + retry for short requests.
  8. The GraphQL error for a retired schema is accidentally perfect: `Cannot query field
     "screeningClassic" … Did you mean "screening"?` — the surface itself suggests the
     migration.

## Phase 10 — the fire (PR #22: cold storage) — ✅ 4/4

The almanac keeps a seed vault: `MirrorBackend(SqliteBackend, ArchiveBackend)` in the harness,
healed before every open. Checks: (10.1) the vault holds a cold copy of every delta the store
holds — counted file-for-delta; (10.2) after burning the sqlite (+wal/shm), the reopen replants
every delta from the vault BEFORE the gateway reads; (10.3) Wren's dossier answers the same bio
word-for-word across the fire; (10.4) a post-fire write lands hot and cold in the same append.
Field note: restore restored Mallory's old forgery too — the vault is a store of record, not a
lens; judgment stays read-side, even through disaster.

## Phase 11 — the mill (the first animate store) — ✅ 4/4, twice

`MirrorBackend` taught the vault; the mill teaches the wheel. Checks (re-runnable against a
lived-in home — every assertion is about CHANGE, never absolute counts): (11.1) passive — the
blessed recipe sits in the ground and new grist grinds nothing; (11.2) animate — one attach
call and the same kind of ingest produces flour; (11.3) recompute supersedes per villager;
(11.4) flour is ground — emissions persist through a passive reopen. Field notes of substance:
pure emissions carry timestamp 0 (output = f(fn, input hash) only), so supersession ties across
processes — a fresh attach sweeps its own stale flour with idempotent ts-0 negations; wholesale
`supersede` negates across ALL roots (keyed emission is the per-subject mode); the budget is a
lifetime trigger count; and `readBindingDefinitions` now resolves latest-per-binding, found
when a re-blessed recipe crashed attach.
