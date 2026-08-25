## 48. The tutorial — a store of your own

The tutorial is a fifteen-lesson arc that hands a stranger a real governed store in a browser
tab and teaches Loam by having them keep a diary in it. Its spine is a domestic problem, not a
feature list: you and Rae share a couch and incompatible film takes, and no app lets both
truths coexist. Every capability enters as the answer to a need that story produces — the
rewatch that would make any other app choose which of your opinions to erase, the housemate
whose heresy must not overwrite your history, the movie night your record shape cannot yet
describe, the pasted private message that should never have landed at all.

### 48.1 Steps prove themselves, at both levels

A lesson plays one step at a time. Each step frames itself three ways — what we have, what we
want, how we get there — and completes only when two observations hold: one over the **page**
(a selector rooted at an element the shell declares, rendering from the store) and one over
the **store** (a predicate over the ground). Prose is never compared to the DOM it produced;
the naive rail there is a tautology, proven during design. A failed page observation retries
without re-running the act, so an irreversible step cannot be performed twice by a confused
click. The satisfiability rule is law and mechanically enforced: a page observable must hold
in every store state where the store observable holds — state, never event — because an
observable true only in the instant after its own act is a trap on any step whose act cannot
be undone. A headless rail checks every selector against the shell at authoring time.

### 48.2 The tutorial's memory is the student's store

Progress, quiz answers, glossary entries, and checkpoint records land as ordinary signed
claims under a `tutorial.*` vocabulary in the student's own tab store. The player holds no
parallel state: resume after closing the tab reconstructs from claims alone, railed by a
falsifier that deletes everything else and reloads. The growing glossary — twenty-one terms,
each introduced in plain words before its first bare use, with a vocabulary scan that reds a
lesson slipping a term early — is itself a lens over glossary claims. Lesson eleven is the
reveal: the student opens the Ground pane and finds the glossary and their own progress have
been claims all along, and the thing they have been reading finally gets its real name. A
record here is called a delta.

### 48.3 Revert is a checkpoint, and forgetting sweeps it

The student can revert to any lesson boundary: a frozen export per boundary, restored by
re-seeding the store and reloading the page. A checkpoint blob is written before the claim
that announces it, so the ledger never asserts a checkpoint nothing backs. Restores are
write-first, remove-second; erasure receipts and the strikes that forgave them survive an
undo in both arrangements, because a revert that re-asserted a withdrawn forgetting would
break the store's own law. And the finale is the arc's hardest honesty: erasing the pasted
message destroys, on screen and by name, every checkpoint that held its bytes — a checkpoint
is a copy, a copy holds the bytes, and a right to be forgotten that spares your undo button
is a lie. The sweep's report is a durable reading over the store — boundaries whose claims
have no blob behind them, blobs proven to hold none of the forgotten bytes — never latched
interface state, so it says the same thing after a reload. The homecoming closes the arc: the
store exported, pulled on the student's own machine, identical hash for hash — with the
erasure traveled, the receipt intact, and the diary whole.

### 48.4 The player and the arc are separate contracts

The player knows nothing about the arc: the browser suite walks whatever lessons are loaded,
targeting mechanics by declared roles (opening, reveal, erasure-finale), so the arc's content
landed against a frozen suite without editing it. The advanced journey — containers,
federation, two stores meeting — is deliberately a sequel (T225), trailed by the arc's last
screen: Rae's getting a store of their own.

**Provenance.** Designed in [#450](https://github.com/bombadil-labs/loam/pull/450) (the
working spec, with an independent premortem folded), scripted in
[#461](https://github.com/bombadil-labs/loam/pull/461) (the Myk-approved arc script), built in
[#463](https://github.com/bombadil-labs/loam/pull/463) (the player) and
[#464](https://github.com/bombadil-labs/loam/pull/464) (the fifteen lessons). Implementation:
`demos/tutorial/` (`player.mjs`, `app.mjs`, `lessons.mjs`, the role contract in the README).
Rails: `test/browser/tutorial.test.ts` and `tutorial-driver.ts` (frozen with T226),
`test/site/arc.test.ts` (frozen with T227), plus the site build checks. The working spec and
arc script remain at `.adlc/specs/48-*.md` as the design record.
