# Sixteen pull requests, one main — what parallel agents taught the merge discipline

**2026-07-31.** An overnight autonomous run landed §36 phases 5–8 while spun-off worktrees worked
findings from those same phases. By morning sixteen pull requests were open across six independent
workstreams, several touching the same three files. All sixteen are now reconciled: eleven merged,
two closed as duplicates, three superseded by rebased replacements. `main` is green — 1685 passed,
4 skipped, 0 failed.

This entry records what the reconciliation taught, because none of it is in CLAUDE.md and the next
fan-out will hit all of it again.

## Two agents found the same defect from opposite directions

`POST /session/token` reported `expiresIn` from a fresh clock read while its comment claimed the
value came from the deadline the token table recorded. Two agents found it independently — one
through a P5 erasure lens on the phase-8 diff, one working the bearer bridge directly — and wrote
the same fix: `mint` returns `{token, expiresAt}`.

The rebase resolved the duplication by itself. The code hunks vanished as already-applied, and what
survived was the part that was NOT duplicated: a 159-line rail with a stepping clock that makes the
gap deterministic instead of a race on request latency. The phase-8 PR fixed the arithmetic; it did
not add a test that could see the defect return. The duplicate did.

**The lesson: a duplicate is not waste until you have checked which half of it is unique.** The
instinct is to close the later PR. Rebasing first turned a duplicate into pure additive coverage.

## Three agents fixed one bug three ways, and the tiebreaker was not correctness

`test/cli/serve-host.test.ts` probed `127.0.0.2`. Linux routes all of 127/8; macOS aliases only
`127.0.0.1` on `lo0`. The rail died on a 10s timeout on every Mac while CI stayed green — the
red bar this repo had been re-running past for a full session.

All three agents diagnosed it correctly, and all three independently found the second defect
hiding behind the first: the NARROW-bind half was hollow on macOS. It asserts `127.0.0.2` is
refused, and there that address refuses because it does not exist — so the assertion could not tell
a narrow bind from a wide-open one, and would have kept passing if the default bind were widened.

They differed on the remedy, and the tiebreaker was neither cleverness nor coverage:

- Two edited the frozen rail directly. Both are red on rails-guard.
- One landed as the authorize-then-repair pair CLAUDE.md prescribes, and **re-froze** at the end.

The pair won. The sharpest audit of the three — measured mutants, a named known-red condition —
belonged to a PR that could not merge. **Process compliance is a tiebreaker that beats analysis
quality, and that is the correct ordering**: a repo where the best analysis can bypass the gate has
no gate.

The runner-up's remedy also lost on a product ground worth recording: it fell back to a real network
interface, which gives Mac coverage but goes red behind a host firewall. The chosen fix SKIPS both
halves and names the hole in the header. Per the flake rule, a bar that is sometimes red trains
people to re-run instead of investigate; a visible skip does not.

## The rename exemption worked, end to end, for the first time

Two stacks needed to correct overclaiming comments inside frozen rails. Both used
`scripts/rail-renames.json`: land the declaration, then land the substitution. rails-guard
synthesizes a base with the substitution applied, sees an empty diff, and passes.

It works exactly as designed. Two things the mechanism does not cover, learned by hitting them:

1. **It expresses only substitutions.** An ADDITION cannot be declared — no entry makes
   `base + rule == branch` when the branch adds lines. Phase 8 needed to add fixture setup to
   phase 7's frozen rail (a later phase's precondition made the older fixture unrealistic), and no
   declaration could turn that green. It landed as an isolated PR whose whole diff was 22 lines,
   with a blessed red gate. If additions recur, the declaration file needs an authorized-addition
   form — a change to the enforcement tool, and therefore a decision rather than a patch.
2. **Concurrent stacks collide in the declaration file.** Two agents each appended to an empty
   `renames` array from the same base. The second conflicts on rebase. The resolution is trivial
   (keep both; they target different files) but it is a manual step, and a fan-out of N
   rail-correcting agents produces N−1 of them.

## GitHub closes a PR when you delete its base branch

Three stacked PRs auto-closed mid-reconciliation, and a closed PR cannot be retargeted — the API
refuses both `reopen` and `edit --base`. Each needed a fresh PR carrying the same commits.

**Merge a stack bottom-up without `--delete-branch` on any but the last**, or accept re-opening
replacements. Cheap once known, confusing the first time.

## The gate that had never read our source

`adlc hollow-test` — the tool CLAUDE.md calls "the shipped detector for our worst recurring bug" —
could not mutate TypeScript. Its include-list named `mjs`, `cjs`, `js`. Loam's `src/` is entirely
TypeScript. Every `--target` invocation this repo ever made exited 1, and diff-scoped runs dropped
every `.ts` file silently and reported zero mutants as a PASS.

A green that proves nothing is the exact failure hollow-test exists to detect, and it was reporting
one about itself. Now patched locally (`npm run adlc:patch`), verified by watching it mutate a real
`.ts` file and report survivors.

The phases that landed tonight were prosecuted with HAND-WRITTEN mutants because of this — each one
named with the rail that must kill it. That worked, and it was slower and narrower than the tool.
**CLAUDE.md's own rule caught this in the end: a gate you have never seen red has proven nothing.**
The corollary this adds: a gate you have never seen red *on your own source* has proven less than
that.

## What reconciliation cost, and what it bought

Eleven merges, each rebased onto the true new `main`, each re-verified before landing. The ticket
store recomputes hashes on every write, so the merges had to be SERIAL — two in parallel leaves the
second's recorded hashes stale and the `adlc` gates reject it. That is a real constraint on fan-out
width that `merge-forecast` does not model: it forecasts FILE conflicts, not shared-mutable-state
conflicts in the store itself.

What it bought: a fully green bar on a Mac for the first time in the session, a mutation gate that
reads our language, two dead-code claims retired, three overclaiming comments corrected, and a rail
for a defect two agents found and neither had covered.

**Provenance.** Reconciliation of PRs #295–#314 against `main`, 2026-07-31.
