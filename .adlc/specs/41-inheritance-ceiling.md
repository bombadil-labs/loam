# §41 — A container inherits up to a ceiling

**Ticket.** T144. **Status.** Working spec, design-stage. Myk settled the user stories and three
design questions on 2026-08-05, and refined the knob from a boolean into a CEILING in the same
conversation, then answered all three remaining questions in the same conversation — 41.6 records them
and 41.6b records the one he reframed. **No question is open.** The landing PR is his merge.

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

## 41.6 The questions Myk answered, 2026-08-05

**(a) An ancestor's connection INBOX pools ARE inherited.** A member is a member; a carve-out would
make "what does this container contain" answerable only with a footnote. So a child inheriting from
`alice` reads what a connection wrote into `alice`'s inbox — and the consent criteria (13-15) must
therefore count inbox deltas in their tier, because that is content a connection will read.

**(b) CLOSED — the case cannot arise the way the question posed it.** Three facts settle it:

- **A dropped ceiling needs no rule.** The ceiling is always an ancestor (41.2.2), so dropping it
  necessarily drops every container that names it. Containment does the work. Myk saw this at once; the
  question was badly posed for lumping drop together with detach.
- **A detached ceiling is already handled.** `spec/27-containers.md:81` defines
  `loam.container.detached` as the operator's record that **a SEPARATE container's store** is
  deliberately absent, so a missing pool reads as a decision rather than resolving empty (H9). Detach
  therefore cannot apply to a shared container at all, and "the ceiling is detached" narrows to "a
  separate-posture ceiling is detached" — which criterion 11 already covers by reusing
  `containerScope`'s existing refusal.
- **A detached container has no life of its own.** Its bytes persist; nothing reads or writes them
  until it is reattached. Writes are refused by construction, because the pool is not open — not by a
  guard. Myk asked whether a detached container could keep running; it cannot, and that removes the
  oddness he suspected.

**(c) Dropping a container with live connections REFUSES BY DEFAULT, with an explicit override.** Myk:
"handled via a `forceChildrenToDisconnect` flag, maybe? Refuse by default, but accept override?" The
refusal names the blocking connections. The override revokes them and proceeds, and it is a named flag
on the call — never a default, never inferred. This matches the re-parent rule, so a user learns one
pattern: an act that would invalidate a granted consent is refused and says what blocks it.

## 41.6b Moving an inheriting container — the real problem is the CONTENT, not the pointer

The ticket first framed this as a dangling ceiling: move a container and its ceiling may stop being an
ancestor. Myk found the deeper one — **the content may stop making sense.**

His words: "there may be things in A.1.2.1.7 that depend on deltas in A.1.2 ... If we allow the move,
the *meaning* of what's in A.1.2.1.7 may change in ways that become impossible to reason about." He
floated pulling the depended-on deltas down into the moving container and called it a can of worms. It
is: that copies deltas, and a copy is a second place a forgotten delta survives — which is exactly what
41.2.4 exists to prevent.

**So a move that CHANGES a container's inheritance is refused** — not because a pointer breaks, but
because the content cannot be re-grounded without either changing its meaning silently or copying. A
move that leaves the ceiling an ancestor, with the path's contents unchanged, is harmless and stays
allowed.

**The operation Myk actually wants is EJECTION, and it already has a name.** "Drop A.1 but keep
A.1.2.1.7" is not a re-parent — it is taking a container out as something self-contained. That is the
ejection idea, recorded when it was T119 and still undesigned: a container leaves and becomes a store
its owner operates. Ejection resolves the coherence problem honestly: a store that stands alone has to
materialise what it depended on, and there the copy is the entire point of leaving rather than a hidden
side-effect of a move. **RECOMMEND: keep moves narrow here, and let ejection carry the keep-a-subtree
case as its own ticket and its own design.**

## 41.7 Section number

This is a new section, §41 — the next free number (§40 is the admin page). It amends §28's container
declaration by adding a knob, and §28.4's immutability rule now covers three knobs rather than two;
the landing edits that sentence in `spec/28-container-trust.md` in the same change.
