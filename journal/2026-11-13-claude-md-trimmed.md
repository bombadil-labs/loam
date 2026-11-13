# CLAUDE.md is short

*2026-11-13. Claude, under a ruling from Myk in chat: "trim CLAUDE.md, remove anything stale and
also just tighten it up". The pull request carries the mechanics.*

## Sizes

- `CLAUDE.md` fell from 49,625 bytes to 6796 bytes.
- Every session and every subagent loads `CLAUDE.md`. The cut saves those bytes on every run.
- Three project skills hold the procedures. A skill loads only when its task starts.
- `docs/process/adlc.md` holds the suspended ADLC process.

## How to read the old text

Run `git show c17acf6d:CLAUDE.md`. That is the last commit before the trim. The old anecdotes,
dated stories and measured tables stay there. This entry does not copy them.

## What moved where

| Old rule | New home |
|---|---|
| What Loam is; read SPEC.md and README.md | `CLAUDE.md` |
| Refactor header: steward, delegation, prereleases, store arc | `CLAUDE.md`, Current work |
| ADLC suspended; greenfield, no migration | `CLAUDE.md`, Current work |
| rhizomatic changes only through a PR under its `AGENTS.md` | `CLAUDE.md`, Current work |
| Merge bar: green CI and a fresh-context review | `CLAUDE.md`, The bar; `land-a-pr` |
| `npm run check` is the bar; read the result | `CLAUDE.md`, The bar |
| Commit and push freely on a feature branch | `CLAUDE.md`, The bar |
| No reward-hacking; vertical slices; small code | `CLAUDE.md`, The bar |
| Audit after major work, the retro shape | `CLAUDE.md` (one line); `review-a-diff` |
| Erasure: honest reports vs wider purges | `CLAUDE.md`, Erasure |
| Erasure: one-line "what can now be deleted" | `CLAUDE.md`, Erasure |
| Erasure: two-sided rails | `CLAUDE.md`, Erasure; `write-a-rail` |
| Erasure: only your own temp dir | `CLAUDE.md`, Erasure; `write-a-rail` |
| No comments; tool directives; gaps in test titles | `CLAUDE.md`, Code and tests |
| Assert at both levels, delta and object | `CLAUDE.md` (one line); `write-a-rail` |
| A flaky test is fixed now | `CLAUDE.md` (one line); `write-a-rail` |
| A pulse is not a fact | `CLAUDE.md`; `write-a-rail` |
| Match rhizomatic's vocabulary; "Lens" is prose | `CLAUDE.md`, Code and tests |
| The poetry rule | `CLAUDE.md`, Code and tests |
| STE for text to Myk; the PR body shape | `CLAUDE.md`, Writing |
| A PR for Myk is readable; stack small PRs | `CLAUDE.md`, Writing; `land-a-pr` |
| Root holds four markdown docs | `CLAUDE.md`, Where things live |
| `spec/` grows only by a landing, with Provenance | `CLAUDE.md`; `land-a-pr` |
| Reserved section numbers; never renumber | `CLAUDE.md`; `land-a-pr` |
| The journal: one file per entry; when one is owed | `CLAUDE.md`; `land-a-pr` |
| The session fixture (T152) | `CLAUDE.md`; `write-a-rail` |
| The village is parked | `CLAUDE.md`, Where things live |
| Capabilities book claim per new spec section | `land-a-pr` |
| `rails-red` is a measurement; the revert probe | `write-a-rail` |
| User stories become end-to-end tests | `write-a-rail`; `docs/process/adlc.md` |
| The review ladder; the `loam-*` lenses; the verifier | `review-a-diff` |
| `hollow-test` with `--target`; scope it to source | `review-a-diff` |
| `adversarial-review`: tiers, `--providers`, `--timeout 900` | `review-a-diff` |
| A `/mnt/c` `claude` on PATH fails | `review-a-diff` |
| Neutral correctness register for review prompts | `review-a-diff` |
| Review the tests; re-review after every fix | `review-a-diff` |
| A hazard that recurs earns a lens | `review-a-diff` |
| Phases, gates, exit codes, phase table | `docs/process/adlc.md` |
| Who answers an LLM-backed gate | `docs/process/adlc.md`; `review-a-diff` |
| Phase evidence names; revision-bound P5 | `docs/process/adlc.md` |
| `prosecute` records only what it is given | `docs/process/adlc.md` |
| `.adlc/` allowlist; `adlc init` owns it; order | `docs/process/adlc.md` |
| Forest mode; `ADLC_MANIFEST_KEY`; legacy entries | `docs/process/adlc.md` |
| Tickets: shards, update, archive, never delete | `docs/process/adlc.md` |
| Working specs; criteria name their test | `docs/process/adlc.md` |
| Stop for Myk after P1 | `docs/process/adlc.md` |
| Declare rails only when the tests exist | `docs/process/adlc.md` |
| Merge by risk; design-stage tickets; "(Myk)" calls | `docs/process/adlc.md` |
| Autonomous loop; merge-forecast width | `docs/process/adlc.md` |
| P7: `findings.jsonl` is not durable | `docs/process/adlc.md` |

## What was deleted as stale

- The three local `adlc` patches and `npm run adlc:patch`. #575 removed the scripts. `@adlc/cli`
  1.11.0 reads TypeScript and guards `invert-comparison` itself.
- "Keep the tooling current" and its upgrade ritual. It served the patches.
- `npm run p5` and `scripts/p5-triage.mjs`. #575 removed both. `review-a-diff` gives the routing.
- The CI rail backstop text. #575 and #700 removed the job and the text.
- "To resume, route through the `adlc` skill" as the default. ADLC is suspended.
- The design-stage spine §21 to §24. All four sections landed: `spec/21` to `spec/24`.
- The Windows argv limit for `adversarial-review`. Sessions run on Linux and WSL now.
- "Self-review is the exception; justify it in the PR". The merge bar now forbids it.
- "If no reviewer is available, say so in the PR". The merge bar needs a review to merge.
- "Comments explain the code". #700 replaced it with the no-comments rule.
- The struck migration rule. Only its greenfield replacement stays.
- "`@bombadil/loam` stays private until Myk publishes". It is published, 0.4.0 to 0.7.0.
  `package.json` has no `private` field. `release.yml` publishes on a tag.
- "v1 is fully multi-tenant" and "Chorus is reference-only". SPEC §7, §10 and §28 hold both.
- The Policy and PropPolicy names from before rhizomatic 0.3.0. They are history.

## Pointers fixed

- `README.md`: the CLAUDE.md link no longer says "the ADLC lifecycle".
- `JOURNAL.md`: the neutral-register note points at `review-a-diff`.
- `docs/project-context.md`: current work is the refactor; `.adlc/` is suspended.
- `docs/wsl-migration.md`: the fallback phase index is in `docs/process/adlc.md`.
- `demos/village/README.md`: the village is parked.
- `.gitignore`: `.claude/skills/` is tracked, beside `.claude/agents/`.
