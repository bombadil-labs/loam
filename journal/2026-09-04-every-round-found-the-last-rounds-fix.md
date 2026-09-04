# Every round found the last round's fix

*2026-09-04, closing the §58 S2 sprint.*

T263's ten-PR sprint landed nine PRs overnight. The feature is in SPEC §58.7–§58.12 and does not
need repeating here. What the PRs cannot carry is the shape of what the reviews found, and it is
sharp enough to be worth measuring.

## The number

PR 8a — the container roster's three safe verbs, about 300 lines of source — went through
**twelve independent review rounds. Eleven of them found something.** Of the defects they found,
**most were introduced by the immediately preceding round's fix**, and several were in the exact
lines written to close the previous finding.

That is not a story about carelessness. Every round was measured, railed, probed, and green before
it was reviewed. It is a story about a seam: what "inside the person's tree" means. Each round
answered it slightly better and slightly wrong, and only an outside reader could see which.

The progression, since the shape repeats:

1. The reserved-name rule was applied at READ time, which would have locked out anyone already
   named `inbox` — no login, no roles, no road back.
2. `declare` wrote a parent edge without checking the parent stood, making containers no page
   could reach; and declared them `separate` with no backend, which the scope walk fails closed
   on, bricking the connection that asked.
3. A connection could resurrect a container the person had just dropped: a drop leaves the pool
   attached, so the grant check still said it stood.
4. The same resurrection one level down, through the children that outlived the drop.
5. The mint question asked whether the door would admit a delta TODAY, not whether it ever bound.
   On a store older than one rename, that reported every dropped container as never declared.
6. The write seam asked the container's NAME, not its chain — and every append and registration
   goes through that seam.
7. A peer's bytes could land on another person's pages, through a container parented into their
   tree.
8. And the fix for that derived the person's home by SPLITTING THE NAME — one line below a comment
   stating, for the third time in that file, that a parent edge need not agree with a name.

## The rails could not have caught number 8

Every fixture in that file minted containers as `<user>:<leaf>`, so the name-root and the tree-root
coincided in all of them. Two different derivations agreed on the whole corpus. The case that
finally told them apart binds through consent to a container whose name and edges disagree — a
shape no fixture had, because no fixture had needed one.

That is H10 in the small: **a corpus in which two derivations coincide proves nothing about which
one you implemented.**

## What a green probe was worth

The rail carries a probe table — revert each guard, record how many cases go red. Over the sprint,
**more than a dozen probes came back green**, and each green was a rail that read correctly and
proved nothing:

- a case asking for a leeway the law refused anyway, so it could not tell a pool rule from no rule;
- a parser exercised with one switch, so two thirds of it could have been deleted;
- a reservation asserted against the rule instead of against a door;
- two refusals read as booleans, so a different rule's sentence satisfied them;
- a no-oracle assertion satisfied by a comma;
- and one probe recorded as UNDRIVABLE with a mechanism I had invented, when the real cause was my
  own fixture deleting a leeway it should have carried.

The last is the worst kind. A rail that records a guard as untestable when it is testable is worse
than one that never mentions it, because the green reads as evidence.

## The prose lies the same way the code does

The landing PR's first draft carried **eight overclaims** in SPEC prose, and the fix round for
those carried four more. "Nothing a connection writes lands in the primary ground" — false the
moment `declare` shipped, because the STORE signs that law at the connection's request. A promised
refusal for *offering* above the root, when there is no offer road at all. A citation to §46 for a
rule that lives in §24. A command-line completion road promised for a verb that has none, stated
precisely as the escape hatch a person would go looking for.

None of these could fail a test. SPEC.md is the record of what IS, and a sentence in it the code
does not do is worse than a missing one — so it wants the same adversarial reading the code gets,
and it had never had one.

## Two process failures, recorded because they will recur

**I reported a green bar I had not read.** `npm run check | tail -3` showed a duration; the failure
count was one line above the window. This file already says to read the counts and never trust a
silent grep. Tailing is a silent grep with extra steps.

**I twice destroyed uncommitted work with `git checkout -- <path>` while probing.** Both times the
recovery was luck: a keep-copy that happened to exist, or a transcript to re-apply from. Probing
mutates the tree by design, so a probe loop must restore from a snapshot it took, never from git.

## Where it stopped

Two items are a person's call, and both are one shape: **a position decided twice, differently, by
two things that both landed.** The sixth roster verb (§58 says a connection may bless a peer's
renderer; §46's rail says no tool mounts a stranger's code at all) and the register union's
retirement (a frozen rail asserts the behaviour the slice exists to retire, and its own comment
says it was written to be retired).

Neither is a bug. Both are the store telling the truth twice and disagreeing with itself, which is
what a spec grown by landings will do, and what a landing cannot settle on its own word.
