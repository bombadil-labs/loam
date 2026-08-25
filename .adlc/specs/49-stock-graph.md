# §49 — The stock graph (working spec, T243)

The stock shelf (§42) grows from four flat strangers into an interconnected standard library.
The goal is convergence: two stores that install the same stock shapes share the same
`schema:<Name>@<hash>` snapshots, so they provably share readings — a lightweight interop
vocabulary in anticipation of federation, with no coordination protocol. People will evolve and
fork these shapes; the shelf's job is to make the shared starting point strong enough, and
divergence visible enough, that forking is a deliberate act rather than an accident of the
margins.

Design settled with Myk in chat, 2026-08-25. All named decisions below are his.

## User stories

1. Sam runs `loam register --stock org`. The CLI reports it also installed `shallow-person` and
   `person`. Sam adds `person:ada` as a member. A GraphQL org query returns ada's id and name
   nested — and not ada's follows.
2. Ada replies to a post. Her reply carries `replyTo` (the parent) and `thread` (the anchor).
   A thread query returns every post in the conversation in one read, no tree walk.
3. Priya already has her own bespoke `Person`. She runs `--stock org`. The install composes with
   her Person and warns that it is not stock `Person@<hash>`.
4. Two stores each ran stock. They federate. One person entity, claimed in both stores, appears
   in both stores' org views under the same reading.
5. The operator strikes a stranger's message out of a thread. The thread view no longer shows
   it; the store still holds the delta.

## The catalog

Base props resolve as today (`pick byTimestamp desc` single values, `all` asc lists, marked `*`).
Edges are annotated with the reading their expand names.

| shape | props | edges |
|---|---|---|
| `person` (hub) | name, bio, email | deep reading: follows\* → ShallowPerson, memberOf\* → ShallowOrg |
| `place` (leaf) | name, address, lat, lon | — |
| `attachment` (leaf) | name, mimeType, size, bytes | — |
| `note` (leaf, existing) | title, body, tags\* | — |
| `bookmark` (leaf) | url, title, description, tags\* | — |
| `org` | name, description, website | members\* → ShallowPerson |
| `event` (existing, grows) | title, startsAt, endsAt, notes | attending\* → ShallowPerson, place → place |
| `post` (existing, grows) | title, body, publishedAt, tags\* | mentions\* → ShallowPerson, replyTo → post, thread → thread |
| `message` | body, sentAt | to\* → ShallowPerson, replyTo → message, thread → thread |
| `thread` | title | participants\* → ShallowPerson; members gathered from pointers AT the anchor |
| `task` | title, status, dueAt, tags\* | assignedTo → ShallowPerson |
| `document` | title, body, status, tags\* | attachments\* → attachment |
| `comment` | body, publishedAt | on → ShallowReference (any kind) |
| `collection` | title | items\* → ShallowReference (any kind, curator-signed) |
| `ShallowReference` | id only | — (universal terminator: reads any entity) |
| `ShallowPerson` | id, name | — |
| `ShallowOrg` | id, name | — |

`thread` is read through two lenses, `PostThread` and `MessageThread`. An expand names exactly
one reading, so the two nestings are two gather programs — separate hyperschema entities that
both read the same anchor entities. One `thread:xyz`, two live readings: the hypergraph shown
plainly. A mixed thread reads oddly through either lens; that is inherent to kind-free entities
and the spec section says so rather than hiding it.

## Doctrine

- **Depth is declared per edge.** rhizomatic refuses a readingless expand, so every nesting
  names how deep it goes. Shelf rule: deep programs expand only with shallow readings; shallow
  programs expand nothing. Recursion terminates by construction. `fix` stays off the shelf.
- **Dependencies are derived, never declared.** The dependency set of an entry is computed by
  walking its hyperschema body for expand readings. No hand-written `requires` list exists to
  drift. Shelf closure is railed: every reading any shelf body names is itself on the shelf.
- **Transitive install.** `--stock org` registers org plus every missing dependency, leaves
  first. Each registration is the same verbatim-file path through `parseRegistrationInput` and
  `publishRegistration` — the §42.1 invariant holds: `--stock` changes only how the JSON is
  obtained, and obtaining several files is still only that.
- **Skip-if-bound, compose-and-warn (Myk).** A required name already bound is skipped and
  reported. If the bound reading's snapshot hash differs from stock, the install composes with
  it and prints one warning naming the stock hash. Never a refusal; exit 0. Sovereignty stays;
  drift becomes visible.
- **Re-run is evolve-with-report (Myk).** `--stock person` over an older stock person takes the
  ordinary evolve path and says so.
- **The prop lists are pinned (Myk — reverses §42.5).** Every edit moves the convergence hash,
  so editorial content is now protocol. A rail asserts the exact prop list and edge-reading
  assignment of every entry. The landing section states the reversal.
- **No claimed identity fields, shelf-wide.** Promoted from post's absent `author`: no shape
  carries author/from/creator/sender. The signer is the identity. `message.to` (recipients) and
  `post.mentions` (@-mentions) are different speech acts and stay distinct roles.
- **`replyTo` and `thread` are orthogonal** (the email precedent: In-Reply-To vs References).
  `replyTo` gives the tree; `thread` gives the whole conversation in one gather at the anchor.
  Both are one signed pointer; the denormalization is cheap and honest.
- **A thread is not a collection, and the difference is who signs.** Thread membership is
  member-signed: each message points at the anchor, strangers add themselves, moderation is
  negation. Collection membership is curator-signed: the collector claims the items. The landing
  section teaches this distinction explicitly.

## Build order

One working spec, staged landings (stacked small PRs, per the P6 readability rule): machinery
first — dependency walk, transitive install, skip-if-bound, divergence warning, pin rail — then
shapes leaves-first (`person` before anything that points at it). Frozen rails
`test/cli/stock.test.ts` and `test/cli/pack-stock.test.ts` (T85) stay untouched; every new rail
lands in a new file.

## Acceptance criteria

1. The shelf serves every catalog entry above, and each entry survives the shared validator
   exactly as a hand-typed file would. Verification: `npx vitest run test/cli/stock-graph.test.ts`.
2. `stockDependencies(name)` derives an entry's dependency set by walking its hyperschema body,
   and the shelf is closed — every reading any shelf body names is itself a shelf entry; the
   test computes the closure from the bytes, not from a declared list. Verification:
   `npx vitest run test/cli/stock-deps.test.ts`.
3. `loam register --stock org` on a fresh store registers org, shallow-person, and person in
   dependency order and reports each name it installed, driven through the real CLI.
   Verification: `npx vitest run test/cli/stock-install.test.ts`.
4. On a store where `person` is already bound to a non-stock reading, `--stock org` composes
   with it, prints one stderr warning naming the stock `Person@<hash>`, skips person, still
   installs org, and exits 0. Verification: `npx vitest run test/cli/stock-install.test.ts`.
5. Running `--stock person` twice takes the evolve path on the second run and reports it; the
   registration version list grows by one. Verification:
   `npx vitest run test/cli/stock-install.test.ts`.
6. An org GraphQL query over a live gateway returns a member's id and name (ShallowPerson) and
   does not return the member's follows — the object level asserted through the door, not the
   delta level. Verification: `npx vitest run test/cli/stock-depth.test.ts`.
7. A reply carrying `replyTo` and `thread` pointers appears in a one-read thread query at the
   anchor; the assertion covers both levels — the pointers in the deltas and the nested view
   through the lens. Verification: `npx vitest run test/cli/stock-thread.test.ts`.
8. After the operator negates a stranger's message claim, the thread view excludes it while the
   store still resolves the struck delta — both levels asserted in the same test. Verification:
   `npx vitest run test/cli/stock-thread.test.ts`.
9. Two gateways that both installed stock exchange deltas about one person entity, and each
   store's org view then shows that person under the same reading — the story-4 federation rail,
   two real gateways. Verification: `npx vitest run test/cli/stock-federation.test.ts`.
10. A pin rail asserts the exact prop list and edge-reading assignment of every shelf entry, and
    asserts no entry carries an author, from, creator, or sender prop. Verification:
    `npx vitest run test/cli/stock-pin.test.ts`.
11. `register --help` prints every shelf entry with its one-line summary, and an unknown stock
    name still refuses by naming the whole shelf. Verification:
    `npx vitest run test/cli/stock-graph.test.ts`.
