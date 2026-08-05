# §41 — A container inherits up to a ceiling

**Ticket.** T144. **Status.** Working spec, design-stage. Myk settled the user stories and three
design questions on 2026-08-05, and refined the knob from a boolean into a CEILING in the same
conversation. Two questions remain open (41.6). The landing PR is his merge.

**One sentence.** A container may inherit the deltas of its ancestors up to a declared ceiling, so a
reader of that container gathers its own members plus every tier between it and the ceiling — and
never a sibling, a descendant, or anything above the ceiling.

## 41.1 The user stories

These come first because they are what a person experiences, and each one earns an executable rail in
41.5. They are Myk's answers, restated as acts.

**S1 — Alice makes a container that inherits.** Alice has notes in her root container `alice`. She
declares `alice:folklore` with a ceiling of `alice`. She opens it and **her root notes are already
there** — an inheriting container is full from the moment it exists, not empty until she does
something. Anything she later adds to `alice` shows up here too.

**S2 — Alice can tell what she is looking at.** In `alice:folklore` the inherited notes are **visibly
marked** as coming from `alice`. She is not left guessing which items are folklore's own and which
arrived from above.

**S3 — Alice curates her own view.** She strikes an inherited note while in `alice:folklore`. It
disappears from folklore. It **stays live in `alice`** and in every other container. Her judgement
binds where she made it and nowhere else.

**S4 — Alice builds a working container with a lower ceiling.** She declares `alice:project` and gives
its children a ceiling of `alice:project`. A child, `alice:project:draft`, sees everything in
`alice:project` — and **not** `alice`, and **not** the store's shared ground. This is the case the
ceiling exists for: a working area whose children share its content without seeing the whole store.

**S5 — Alice sees a container without a ceiling stay clean.** `alice:friends`, declared with no
ceiling, shows none of `alice`'s notes. The absence of the knob is a real state, not a default that
leaks.

**S6 — Alice approves a connection and can read what she is granting.** The consent page for a
connection bound to `alice:folklore` **names every tier** the connection will read — `alice:folklore`,
then `alice` — and **counts the deltas in each**. The page says plainly that the counts are a snapshot
of this moment and **will grow** as deltas are appended, merged or promoted into those tiers. She is
never shown a number that reads like a limit.

**S7 — Alice cannot silently widen a granted consent.** She tries to move `alice:folklore` under
`alice:archive`, which would change its path and therefore its reach. The move is **refused**, and the
refusal **names the connection** that blocks it. She revokes that connection, moves the container, and
approves a new connection against the new, freshly-stated reach.

## 41.2 The model

1. **Inheritance runs UP the ancestor chain, never across or down.** A container gathers its own
   members plus the members of each ancestor between it and its ceiling. It never gathers a sibling's
   members, and never a descendant's.
2. **The ceiling is a named ancestor, and it is inclusive.** `inheritTo` names a container on this
   container's own path, or the literal store ground. Absent, there is no inheritance at all.
3. **This does not reverse §39.3(a).** That section refused UPWARD merge — a parent never
   auto-gathers its children, because that would destroy per-container divergence. This is the
   opposite direction. Downward-invisible, upward-visible-to-a-ceiling. Both hold at once, and a
   builder who reads §39.3(a) first will need telling.
4. **Inheritance is BY REFERENCE, resolved at gather time — never a copy.** Erasing a delta from an
   ancestor removes it from every inheriting descendant with no second sweep, so erasure keeps its
   full guarantee and no forgotten delta acquires a second home.
5. **The ceiling is immutable, like `trust` and `posture`** (Myk, 2026-08-05). Changing it would
   retroactively change what every past read of this container would have resolved, and would silently
   widen the reach an approved connection was consented against. §28.4 already treats the other two
   knobs this way; this joins them. Changing your mind means a new container.

## 41.3 The traversal is new; do not reuse the one that exists

`subtreeOf` (`src/server/admin.ts:177`) walks DOWNWARD through `parent` and `inboxOf` edges to answer
AUTHORIZATION reach — *which containers may this user touch*. Inheritance needs an ANCESTOR walk to
answer GATHER membership — *what does this container contain*. Same tree, opposite direction, different
question. Reusing either for the other is a bug waiting to happen, and the two must not share a helper.

Containment is a tree (§28.8) and `container.ts:340` already refuses a cycle, so an ancestor walk
terminates.

## 41.4 Why a knob rather than a Term

A child's membership Term could restate its parent's clauses today, but that is copy-paste which drifts
the moment the parent's Term changes, and it cannot reach a SEPARATE-posture ancestor at all — that
pool is not in the primary ground a Term selects over. A declared ceiling stays correct as ancestors
change, and it is the thing the consent page can enumerate.

## 41.5 Acceptance criteria

Every criterion names its verification. Criteria S1–S7 are the user stories, and their rail is a
**story rail** that drives the real surface end to end. The CDP harness they need **does not exist
yet** and building it is part of this work — that is the T143 lesson made concrete: no existing rail
drives a browser, which is exactly how an unusable login door shipped green.

1. S1 — a container declared with a ceiling gathers an ancestor's delta immediately, with no write of
   its own. Assert at BOTH levels: the delta is in the container's gather, AND a View through a Schema
   resolves it. Verified in `test/server/inherit-gather.test.ts`.
2. S1 — a delta appended to the ancestor AFTER the child was declared also appears, proving reference
   rather than snapshot. Verified in `test/server/inherit-gather.test.ts`.
3. S4 — a child whose ceiling is `alice:project` gathers `alice:project`'s members and does NOT gather
   `alice`'s or the store ground's. Named live bystanders in both excluded tiers, so the rail sees
   over-inheriting as well as under-inheriting. Verified in `test/server/inherit-gather.test.ts`.
4. S5 — a container declared with NO ceiling gathers nothing from any ancestor. The knob is what does
   the work; without this rail the feature could be deleted and the suite stay green. Verified in
   `test/server/inherit-gather.test.ts`.
5. A sibling's members are never gathered, and neither are a descendant's. Two named bystanders.
   Verified in `test/server/inherit-gather.test.ts`.
6. **The H1 rail: inheritance carries NEGATIONS.** An ancestor holds D1 and also holds D2 negating D1.
   The inheriting child's View resolves WITHOUT D1. A gather that admits D1 and drops the admitted D2
   is the strand §39.2 names, and it would show a claim the ancestor itself has retracted. Verified in
   `test/server/inherit-negation.test.ts`.
7. S3 — a negation authored IN the inheriting container suppresses an inherited delta there, and the
   delta stays live in the ancestor and in a sibling. Three-sided, and it is the curation promise.
   Verified in `test/server/inherit-negation.test.ts`.
8. A ceiling naming a container that is NOT an ancestor of this one is refused at the declaration door,
   by name. Verified in `test/server/inherit-declare.test.ts`.
9. A ceiling naming the container itself, or a descendant, is refused. Verified in
   `test/server/inherit-declare.test.ts`.
10. The ceiling is IMMUTABLE: a second declaration naming a different ceiling is refused with the same
    force §28.4 refuses a changed `trust` or `posture`, and the message says a different ceiling is a
    NEW container. Verified in `test/server/inherit-declare.test.ts`.
11. Inheritance through a SEPARATE-posture ancestor either refuses at declaration or requires the pool
    ATTACHED at read time — and per H9 it must never resolve as if that ancestor were empty. Reuse
    `containerScope`'s existing refusal rather than writing a second one. Verified in
    `test/server/inherit-separate.test.ts`.
12. Whether an ancestor's connection INBOX pools are inherited is decided and RAILED in whichever
    direction 41.6(a) settles — the criterion asserts the chosen answer, not both. Verified in
    `test/server/inherit-separate.test.ts`.
13. S6 — the consent page for a connection bound to an inheriting container NAMES every tier from the
    container up to its ceiling, in order. Verified in `test/server/inherit-consent.test.ts`.
14. S6 — it COUNTS the deltas currently in each tier, and states in words that the counts are a
    snapshot that will grow. A page that shows a bare number reads as a bound, which is the H7 shape in
    a consent dialogue. Verified in `test/server/inherit-consent.test.ts`.
15. S6 — a connection bound to a container with NO ceiling shows exactly one tier, so the page's shape
    is not a template that always implies inheritance. Verified in
    `test/server/inherit-consent.test.ts`.
16. S7 — re-parenting a container is REFUSED while any connection is bound to it **or to any container
    in its subtree**, because moving it changes every descendant's path too. The refusal names the
    blocking connection. Verified in `test/server/inherit-reparent.test.ts`.
17. S7 — after the blocking connection is revoked, the same move SUCCEEDS, and a fresh consent page
    states the new reach. Two-sided against 16. Verified in `test/server/inherit-reparent.test.ts`.
18. Erasing a delta from an ancestor removes it from every inheriting descendant's gather with no
    second sweep — inheritance is by reference (41.2.4). Assert the ancestor's bytes are gone AND a
    named live bystander in the descendant survives. Verified in
    `test/server/inherit-erasure.test.ts`.
19. A store created before this work reads IDENTICALLY after it: an absent ceiling means no
    inheritance, so every existing container keeps its exact contents. Verified in
    `test/server/inherit-migrate.test.ts`.
20. The container declaration's new shape is unambiguously distinguishable from every prior spelling
    (the §20 corollary), and `src/migrate/` carries a step in this same change. Verified in
    `test/server/inherit-migrate.test.ts`.
21. **The story rails** — S1 through S7 driven end to end against a served store in a real browser:
    declare with a ceiling, see inherited items marked, strike one and watch it survive upstream, read
    a consent page's tiers and counts, and be refused a re-parent by name. Verified in
    `test/site/inherit-stories.test.ts` (a new CDP-driven harness this work must build).

## 41.6 Open questions

**(a) Are an ancestor's connection INBOX pools inherited?** A container's members include the inboxes
spawned for its connections (§39.3d). So an inheriting child would read what a connection wrote to its
ancestor. Consistent, and possibly surprising — a person may not expect a child container to expose
another app's writes. RECOMMEND: yes, inherited, because a member is a member and a carve-out here
would make "what does this container contain" answerable only with a footnote. Myk's call.

**(b) What happens when a ceiling container is dropped or detached?** A descendant names it, so the
chain breaks. Per H9 the read must never resolve as if the ancestor were empty. RECOMMEND: refuse the
drop while any descendant names it as a ceiling, by the same logic that refuses a re-parent — and name
the descendant in the refusal. The alternative, failing the read closed and loudly, moves the error from
the act that caused it to a reader who did nothing wrong.

## 41.7 Section number

This is a new section, §41 — the next free number (§40 is the admin page). It amends §28's container
declaration by adding a knob, and §28.4's immutability rule now covers three knobs rather than two;
the landing edits that sentence in `spec/28-container-trust.md` in the same change.
