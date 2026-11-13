---
name: land-a-pr
description: Use when you are about to merge a Loam PR, when a PR adds a spec/ section or SPEC.md row, when you decide whether a journal entry is owed, or when you clean up after a merge. Gives the merge checks, the spec landing shape, the capabilities-book claim, and stacking.
---

# Land a PR

## Before the merge

1. `npm run check` exits 0 locally. Capture the exit code, not a grep of the output.
2. The PR has a posted review from a fresh-context reviewer at the current head SHA.
3. Every finding is fixed and reviewed again, or answered on the PR.
4. CI is green on ubuntu and windows. Read the run conclusion: `gh pr checks <n>`.
5. The PR needs none of Myk's merges. Myk merges a PR that widens what erasure purges, ships a
   stable release, adds a dependency on hermetic, or changes what the system promises outside the
   refactor and the store arc.
6. The PR body is in STE, in the shape that `CLAUDE.md` gives.

Then merge with `gh pr merge <n> --squash`. If the harness blocks a merge, stack the next PRs on
this one and report the block. Do not work around it.

## A PR that adds to spec/

`spec/` records what is. Only a landing PR writes it. In the same PR:

- Add a new file `spec/NN-slug.md`. Edit an existing section only for a fix or a correction.
- Use the next free number. Never renumber a section.
- Write it as narrative for a reader: what the system does now, not a plan.
- End it with a `**Provenance.**` footer: the PR links, the implementation files, and the tests.
- Add its row to the index table in `SPEC.md`.
- Add one claim to the capabilities book. `test/site/capabilities.test.ts` fails until you do.
  - Add the section to the `covers` list of one chapter in `demos/capabilities/chapters.mjs`.
  - Add one `{says, spec, proof}` claim. `says` is the promise in plain words.
  - `proof` is a test path.
  - The test failure message gives the same recipe.

## A refactor PR

- Update `refactor/MAP.md` when the PR changes the refactor's state.
- `node refactor/tools/map.mjs` writes `map.svg`. Set its `UPDATED` date.
- `npm run census` and `npm run peer-probe` run inside `npm run check`. Read their output.

## The journal

Write a journal entry only when the PR cannot carry the content:

- a decision that Myk made in chat;
- a synthesis across several PRs;
- a learning with no other durable home.

A routine landing writes no entry. Its PR and commit message are its history. An entry is a new
file `journal/<date>-<slug>.md`, in STE. Never edit an old entry.

## Stacks

- Myk reads a few hundred lines of decisions at most. Split bigger work into a stack.
- Put the small, clear parts first. Put each judgment call in its own small PR.
- Give each judgment PR a review guide: the seam in one sentence, the decisions as a list, and what
  to skim.
- Put the mechanical bulk last. Merge it on its evidence after the decisions are in.

## After the merge

- Remove the PR's worktree: `git worktree remove <dir>`. Delete the local branch.
- If the worktree has uncommitted work, save it as a patch in the scratchpad first.
- Never change the branch of the main checkout.
