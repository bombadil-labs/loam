## 19. Tutorial v2 — needs before doctrine

The MVP (§16) proved the machinery: a real store in the page, checks that read the ground,
an arc that cannot rot ahead of the library. Walking it proved something else: the lessons
taught Loam's doctrine in the order the SPEC states it, and a learner builds a cognitive
model in the order their NEEDS arise. v2 keeps §16's foundations — progress is the store,
every check a real read, the finale's hash-for-hash homecoming — and rebuilds the arc and the
instruments on four principles from the walkthrough:

- **Needs before doctrine.** Open where a person opens ("track the films you watch"), and let
  the doctrine beats — data-first, a schema is a lens — arrive as EARNED REVEALS at the
  moment the learner has a need only that truth explains. The reveal lands harder than the
  cold open ever could.
- **Instruments, not exhibits.** The panes are tools the learner drives, not displays the
  lessons decorate. Every lesson ends with something new that the instruments can explore
  off-script, and going off-script is the intended behavior.
- **Explicit write paths.** Every act is labeled with how it reached the ground: the DOOR (a
  GraphQL/REST mutation, compiled to a claim), the PEN (a raw signed claim), the WIRE
  (federated), or DERIVED (a runner's emission). The learner always knows which pen wrote.
- **Total coverage.** By the finale the learner has touched every meaningful feature the
  library ships. The arc below carries the audit; a feature without a lesson is a gap, not
  an elective.

**The instruments.**

- **Ground** — newest first; a delta renderer with kind badges (constitution, registration,
  fact, negation, tombstone, trust, grant, public-declaration, foreign, derived), one-line
  summaries, expand-to-wire-JSON, the operator delta annotated for what it is. Arrivals
  highlight. Everything renders as text, never markup — the hostile-claim lesson is exactly
  why.
- **GraphQL** — a real editor (CodeMirror + cm6-graphql): autocomplete, docs, and lint driven
  by the LIVE schema via introspection against the in-page gateway, re-derived on every
  registration and on the ask-as-the-stranger toggle (the anonymous schema is a different,
  smaller schema — the instrument itself proves §12). Discovery is the interface: after the
  screenings lesson, typing `film {` OFFERS the watch history. Queries pin to the View pane.
- **View** — a query-fed browser, no hardcoded cards. Seeded with the **Schemas meta-view**
  (registrations read as data: name, generations, schema summary, roots), so registering Film
  visibly ADDS FILM TO A VIEW before "schemas are data" is ever said. Select a schema → its
  roots → the live resolved view (a subscription, and the pane says so). Lessons contribute
  saved queries; so does the learner. After §17: the registration's OTHER door (the OpenAPI
  document) is visible beside the GraphQL hints — one truth, two materializations, live.

**The arc — five acts, sixteen lessons.** (Titles are working; the copy is the craft.)

- **Act I — a store of your own.** (1) You are the operator: genesis, seed custody, the
  constitution annotated in the Ground. (2) Track your films: motivate → define → register →
  the GraphQL pane LIGHTS UP with hints and the Schemas view gains Film — and with §17
  shipped, the OpenAPI document materializes beside it: two doors from one registration.
  (3) Write through the door: mutations; one act seen three ways (View updates live, Ground
  grows a badged delta, the copy says plainly the mutation COMPILED to a signed claim).
  (4) Screenings are entities: a second schema, a film⇄screening reference, `expand` — the
  film's view nests its history.
- **Act II — the ground truth.** (5) The secret — it was claims all along: the next screening
  written with the PEN, one multi-pointer claim that also names a guest (`person:alice`, a
  role no schema knows); the old lens shows the screening BUT LEAVES ALICE OUT — a lens
  drops what it doesn't gather; the inspector shatters an id on a one-byte edit. (6) Evolve
  the lens, keep every past: add `guests`, re-register — a NEW query shows Alice; the OLD
  subscription keeps streaming Alice-less, because a subscription is executed against the
  generation that opened it and is a PINNED LENS CHOICE — nothing you were watching breaks;
  you adopt the new shape by asking with it; then the pre-guests schema re-registered as
  `FilmClassic`: two lenses, one ground, both live — nothing was mutated, ever. (7) Taking
  it back, and what silence means: negation → absence; merge sum and absentAs on the book;
  the aggregate that cannot be set (upgrades to §14's refusal when §14 ships).
- **Act III — other people.** (8) A co-author: the roommate's seed minted in-page, their
  write REFUSED, standing granted with one claim, their screening landing under THEIR
  signature, then revoked — the full grant lifecycle. (9) The adversary, and whose word
  wins: the forged title arrives on the wire; pick-latest falls; a trust chain (your word
  first) defends; and a `conflicts` lens SURFACES the dispute instead of resolving it — the
  forgery preserved, visible, impotent. (10) The door itself is policy: a roster declaration,
  and the second forgery bounces at federate-time — admission trust and read-time trust,
  distinguished. (11) The right to be forgotten: manifest → tombstone → purge; the bytes
  leave the origin; the door holds; the degrees of forgetting named, not exercised.
- **Act IV — the wider world.** (12) Alice was just an id: pull the circle; names and
  friendships light up; the circle's own law arrives AND binds nothing. (13) Another tongue:
  a stranger's log in an alien dialect, rendered into your vocabulary by one signed
  translation spec, provenance visible in the view. (14) An animate store: one derived
  function blessed, a Runner attached in the tab, a derived summary landing signed by the
  runner and durable after it detaches — an animate tab is a deploy choice (§6).
- **Act V — the door out.** (15) The stranger at the window: one public declaration; the
  anonymous surface is a SMALLER WORLD through every door — the editor's hints shrink, the
  OpenAPI document shrinks, a never-declared lens is invisible even to introspection.
  (16) The same store, now on your machine: export (the seed rides, said plainly, tutorial
  data only) → `npm i -g @bombadil/loam` → `loam init --seed` + `loam pull` + `loam serve` →
  the page matches `_hex` hash for hash and records the homecoming IN the ground.

**The audit.** genesis/operator ①; registrations-as-data ②; two doors from one registration
②⑮ (§17); mutations ③; subscriptions-as-pinned-lenses ③⑥; expand/refs ④⑫; raw multi-pointer
claims ⑤; content addressing ⑤⑯; evolution + concurrent generations ⑥; negation/absence,
merge, absentAs ⑦; grants + revocation ⑧; chain/byAuthorRank + conflicts ⑨; trust
roster/admission ⑩; erasure ⑪; federation/law-inert ⑫; translation ⑬; Runner/derived ⑭;
public surfaces ⑮; continuity/CLI ⑯. Explicitly out until built: §14 write semantics (named
in ⑦), as-of replay, server-side drivers (named in ⑯'s copy).

**Acceptance bars, normative** (the MVP's review findings, promoted to law): every check is
EARNED (false before its lesson runs), DURABLE (monotone in the ground — a later lesson can
never un-green an earlier one), and SIDE-EFFECT-FREE (safe to re-verify on every boot);
the copy is apprehensible cold; the arc test drives the page's own functions through all
sixteen in order, the revisit, and the finale round trip — including the lesson-6 pin that a
superseded generation's subscription keeps its shape.

**Provenance.** Landed — [#64](https://github.com/bombadil-labs/loam/pull/64) (v2a instruments: Ground/GraphQL/View), [#65](https://github.com/bombadil-labs/loam/pull/65) (reset/unpin), [#66](https://github.com/bombadil-labs/loam/pull/66) (v2b: the sixteen-lesson arc), [#67](https://github.com/bombadil-labs/loam/pull/67) (localStorage namespace-collision hotfix), [#68](https://github.com/bombadil-labs/loam/pull/68) (v2c), [#69](https://github.com/bombadil-labs/loam/pull/69) (lesson-button fix), [#70](https://github.com/bombadil-labs/loam/pull/70) (step-through + in-order gating). Lives in `demos/tutorial/lessons.mjs`, `demos/tutorial/app.mjs`, `demos/tutorial/instruments.mjs`, tested end-to-end by `test/site/arc.test.ts`. Standing design split (PR #70): step progress within a lesson is ephemeral and content-address-idempotent, while the durable gate is always the ground-derived green — the split that keeps in-order gating honest across reloads without polluting the ground with UI state.
