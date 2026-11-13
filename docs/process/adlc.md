# ADLC in Loam

**Suspended for the refactor (Myk, 2026-09-25). Kept for the day it resumes.**

Do not run these gates, freeze tests, record evidence or write tickets while the suspension holds.
Leave `.adlc/` in the tree, untouched. The rules that outlive ADLC are in `CLAUDE.md` and in
`.claude/skills/`. This file keeps only what was true of Loam's ADLC setup and is still accurate.

## What ADLC is

ADLC is the Agentic Development Lifecycle, from the `@adlc/cli` package. It runs work through
phases. Each phase has gates. A gate is a CLI, and its exit code is the verdict: `0` pass, `2` fail,
`1` operational error. Run `adlc --help` for the tools and `adlc <tool> --help` for flags. The
`adlc` skill from the ADLC plugin is the authority when it loads. Plugins do not load in a WSL
session. The CLI works there.

| phase | gates |
|---|---|
| P0 Triage | `adlc ticket create` |
| P1 Interrogate | `spec-lint`, `premortem`, `parallax`, `review --input` |
| P2 Decompose | `coldstart`, `model-router`, `merge-forecast` |
| P3 Rail | `rails-guard`, `hollow-test` |
| P4 Build | `flail-detector`, `consensus-fix` |
| P5 Prosecute | `hollow-test`, `behavior-diff`, `review-calibration`, `review`, `prosecute` |
| P6 Integrate | `accept`, `gate-manifest show`; a human decision |
| P7 Distill | `lesson-foundry`, `rejection-mining`, `skill-rot` |

## Who answers an LLM-backed gate

- Answer it yourself (`--prompt-only`) when it judges the artifact: `coldstart`, `model-router`,
  `merge-forecast`, `spec-lint`.
- Never answer it yourself when its value is a second view: `review`, `prosecute`, `premortem`,
  `parallax`. Spawn a fresh-context reviewer. The `review-a-diff` skill has the brief.
- `prosecute` only records what it is given. Record only what a reviewer actually returned.
- The plugin gives the `adlc:prosecutor-*` agents. The project lenses in `.claude/agents/` work
  without the plugin.

## Phase evidence

Record with `adlc gate-manifest record <gate> --ticket <id>`. Assert with
`adlc run <phase> --ticket <id>`. The gate names are exact. A record under another name satisfies
nothing.

| phase | required evidence |
|---|---|
| `p1` | `spec-lint`, `premortem` |
| `p2` | `coldstart`, `merge-forecast` |
| `p3` | `rails-red`, `hollow-test`, `rails-frozen` |
| `p4` | `rails-green`, `rails-check`, `flail-check` |
| `p5` | `p5-complete` |
| `p6` | `p5-complete`, `p6-acceptance-packet` |
| `p7` | `lesson-foundry`, `rejection-mining`, `skill-rot` |

P3 to P6 also need a ticket. P5 and P6 also need a revision. The P5 record binds the ticket, the
transcript and a clean-tree revision by hash. It goes stale when the tree moves.

## The store

- `.adlc/` is an allowlist in `.gitignore`. `adlc init` owns that block. Do not edit it by hand.
- `.adlc/*` must stay above every negation. Git takes the last match.
- Committed: `config.json`, `tickets/`, `ticket-archive/`, `specs/`, `manifest.jsonl`,
  `manifest.d/`.
- Local to a worktree: `findings.jsonl`, `ticket-transactions/`.
- A ticket is one JSON shard in `.adlc/tickets/`. Change it with `adlc ticket update`. Pass an
  explicit `id` (for example `T301`) to `adlc ticket create`, or it mints a ULID.
- A realized ticket is archived with `adlc ticket archive <id> --write --authorize`. Never delete
  it.
- Evidence lives in the segmented store `.adlc/manifest.d/`, keyed. Writing a segment needs
  `ADLC_MANIFEST_KEY` in the environment.
- `adlc gate-manifest verify` needs `--allow-legacy-unsigned`. The first 290 entries were never
  signed. One signed `manifest-cutover` record attests them.

## Working specs (P1)

- A working spec lives at `.adlc/specs/NN-slug.md`. It becomes a `spec/` section only at landing.
- It opens with user stories from Myk: the actor, the action, and the result a person sees.
- It has an `## Acceptance criteria` heading. Each criterion names its test path or command.
- `spec-lint` fails a criterion with no method. `--llm` also catches a vacuous method.
- A nested bullet under a criterion lints as its own criterion. Use (a), (b), (c) inline.
- Each user story becomes an end-to-end test of the real surface.
- After P1, stop. Wait for Myk's word in chat before you write implementation code.

## Rails (P3)

- The criteria of the working spec are the test list.
- Declare a ticket's `rails` only when the test files exist. A glob that matches nothing passes.
- `hollow-test --rails` wants a single-ticket JSON. The sharded store is not one. Use `--target`.
- Before the refactor, CI froze a landed ticket's rails. That CI job and its script are gone.

## Merging under ADLC

- The model merged a repair that restored stated behavior: green bar, clean P5, clean audit.
- Myk merged every design-stage section, and every change to what the system promises.
- A design-stage ticket drafted its `spec/` section and answered each "(Myk)" question with a
  recommendation. Myk decided in the PR.
- `adlc merge-forecast` gave the build order and the safe number of parallel worktrees.
- After a landing, re-read the remaining tickets. Edit a ticket body when a learning changes it.

## Lessons (P7)

- `.adlc/findings.jsonl` is local and uncommitted. A lesson there is not durable.
- A lesson becomes durable in `src/gateway/SUBSTRATE-HAZARDS.md`, a skill, `CLAUDE.md`, or the
  journal.
