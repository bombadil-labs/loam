# Current work — Sprint A (surfaces, SPEC §17) then Tutorial v2

_Plan LOCKED with Myk 2026-07-11 ("yeah this tracks"), amended twice from his review:
(1) **Sprint A ships first** — SPEC §17 "surfaces are materializations" (drafted; Myk to
read), the SurfaceGenerator seam, and the REST/OpenAPI door as the proving second surface;
(2) **lesson 6 corrected** — a subscription is executed against the schema generation that
opened it and can never grow fields its document didn't select; the honest beat is that the
OLD subscription keeps streaming Alice-less (a pinned lens choice) while a NEW query against
the regenerated schema shows her. The MVP's lesson-6 copy overclaims this; v2b fixes it and
the arc test pins the real semantics._

## Sprint A — surfaces are materializations (SPEC §17; ships before tutorial v2)

- [ ] **Myk reads SPEC §17** (drafted on branch `surfaces`) — the code waits on his read.
- [ ] **The seam**: extract the `Registered`-set consumption behind a SurfaceGenerator seam;
      `buildGqlSchema` becomes the first implementation. Contract: GraphQL behavior
      byte-identical before/after (existing suites are the witness).
- [ ] **REST/OpenAPI**: `buildOpenApi(registered)` → OpenAPI 3.1 served at
      `/:mount/openapi.json`; dynamic router `GET /:mount/rest/v<N>/<schema>/<entity>` (the same
      view — `_hex` for `_hex` with GraphQL, contract-tested), `POST` through the same door
      discipline. REVIEW FOCUS: the doors must not disagree — tokens, public declarations,
      capability refusals, tombstones, all shared. Spec regenerates on evolution.
- [ ] Tests first → green → PR → review (auth-parity is the riskiest angle this repo has
      shipped since capabilities — one careful agent minimum) → merge → village act (the
      almanac answers REST beside GraphQL; dashboard or a phase19 hits both doors and
      compares `_hex`) → journal → re-plan.
- [ ] **Versioning law (§17 amendment, Myk 2026-07-11)**: the REST door is BORN versioned —
      `vN` aliases derived from surviving registrations in ground order, the registration
      hash as the canonical version name; withdrawing a version = the operator strikes its
      registration delta (existing grammar; test it). Version-pinned GraphQL access: QUEUED
      follow-up, not Sprint A scope. Lesson 6 note: version-pinned queries may replace the
      FilmClassic sibling-name trick in v2b — decide when the door exists.
- [ ] Typed-client generation (`loam types`): designed in §17, NOT queued — do not build.

# Tutorial v2 (follows Sprint A; the MVP grows up — design codified as SPEC §19)

_The shipped tutorial (PRs #54–#56) is the MVP; v2 redesigns pedagogy and instruments per
Myk's walkthrough feedback (2026-07-11). Sprint A upgrades two beats: lesson 2's payoff
becomes "TWO doors materialize from your one registration" (show the OpenAPI JSON beside the
GraphQL hints), and lesson 15's smaller-world beat applies to both doors. Design principles:_

- **Needs before doctrine.** Lessons follow the order a person's needs arise ("track my
  films"), not the order the SPEC states its theses. The doctrine beats (data-first,
  lens-not-mold) become EARNED REVEALS mid-arc, not cold opens.
- **Instruments, not exhibits.** The right-hand panes must let the learner explore whatever
  the current lesson just added, and reward going off-script. Every lesson ends with
  something new to poke.
- **Explicit write-paths.** Never leave ambiguous whether an act went through the GraphQL
  door (mutation → compiled to a claim) or the pen (a raw signed claim) or the wire
  (federated). Each act is labeled with its path.
- **Total feature coverage.** By the finale the learner has touched every meaningful feature
  Loam ships (matrix below).

## The instruments (v2a — built first, against the MVP arc, shippable alone)

1. **Ground pane v2** — newest FIRST. A real delta renderer: one-line summary per delta with
   a kind badge — `constitution` (the operator marker, annotated with what it does),
   `schema` / `registration`, `fact`, `negation`, `tombstone`, `public-declaration`,
   `trust`, `grant`, `foreign` (author ≠ you), `derived` (runner-signed) — expand on click to
   the full wire JSON (textContent, properly formatted), author + timestamp + id visible by
   default, hover shows the full id. New arrivals highlight briefly.
2. **GraphQL pane v2** — CodeMirror 6 + `cm6-graphql`: autocomplete, inline docs, and lint
   driven by the LIVE schema (standard introspection query against the in-page gateway →
   `buildClientSchema`), re-fetched after every registration/evolution and on the
   ask-as-stranger toggle (the anonymous schema is a different, smaller schema — show that).
   Pre-registration the pane says the store has no surface yet and which lesson grows one.
   A **"save to Views"** button pins the current query.
3. **View pane v2** — a query-fed browser, no hardcoded cards:
   - **Schemas** (the seeded meta-view, present from lesson 1): the store's registrations
     read as data — name, generation count, policy summary, roots. Registering Film makes
     Film APPEAR IN A VIEW, teaching schemas-are-data before the words are said.
   - Selecting a schema lists its roots; selecting a root shows the live resolved view
     (a subscription — the pane says so).
   - **Saved queries**: lessons contribute theirs as they go; the learner pins their own
     from the GraphQL pane. Progress-adjacent but stored in localStorage UI-side (queries
     are NOT store facts; don't pollute the ground).
4. **Write-path chips** — every lesson action and every Ground row shows its path:
   🚪 door (GraphQL mutation) / ✍️ pen (raw signed claim) / 📡 wire (federated) / ⚙️ derived.

## The arc (v2b/v2c) — five acts, sixteen lessons

**Act I — a store of your own**
1. *You are the operator.* Genesis; seed custody; the Ground shows the constitution and the
   renderer explains the operator delta. [features: genesis, operator, custody]
2. *Track your films.* Motivate → define the Film schema (title pick, rating pick, tags all)
   → register → the GraphQL pane LIGHTS UP (hinting proves it) and Schemas-view gains Film.
   [schemas/policies as data; surface generated from the store; pick/all]
3. *Write through the door.* Mutations: set title/rating, add tags. Watch one act appear
   three ways: View updates (live), Ground grows a delta (badge: door), and the copy says
   plainly — the mutation COMPILED to a signed claim; the claim is what's real.
   [mutations; write-path explicitness; subscription liveness]
4. *Screenings are entities too.* Register Screening (date pick, film ref) and evolve Film
   with `screenings` (expand) — two schemas referencing each other; the film's view now
   nests its screenings. Log one through the door. [expand; multi-schema; refs]

**Act II — the ground truth**
5. *The secret: it was claims all along.* Write the NEXT screening with the pen — one raw
   multi-pointer claim that also names a guest, `person:alice`, a role no schema knows.
   The old lens shows the screening **but leaves Alice out** — a lens drops what it doesn't
   gather. Inspector: flip one byte, the id shatters. [raw claims; multi-pointer;
   content-addressing; lens-drops-unknown]
6. *Evolve the lens, keep every past.* Add `guests` → re-register → a NEW query shows Alice;
   the OLD subscription keeps streaming Alice-less (a pinned lens choice — see header
   amendment). Then re-register the pre-guests
   policy as `FilmClassic`: two lenses, one ground, both live — nothing was mutated, ever;
   snapshots feed forward. [evolution-as-append; concurrent generations; nothing-destroyed]
7. *Taking it back, and what silence means.* Retract a rating (negation → absence); Book's
   `pagesRead` (merge sum) and `finished` (absentAs false) — three flavors of silence; try
   to SET an aggregate: the count ticks +1 (upgrade to refusal when SPEC §14 lands).
   [negation/retraction; absence; merge sum/count; absentAs; aggregates-not-settable]

**Act III — other people**
8. *A co-author.* Mint the roommate's seed in-page; their screening is REFUSED (no
   standing); you grant write standing — one signed claim; their screening lands under
   THEIR signature; then revoke and watch the door close again. [grants; revocation;
   authors-not-owners; multi-author ground]
9. *The adversary, and whose word wins.* The forged title arrives (wire badge); pick-latest
   falls; a trust `chain` (your word first) defends; and a `FilmDispute` lens with a
   `conflicts` policy SURFACES the disagreement instead of resolving it — the forgery
   preserved, visible, and impotent. [byAuthorRank chain; conflicts; trust-as-read-policy]
10. *The door itself is policy.* Declare a trust ROSTER (one claim): the adversary's second
    forgery now bounces at federate-time — admission trust vs read-time trust,
    distinguished. Reopen (open declaration) after. [trustClaims; roster/open/closed;
    admission vs resolution]
11. *The right to be forgotten.* The private note about Alice; manifest → tombstone →
    purge; bytes leave the origin; the door refuses the exact bytes' return; copy notes the
    degrees (anonymous reassertion, sealed authorship) without exercising them. [erasure]

**Act IV — the wider world**
12. *Alice was just an id.* Pull the circle (a complete foreign store, bundled): names and
    friendships light up; the circle's own registrations arrive AND bind nothing; register
    your own Person lens. [federation; law-inert; foreign packets; Person/friends expand]
13. *Another tongue.* A second packet — a stranger's film log in an alien dialect
    (`film_watched`/`viewer`). One operator-signed translation spec renders it into your
    vocabulary; your film's history now shows an entry recorded by an app that never heard
    of your schema, provenance visible. [translation; readTranslations/translate — ADD to
    browser barrel]
14. *An animate store.* Bless ONE derived function and attach a Runner in the tab: a
    derived `filmsThisYear` (or similar) summary appears, signed by the runner identity,
    durable after the runner detaches. An animate tab is a deploy choice. [Runner;
    bindingDefinitionClaims; derived claims — FEASIBILITY SPIKE FIRST]

**Act V — the door out**
15. *The stranger at the window.* Public declaration; the anonymous schema is a SMALLER
    WORLD (the GQL pane's stranger toggle now shows different hints — the instrument proves
    the thesis); a never-declared lens is invisible even to introspection. [public
    declarations; queryPublic/subscribePublic; anonymous introspection]
16. *The same store, now on your machine.* Export (seed rides, said plainly) → `npm i -g
    @bombadil/loam` → `loam init --seed` → `loam pull` → `loam serve` → the page matches
    `_hex` hash for hash; homecoming recorded in the ground. Copy notes `--archive` (the
    seed vault) as the durable next step. [continuity; export/pull; content-address
    identity; the CLI]

## Feature-coverage matrix (the "every meaningful feature" audit)

genesis/operator ①; schemas-as-data/registration ②; pick/all ②③; mutations/door ③;
subscriptions ③⑥; expand/refs ④⑫; raw multi-pointer claims/pen ⑤; content addressing ⑤⑯;
evolution/concurrent lenses ⑥; negation/absence ⑦; merge count/sum ⑦; absentAs ⑦;
grants/revocation ⑧; chain/byAuthorRank ⑨; conflicts ⑨; trust roster/admission ⑩;
erasure/tombstones ⑪; federation/law-inert ⑫; translation ⑬; Runner/derived ⑭;
public/anonymous surface ⑮; export/continuity/CLI ⑯.
Explicitly out (not built or server-side): §14 write semantics (noted in ⑦), as-of replay,
archive/mirror drivers (copy note in ⑯), HTTP/MCP serving (finale touches serve).

## Build order (each a PR through the full cycle)

- **v2a — the instruments** against the MVP arc: Ground renderer, View browser (Schemas
  meta-view + saved queries), CodeMirror GQL editor (+ introspection plumbing), write-path
  chips. MVP lessons keep passing (arc test untouched except pane-coupling, which is none —
  lessons are UI-free). Browser-verified live.
- **v2b — Acts I–II** (lessons 1–7): lessons.mjs rewrite + arc test rewrite; barrel gains
  nothing new. The evolution/FilmClassic beat and the Alice-left-out beat are the review
  focus. SPEC §16 arc section rewritten to this contract (rides this PR).
- **v2c — Acts III–V** (lessons 8–16): co-author, adversary+conflicts, trust door, erasure,
  circle, translation packet + barrel additions (`translate`, `readTranslations`), the
  Runner lesson (SPIKE FIRST — if the in-page Runner fights us, the lesson demotes to a
  copy-level preview and the spike's findings go to the journal), public, finale.
  gen-packets grows the dialect packet (deterministic, --check gated).
- **v2d — the polish pass**: cold-reader edit of all sixteen, the demos/tutorial README,
  ledger + journal, village parity check (nothing the tutorial shows should be unproven in
  the village).

## Amendments to the arc from Myk's review (fold into v2b)

- **Lesson 6** narrates the TRUE subscription semantics (see header): old subscription keeps
  its shape (pinned lens), new query shows Alice, FilmClassic shows both lenses live. Arc
  test pins old-sub-keeps-old-shape explicitly.
- **Lesson 2** payoff: the registration materializes as BOTH doors (GraphQL hints + the
  OpenAPI document, live in the instruments).
- **Lesson 15**: the anonymous surface is smaller through EVERY door.

## Risks to validate early (spikes, before v2b starts)

1. In-page Runner: attach/animate over LocalStorageBackend; a derived fn definable with
   fixed timestamps. (Village mill.mjs is the reference.)
2. cm6-graphql + esbuild: bundle size + the schema-swap (stranger toggle) path.
3. `expand` within one store (Film → screenings) — resolution shape of expanded entries.
4. Translation in-page: does `translate` need gateway internals the barrel lacks?
5. Old+new lens concurrency: re-register same-name evolution AND sibling-name classic —
   confirm generation behavior matches the beat we narrate; PLUS the amended lesson-6 truth:
   does the superseded generation's subscription really keep emitting after rebind, and does
   erase's reseat (which closes channels) differ visibly? Write the lesson to what's true.
6. REST auth parity (Sprint A): every refusal the GraphQL door makes, the REST door makes —
   enumerate the refusal matrix (no token, wrong token, no standing, tombstoned id, closed
   trust, undeclared-public) and test both doors against it.

**Left off here:** plan locked; SPEC §17 drafted on branch `surfaces` — Myk reads it, then
the loop runs Sprint A (seam → REST/OpenAPI), then v2a instruments onward.
