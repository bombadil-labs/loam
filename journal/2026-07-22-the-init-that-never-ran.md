# The init that never ran

**2026-07-22.** A conformance pass over how this repo uses ADLC, prompted by a
simple question — *are we silently failing ADLC's conventions anywhere else?* —
after `spec-lint` turned out to have been linting the wrong artifact for two
weeks. The answer was yes, and the several failures shared one root.

## `adlc init` has never run here

```
$ adlc init
adlc-init: EINVAL: invalid argument, open '...\.gitignore'
```

`writeFileNoFollow` opens an existing file `O_WRONLY|O_TRUNC`, and **Windows
rejects `O_TRUNC` without `O_CREAT`**. Probed directly:

```
O_WRONLY|O_CREAT|O_TRUNC   OK
O_WRONLY|O_TRUNC           FAIL EINVAL
```

The exclusive branch (`O_CREAT|O_EXCL`) is unaffected, and that selectivity is
the whole story: init cheerfully **created** `.adlc/config.json` and
`.adlc/specs/`, then died on the first file that already existed. Half-scaffolded,
exit 1, into a log nobody re-read — the same shape as the stale plugin and the
silent `npx` failure before it. A tool that fails loudly at the wrong moment is
indistinguishable from one that was never run.

What it never reached was `.gitignore`, which is the *only* place ADLC writes
down which parts of `.adlc/` are the committed contract:

```
.adlc/*
!.adlc/config.json
!.adlc/tickets.json
!.adlc/tickets/
!.adlc/specs/
```

An allowlist. Committed: the contract. Local: `findings.jsonl`,
`manifest.jsonl`, `ticket-transactions/` — evidence gates assert against *this*
working copy, which would collide on every branch if shared. We had hand-written
an approximation, and the night before had inverted it to track everything on a
prosecutor's recommendation that did not know the convention. The reviewer's
reasoning was locally sound — under an allowlist a new evidence file is untracked
on creation with nothing in the diff to notice — but the answer to that is
`adlc init`, which adds the negation when a file joins the contract. We had
reasoned our way to a defensible answer to a question the tool had already
answered, because the tool could not tell us.

## What else was running dark

| | state before |
|---|---|
| `adlc run <phase>` | never invoked — exits **2** on all seven phases |
| gate evidence names | ours invented; **zero overlap** with what `run` asserts |
| `adlc hollow-test` | never run — the detector for the bug that bit us all week |
| `adlc accept` (P6 packet) | never used |
| P7's three gates | never run |

The evidence names are exact, so every gate we had recorded (`prosecute`,
`rails-guard`, `ticket-update`, `rails-bypass`) satisfied nothing. P5 evidence is
additionally revision- and hash-bound — it binds the ticket definition, the
transcript, and a clean-worktree revision, so it goes stale the moment the tree
moves. Prosecution must come last, and re-run after any fixup.

`hollow-test` works and earns its cost: pointed at `src/store/archive.ts` it
killed 3/3 mutants. It mutates **whatever is in the diff**, so a commit bundling
`.adlc/` evidence with code gets its JSON log lines mutated and reported as
survivors — scope it with `--target`.

## The rails backfill that would have made things worse

The obvious next move was to backfill `rails` onto the 26 tickets that declare
none. Probed first:

```
$ adlc rails-guard --base origin/main --rails "test/gateway/does-not-exist-yet.test.ts"
rails-guard: all checks passed
EXIT: 0
```

A rail glob matching no file does not fail and does not warn. It reports a pass.
So pre-declaring rail paths on `todo` tickets would have given 26 tickets a
rail-freeze that protects nothing and reports green — manufacturing the exact
vacuous-gate shape the session existed to remove.

T53 had already reached the same conclusion by a different route, and the older
reason is the better one: **a rail written by the author of already-merged code
shares that code's premise**, which is how three hollow rails shipped on
2026-07-21. Two independent arguments, one conclusion — rails are a P3 artifact,
earned when the tests exist.

`rails-guard` fails *closed* (exit 1) when it cannot determine globs, so nothing
had shipped behind a false green. The gap was never missing rails; it was that
only one ticket has ever reached P3.

## What it looks like when it works

T62 is that ticket, and on its rebased branch the mechanism caught something
unprompted:

```
rails-guard: 1 violation(s) found
  [rail-edit]   test/gateway/erase-completeness.test.ts
EXIT: 2
```

A true positive — the rail was edited after its freeze commit. On inspection the
edit removes two unused imports with the assertions untouched, so it is benign.
But it is the first demonstrated catch by that gate in this repo, and it arrived
without anyone asking the question.

## Lessons

- **A tool that half-succeeds is worse than one that fails.** Init created two
  artifacts and died on the third; the partial success is what made the
  divergence invisible for two weeks.
- **Check the vendor's defaults before reasoning from first principles.** The
  convention was shipped, in code, in a file we had installed.
- **Probe the gate before arming it.** Every gate in this pass was measured —
  including one where the first measurement was wrong: an exit code read off a
  pipeline reports `tail`, not the tool, which briefly turned a fail-closed
  `rails-guard` into a fail-open one in the write-up.
- **Untracking a file deletes it from working trees that still track it.** The
  merge removed both local ledgers; they were recovered from the pre-merge
  commit. Local-by-design evidence has no backup, so a finding becomes durable
  only by landing in `SUBSTRATE-HAZARDS.md`, `CLAUDE.md`, or here.

**Landed.** [#169](https://github.com/bombadil-labs/loam/pull/169) (working specs
as P1's instrument), [#170](https://github.com/bombadil-labs/loam/pull/170) (the
win32 `O_CREAT` patch, ADLC's allowlist, the phase-evidence table),
[#171](https://github.com/bombadil-labs/loam/pull/171) (rails are declared at
P3). [#165](https://github.com/bombadil-labs/loam/pull/165) rebased and railed,
parked as a draft pending T67.
