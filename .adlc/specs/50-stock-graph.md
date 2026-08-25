# §50 — The stock graph (working spec, T244)

The stock shelf (§42) grows from four flat strangers into an interconnected standard library.
The goal is convergence: two stores that install the same stock shapes share the same schema
snapshots and the same gather bodies, so they provably share readings — a lightweight interop
vocabulary in anticipation of federation, with no coordination protocol. People will evolve and
fork these shapes; the shelf's job is to make the shared starting point strong enough, and
divergence visible enough, that forking is a deliberate act rather than an accident of the
margins.

Design settled with Myk in chat, 2026-08-25; amended the same day after the independent
premortem (`50-stock-graph.premortem.md`). The three amendments that changed an approved
decision — story 1's install set, the thread split, ShallowReference dropped — were approved
by Myk in chat the same day.

## User stories

1. Sam runs `loam register --stock org`. The CLI reports it also installed `shallow-person`.
   Sam adds `person:ada` as a member and writes ada's name. A GraphQL org query returns ada's
   id and name nested — and not ada's follows. (Amended post-premortem, approved by Myk: the original
   story had `person` installed too; that dependency is not derivable from the bytes, and the
   observable outcome needs only `shallow-person`. The CLI may still print a one-line tip
   pointing at `--stock person`.)
2. Ada replies to a post. Her reply carries `replyTo` (the parent) and `thread` (the anchor).
   A `PostThread` query at the anchor returns every post in the conversation in one read, no
   tree walk.
3. Priya already has her own bespoke `ShallowPerson` reading, under that program name. She runs
   `--stock org`. The install composes with her reading and warns that it is not stock — naming
   both layers it compared (schema snapshot hash and gather body). Had she bound the lens under
   a different program name, the install would instead refuse in the open, touching nothing,
   because the substrate cannot compose across a program rename and Loam will not evict her.
4. Two stores each ran stock. They federate. One person entity, claimed in both stores, appears
   in both stores' org views under the same reading.
5. The operator strikes a stranger's post out of a thread — the membership pointer at the
   anchor. The thread view no longer shows it; the store still holds the delta.

## The two-layer catalog

**Base layer** — flat `entityGatherJson` programs, the §42 genre: everything pointing at the
root, bucketed by context, writable, no expands. The four existing entries keep their gather
bodies **byte-identical** — growth is new schema props only, which old data survives (premortem
finding 4). Single values resolve `pick byTimestamp desc`; `*` marks `all` asc lists.

| entry | props | notes |
|---|---|---|
| `person` (existing) | name, bio, email, follows\* | unchanged |
| `note` (existing) | title, body, tags\* | unchanged |
| `event` (existing) | title, startsAt, endsAt, location, notes, attending\*, + place | place is a flat place-entity id |
| `post` (existing) | title, body, publishedAt, tags\*, + mentions\*, replyTo, thread | new props are flat ids |
| `place` | name, address, lat, lon | leaf |
| `attachment` | name, mimeType, size, bytes | leaf |
| `bookmark` | url, title, description, tags\* | leaf |
| `thread` | title, participants\* | the anchor shape; members arrive by pointing at it |
| `comment` | body, publishedAt, on | on is a flat id, any kind |
| `collection` | title, items\* | items are flat ids, any kind |

**Graph layer** — programs that expand. A new shape with no legacy data may carry its expands in
its primary program; readings over existing shapes are new programs with new lens names. Each
expand names its child reading.

| entry | props | edges |
|---|---|---|
| `org` | name, description, website | members\* → ShallowPerson |
| `message` | body, sentAt, replyTo, thread | to\* → ShallowPerson |
| `task` | title, status, dueAt, tags\* | assignedTo → ShallowPerson |
| `document` | title, body, status, tags\* | attachments\* → Attachment |
| `shallow-person` | name | — (a masked reading of person entities: name only) |
| `shallow-org` | name | — (likewise for org entities) |
| `person-graph` | name, bio, email | follows\* → ShallowPerson, memberOf\* → ShallowOrg |
| `post-thread` | title | members\* → Post (posts pointing at the anchor) |
| `message-thread` | title | members\* → Message (messages pointing at the anchor) |

**One entry provides exactly one lens**, and the CLI name is the kebab-case of the lens name
(`ShallowPerson` → `shallow-person`) — the stated, mechanical reading↔entry rule (premortem
finding 5). `PostThread` and `MessageThread` are separate programs over the **same anchor
entities**: one `thread:xyz`, three live readings (Thread, PostThread, MessageThread) — the
hypergraph shown plainly. A mixed thread reads oddly through either typed lens; that is inherent
to kind-free entities and the landing section says so. (Amended post-premortem, approved by Myk: the original
design called these two readings of one hyperschema entity; sibling lenses share one gather
body, so different nestings are necessarily different programs.)

**`ShallowReference` is dropped** (premortem finding 3): with flat bases as terminals it buys
nothing, and an `{ id }`-only entry violates the frozen T85 per-entry invariants (props and
writable non-empty). Heterogeneous edges (`comment.on`, `collection.items`) stay flat ids, as
§42 always had them. (Amended post-premortem, approved by Myk.)

## Doctrine

- **Termination is a DAG, derived from the bytes.** The shelf's reading-reference graph — entry
  → the readings its body's expands name — must be acyclic, with the flat bases and shallow
  readings as its sinks. Railed by walking the bodies, never a declared depth. `fix` stays off
  the shelf. (Replaces "deep programs expand only with shallow readings": termination is a
  property of the child *program*, not the reading name — premortem finding 1.)
- **Dependencies are derived, never declared.** An entry's dependency set is the readings its
  hyperschema body names, mapped to entries by the one-lens-per-entry rule. No hand-written
  `requires` list exists to drift. Shelf closure is railed: every reading any shelf body names
  is itself a shelf entry.
- **Transitive install.** `--stock org` registers org plus every missing dependency, sinks
  first. Each registration is the same verbatim-file path through `parseRegistrationInput` and
  `publishRegistration` — the §42.1 invariant holds: `--stock` changes only how the JSON is
  obtained, and obtaining several files is still only that.
- **Skip-if-bound keys on the LENS name** (`lensOf`, never the program name — H6; premortem
  finding 6). A required lens already bound is skipped and reported.
- **Divergence composes and warns, at both layers (Myk).** A bound reading is stock-identical
  only when its schema snapshot hash AND its hyperschema gather body both match the shelf's
  (`versionedSchemaHash` covers props+default alone — premortem finding 2). On either mismatch
  the install composes and prints one warning naming what differed. Divergence is never refused.
- **A lens under a foreign program name cannot compose, and the install refuses in the open**
  (discovered at build, 2026-08-25: the substrate resolves an expand's `schema` ref by PROGRAM
  name, and the registry admits one reading per lens name). A bespoke reading bound under a
  program named differently from the reference can never serve the dependent body, and
  installing stock beside it would EVICT the bespoke binding (latest-per-lens) — the exact
  destruction H6 warns about. So the install pre-flights the whole closure and refuses, exit 2,
  BEFORE any delta lands: the store is untouched, the refusal names the program mismatch and
  the remedy. Sovereignty outranks convergence when the two collide.
- **Re-run is evolve-with-report (Myk).** Re-running a stock name takes the ordinary evolve
  path and says so — including the qualified `does not bind` outcome when a rival body answers
  the program name.
- **The prop lists are pinned (Myk — reverses §42.5).** Every edit moves the convergence
  hashes, so editorial content is now protocol. A rail asserts the exact prop list and
  edge-reading assignment of every entry. The landing section states the reversal.
- **No claimed identity fields, shelf-wide.** Promoted from post's absent `author`: no shape
  carries author/from/creator/sender. The signer is the identity. `message.to` (recipients) and
  `post.mentions` (@-mentions) are different speech acts and stay distinct roles.
- **`replyTo` and `thread` are orthogonal** (the email precedent: In-Reply-To vs References).
  `replyTo` gives the tree; `thread` gives the whole conversation in one gather at the anchor.
- **Moderation strikes the membership pointer.** A message's presence in a thread IS its
  member-signed pointer at the anchor; the operator strikes that delta to remove it from the
  view. Striking only the body claims leaves a visible husk — documented, and pinned by the
  rail, rather than discovered (premortem finding 7).
- **Thread vs collection is who signs — as teaching, not as a bytes guarantee** (premortem
  finding 9). Thread membership is member-signed (strangers add themselves; moderation is
  negation). Collection items are curator-signed *by convention*: the shipped gather admits
  every author (§42.2's posture), so the guarantee arrives only when a reader adds a trust mask
  or `authoredBy`. The landing section states this honestly, with §42.2's exits.

## Build order

One working spec, staged landings (stacked small PRs, per the P6 readability rule): machinery
first — dependency walk, DAG and closure rails, transitive install, lens-keyed skip-if-bound,
two-layer divergence warning, pin rail — then shapes sinks-first. Frozen rails
`test/cli/stock.test.ts` and `test/cli/pack-stock.test.ts` (T85) stay untouched; every new rail
lands in a new file, and every new shelf entry satisfies the frozen per-entry invariants (props
and writable non-empty).

## Acceptance criteria

1. The shelf serves every catalog entry above; each entry survives the shared validator exactly
   as a hand-typed file would, and satisfies the frozen T85 per-entry invariants (non-empty
   props and writable). Verification: `npx vitest run test/cli/stock-graph.test.ts`.
2. `stockDependencies(name)` derives an entry's dependency set by walking its hyperschema body
   (every Term shape, including union arms and nested expands), mapped by the
   one-lens-per-entry rule; the shelf is closed and the reading-reference graph is acyclic. The
   test compares the walk against a hand-written per-entry dependency table, so a walk bug
   cannot go vacuously green (H10). Verification: `npx vitest run test/cli/stock-deps.test.ts`.
3. `loam register --stock org` on a fresh store registers shallow-person then org, in
   dependency order, and reports each name it installed, driven through the real CLI.
   Verification: `npx vitest run test/cli/stock-install.test.ts`.
4. Skip-if-bound keys on the lens name, and both bespoke fixtures hold: (a) a bespoke
   `ShallowPerson` under the SAME program name with a divergent body is skipped and composed
   with — one stderr warning names the layers compared, the divergence is detected by the BODY
   hash (the schema hashes agree by construction), org installs, binds through the bespoke
   program, exit 0; (b) a bespoke lens `ShallowPerson` under a foreign program name (lens ≠
   program, pinning H6) is refused in the open, exit 2, BEFORE any delta lands — the bespoke
   binding survives untouched, org is not installed, and the refusal names the program mismatch
   and the remedy. Verification: `npx vitest run test/cli/stock-install.test.ts`.
5. An upgrade rail starts from a §42-era fixture store: re-running the four existing names
   leaves their gather bodies byte-identical, evolves schema props only, keeps old data (a
   follows list, an event location) serving, reports the evolve, and exercises the qualified
   `does not bind` outcome. Verification: `npx vitest run test/cli/stock-upgrade.test.ts`.
6. An org GraphQL query over a live gateway returns a member's id and name and not the member's
   follows; the same test asserts at the gather level that the ShallowPerson program's bucket
   set is exactly its declared props, so no other door can serve what GraphQL hides.
   Verification: `npx vitest run test/cli/stock-depth.test.ts`.
7. A reply carrying `replyTo` and `thread` pointers appears in a one-read `PostThread` query at
   the anchor; the assertion covers both levels — the pointers in the deltas and the nested
   view through the lens. Verification: `npx vitest run test/cli/stock-thread.test.ts`.
8. After the operator negates a stranger's membership pointer, the thread view excludes the
   post while the store still resolves the struck delta; the same test pins the husk case —
   negating only the body claims leaves the membership visible — as the documented behavior.
   Verification: `npx vitest run test/cli/stock-thread.test.ts`.
9. Two gateways that both installed stock exchange deltas about one person entity, and each
   store's org view then shows that person under the same reading — two real gateways.
   Verification: `npx vitest run test/cli/stock-federation.test.ts`.
10. A pin rail asserts the exact prop list and edge-reading assignment of every shelf entry,
    and asserts no entry carries an author, from, creator, or sender prop. Verification:
    `npx vitest run test/cli/stock-pin.test.ts`.
11. `register --help` prints every shelf entry — both layers — with its one-line summary, and
    an unknown stock name still refuses by naming the whole shelf. Verification:
    `npx vitest run test/cli/stock-graph.test.ts`.

## Changes after premortem

Finding-by-finding, the resolutions above: (1) termination and dependencies re-grounded at the
program layer; story 1 amended; (2) divergence compares both layers; (3) ShallowReference
dropped, shallow entries satisfy the frozen invariants; (4) criterion 5 rebuilt around a
§42-era fixture and byte-stable base bodies; (5) one entry per lens, kebab-case rule, thread
split into three entries; (6) skip-if-bound keys on `lensOf`, fixture requires lens ≠ program;
(7) moderation names the membership delta, husk case pinned; (8) closure test carries a
hand-written table; (9) curator-signed stated as convention with §42.2's exits; (10) criterion
6 asserts the gather level beside the door.

One further amendment landed at build time (2026-08-25): the substrate resolves an expand's
`schema` reference by program name and admits one reading per lens, so the H6 fixture (lens
under a foreign program) cannot compose — the install refuses in the open before any delta
lands, and criterion 4 now pins both bespoke fixtures. The divergence-composes promise is
unchanged where composition is possible.
