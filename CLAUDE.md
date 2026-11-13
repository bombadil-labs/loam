# Loam: how we work

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic).
Loam is also the testbed for rhizomatic vNext, a monorepo of tier libraries.

Read these first:

- `SPEC.md` and `spec/`: what Loam is and how it works.
- `README.md`: how to use Loam.
- `refactor/README.md`: the refactor's rulings. For refactor work it wins over this file.

## Current work

- The active work is the store arc: `spec/18-store.PROPOSAL.md` in rhizomatic, six slices.
- Loam moves onto the store in slice 5. The store arc comes before refactor step 7.
- Claude is the steward of both repos and builds in both (Myk, 2026-11-09).
- Change rhizomatic only through a PR in that repo, under its `AGENTS.md`.
- Never patch rhizomatic locally. Write no Loam workaround and no forked vocabulary.
- Record a change to what rhizomatic promises as a decision in that PR's body.
- Myk delegated store-arc decisions and merges to Claude (Myk, 2026-11-12).
- Claude also decides open refactor questions (Myk, 2026-09-29).
- Record each decision in the PR that makes it.
- Claude publishes `-next` prereleases. The two repos coordinate through them.
- ADLC is suspended for the refactor (Myk, 2026-09-25). Ignore its gates, rail freeze, ledger and
  tickets.
- Leave `.adlc/` in the tree, untouched. `docs/process/adlc.md` describes the suspended process.
- The work is greenfield. A wire change ships no migration. Loam refuses an old store at boot.

## What still needs Myk

- A change that widens what erasure purges.
- A stable npm release of Loam or rhizomatic.
- A change to what the system promises, outside the refactor and the store arc.
- Hermetic: ask Myk before you depend on it.
- For these, get Myk's word in chat. Do not infer it, however obvious it looks.

## The bar

- `npm run check` is the local bar. Capture its exit code. Do not trust a grep of its output.
- Trust the check over your sense that the work is done.
- A check that you have never seen red has proven nothing. Break the code once and watch it fail.
- CI runs `npm run check` on ubuntu and windows. Green CI is the merge bar.
- Main requires both CI checks. Confirm the run conclusion is success before every merge.
- A merge also needs a review posted on the PR by a fresh-context reviewer.
- The builder never reviews its own diff. Use a reviewer from another model family when one is
  available.
- Review again after every fix. The fix is where the next defect usually is.
- Commit and push freely on a feature branch. Never commit to `main` directly.
- Build each PR in its own git worktree. Never change the branch of the main checkout.
- Do not reward-hack the bar. A test that passes without the behavior is a bug.
- Ship real vertical slices. Do not gold-plate.
- Write the code as small as it can be without dropping a behavior.
- Audit after major work, with 3 or 4 scoped angles. The `review-a-diff` skill has the shape.

## Erasure

Erasure keeps its full provable guarantee (Myk, 2026-07-25). Do not reopen that decision.

- A change that makes an erasure report more honest merges on the ordinary bar. Examples: refuse
  where it used to claim, fail closed where it used to assume, or name a gap it cannot close.
- A change that widens what gets purged is Myk's merge, every time. Examples: a new tier in the
  sweep, a bigger condemned set, a wider fan-out.
- The test: could this change remove a delta that would have survived before? Then it widens.
- No such change is obviously fine. A wrong purge cannot be undone.
- That PR states in one line what can now be deleted that could not be deleted before.
- Every erasure test is two-sided. The target is gone, and a named live bystander survives.
- Never erase data that you did not create in your own temp dir (`mkdtempSync`).
- Never touch `~/.loam` or `demos/village/homes/`. Verify against fixtures only.
- Judge an erasure change by one question: can this report be false? (hazard H7)

## Code and tests

- The code carries no comments (Myk, 2026-11-12). `npm run check` refuses a comment.
- Only tool directives stay, in their exact allowed form. `scripts/strip-comments.mjs` lists them.
- A hazard goes in `src/gateway/SUBSTRATE-HAZARDS.md`. History goes in the journal or the commit.
- A test title says what the test asserts. A known gap goes in the title: `[gap: ...]`.
- If a missing comment causes a real defect, record it in the journal. Then propose a rule change.
- Assert at both levels: the deltas in the store, and what a View or an endpoint answers.
- A flaky test is fixed now. It outranks the task in hand. The `write-a-rail` skill has the method.
- A pulse is not a fact (SPEC §49.1). A periodic writer supersedes one standing record in place,
  or it writes nothing on a no-op cycle.
- Each periodic writer owes a quiet-cycle test. `test/federation/pulse-law-audit.test.ts` is the
  shape.
- Use the plain words in `refactor/GLOSSARY.md`. Fix the words in every file you touch.
- Match rhizomatic's names: `HyperSchema`, `HView`, `View`, `Schema`, `Policy`, `DerivedFn`,
  `BindingSpec`.
- A Schema resolves a HyperView into a View. A Policy is the rule for one property.
- No exported type is named Lens. Write `Schema` when you mean the Schema.
- The at-rest schema vocabulary is `rhizomatic.hyperschema.*`.
- Errors, help text and docs are craft. Write them with care.

## Writing

- Text for Myk uses STE style (ASD-STE100). This covers chat, open questions, PR bodies, commit
  messages, journal entries and the board.
- Technical names (delta, schema, rail, door, operator) are permitted as domain terms.
- Write one instruction per sentence. Use 20 words or fewer. Use active voice and simple tenses.
- Use no metaphor. Give each word one meaning. Prefer a list to a paragraph.
- A PR body has this shape: one sentence of what it does; WHAT CHANGED as a list; WHY, one reason
  per sentence; the tests; what to read.
- Name each risk in its own sentence. Delete a sentence that only sets a mood.
- A PR that Myk must read carries a few hundred lines of decisions at most.
- Land bigger work as a stack of small PRs. Put the mechanical bulk in its own PR or commit.
- Ask Myk in plain chat text, with options and a recommendation.

## Where things live

- The root holds four markdown docs: `README.md`, `CLAUDE.md`, `SPEC.md`, `JOURNAL.md`.
- `SPEC.md` is the index over `spec/NN-slug.md`, one file per section.
- `spec/` records what is. Only a landing PR adds to it, with a `**Provenance.**` footer.
- Never renumber a spec section. Other files cite sections by number.
- `journal/<date>-<slug>.md` holds decisions and learnings that a PR cannot carry. It is
  append-only.
- `refactor/` holds the refactor: `README.md`, `MAP.md`, `GLOSSARY.md`, `audit/`, `recordings/`.
- `src/gateway/SUBSTRATE-HAZARDS.md` lists the known hazards, H1 onward.
- `.claude/agents/loam-*.md` are the review lenses and the verifier.
- `test/helpers/session-fixture.ts` is the one place for login fixtures in server tests.
- `demos/village/` is parked. Do not extend it.

## Skills and reference docs

- `.claude/skills/review-a-diff`: load before you review a diff or ask for a review.
- `.claude/skills/write-a-rail`: load before you write or repair a test, or fix a flaky one.
- `.claude/skills/land-a-pr`: load before you merge a PR or write a `spec/` section.
- `docs/process/adlc.md`: the suspended ADLC lifecycle. Read it only if Myk resumes ADLC.
