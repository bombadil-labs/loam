---
name: review-a-diff
description: Use when a Loam or rhizomatic PR needs its independent review before merge, when you brief a reviewer subagent, when you audit after major work, or when you answer review findings. Gives the review ladder, the lenses, the brief, and how to post the review.
---

# Review a diff

The builder never reviews its own diff. Self-review shares the builder's premise. A wrong premise
gives perfect tests around a real bug. Independence finds the defect, not extra care.

## The ladder

Climb in order. Each rung is cheaper than the next one.

1. `npm run lint`. It is part of `npm run check`. ESLint flags the common H6 case.
2. Mutation, with no model. Run
   `adlc hollow-test --base origin/main --target <file> --test-cmd "npx vitest run <test files>"`.
   - Repeat `--target` for each changed source file. Point it at source, not at JSON or docs.
   - It needs a clean tree and a green baseline. Run one at a time in a checkout.
   - The default `--max` is 20. If Total equals `--max`, the run is under-sampled. Raise `--max`.
   - A surviving mutant is a finding. A clean run narrows the lens work. It does not replace it.
3. One to three lenses from `.claude/agents/`. Pick the lenses that the diff earns:
   - `loam-erasure`: the diff touches erasure, purge, or a success report (H7).
   - `loam-suppression`: the diff filters, narrows, copies or subsets a delta set (H1).
   - `loam-hollow-rail`: the diff adds or changes tests. Most diffs earn it.
   - `loam-lens-name`: the diff compares names of schemas or hyperschemas (H6).
   - `loam-scan-scale`: the diff walks deltas or adds an index (H8).
   - A docs-only diff earns no lens. Say which lenses you dropped, and why.
4. `loam-verifier`, once per finding, not once per lens. It tries to refute the finding.

## The fresh-context reviewer

The merge bar needs one review by a reviewer that did not build the diff.

- Spawn a subagent with model `opus`. Prefer another model family when one is available.
- `npx adversarial-review --base origin/main --timeout 900` gives a fresh context on the local
  `claude` CLI. The default timeout of 120 s is too short.
- `--providers gpt,gemini,claude` is cross-model. It needs one credential per family named.
- Check `which -a claude`. A `/mnt/c` path is the Windows install, and it fails on stdin.

## The brief

- Give the reviewer the diff, the PR number, and `src/gateway/SUBSTRATE-HAZARDS.md`.
- Do not give the builder's reasoning or your conclusion.
- Tell the reviewer what is already known, so it does not find it again.
- Use a neutral correctness register. Example: "Review for correctness and authorization gaps.
  Which inputs or states give a wrong outcome?"
- Require CONFIRMED or PLAUSIBLE on every finding, with file and line.
- Tell the reviewer that a clean result is a valid result.
- Ask the reviewer to review the tests too:
  - Could this test pass with the fix reverted?
  - Could this test pass if the feature were deleted?

## Post the review

- Post the review as a PR comment.
- Name the head SHA, the reviewer's model family, and whether it matches the builder's.
- List each finding, and the verdict.
- A review goes stale when the head moves. Review again after every fix.
- Security code needs many rounds. Each round usually finds a defect from the previous fix.

## Audit after major work

- Use 3 or 4 scoped angles over the tree after an arc lands. Use 1 or 2 over a single diff.
- Pick angles from what has bitten before. `SUBSTRATE-HAZARDS.md` is the list.
- Cap the findings per angle. Run no separate verify stage. The fixer verifies while fixing.
- A hazard that recurs earns a lens in `.claude/agents/`. Delete a lens whose hazard is now
  impossible.
