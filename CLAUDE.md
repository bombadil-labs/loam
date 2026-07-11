# Loam — how we work

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic); the
design is in **[SPEC.md](SPEC.md)** and the usage in **[README.md](README.md)** — read them before
writing code. This file is the **process**. **[CURRENT_WORK.md](CURRENT_WORK.md)** is the live
checklist for the work in progress. **[JOURNAL.md](JOURNAL.md)** is the append-only record.

The original v1 plan (build steps 0–9) is **complete** — all merged; the journal is its record.
This file no longer carries a plan; it carries the loop any future work runs. **To resume:** read
`CURRENT_WORK.md`. If work is in progress, continue from the "left off here" note. If it is empty,
there is no work queued — ask Myk what to build next, then open it at cycle stage 1.

## Hard limits

- **rhizomatic is frozen/normative** — never edit it from here. Most of Loam's core lives there
  already (SPEC §2); a genuine substrate need is a PR in that repo + a conversation with Myk.

## The loop — one step at a time (a `/loop` runs this until the plan is done)

For the current step, run this cycle. It may span several loop cycles; **before ending any cycle,
update `CURRENT_WORK.md`** so the next run resumes exactly here.

1. **Plan.** Replace `CURRENT_WORK.md` with a checklist for this step: its success criteria, then the
   concrete sub-tasks. This is the contract for the step.
2. **Tests first.** Write clean, honest tests that capture everything in the plan — the behavior the
   step must exhibit, asserted against real outcomes, not against the shape of the implementation. No
   reward-hacking: a test that can pass without the desired behavior is a bug.
3. **Implement.** Write the code to make the tests pass. Concise, not cryptic — as small as it can be
   **without dropping a desired behavior**. Keep `CURRENT_WORK.md` current as items complete.
4. **Green → PR.** When the gate passes — `npm run check` (format + lint + typecheck + **all** tests;
   read the counts, never trust a silent grep) — commit to a **new feature branch** and open a PR.
5. **Review.** Run a strict review against: (a) is the code high-quality, concise, efficient —
   no dead weight, no cleverness that hides behavior; (b) are any tests misaligned with the
   step's goals; (c) are there missing tests. **Frame review prompts and finding-summaries in a
   neutral correctness register** — "review for authorization and correctness gaps; what inputs
   or states produce a wrong outcome" — rather than role-playing an opponent trying to defeat the
   system. The neutral framing finds the same issues and reads far less like offensive security
   to a content classifier; the sharper framing was only ever stylistic. **Budget: one careful
   review agent per PR** (self-review directly for small mechanical diffs); a 2–3-angle panel only
   for the riskiest steps (capabilities/auth, federation). Token spend must last the whole plan.
   **Audits are paused** (Myk, 2026-07-09): audit 1 (after PR #5) cost ~5% of the total token
   budget — no further audit panels until every queued step and the landing are done. Before any
   future audit, apply audit 1's retro: the per-finding verify stage was ~80% of the cost and
   refuted only 1 of 24 candidates (the finders were already precise), and three findings were
   discovered by multiple overlapping angles. A future audit is 3–4 tightly-scoped finder angles,
   NO verify stage (the fixer verifies while fixing), findings capped per angle.
6. **Resolve → merge.** If step 5 generates feedback, take it into consideration and go back to step 1,
   and feed forward; confirm the PR is genuinely good. Append a record to `JOURNAL.md` (what was done +
   any novel learning).
7. **The village.** Extend `demos/village/` — the living demonstration, see `demos/village/README.md` —
   so the village *exercises the behavior this step added*, end-to-end and ambitiously: new
   acts, new stores, new lenses, whatever makes the feature visible in a running federated
   world. RUN what you added; update the demonstration ledger in `demos/village/README.md` with what
   changed and what it now shows (Myk, 2026-07-09: with each new PR, document how you've
   updated the village). `demos/village/homes/` stays untracked (stores and seeds are disposable);
   the village's code and docs ride the step's PR.
8. **Re-plan.** With the step done, re-evaluate the **remaining** steps against anything you just learned.
   If a learning changes the plan, edit SPEC.md to take it into consideration, log the change in 
   `JOURNAL.md`, and commit it.
9. **Next step.** Clear `CURRENT_WORK.md` and begin the next unchecked step at stage 1.

## Standing rules

- **Root holds exactly five markdown docs** — `README.md` (the vision), `CLAUDE.md`, `SPEC.md`, `JOURNAL.md`,
  `CURRENT_WORK.md`. Do not accumulate more markdown; fold, don't add. `CURRENT_WORK.md` is intended to be 
  ephemeral and evolving, PRs hold prior snapshots, don't be afraid to blow it away as necessary.
- **Strict in PRs, creative and aggressive in execution.** Ship real vertical slices; don't gold-plate;
  don't reward-hack a green bar.
- **Match rhizomatic's vocabulary** — the concepts are Hyperschema / Hyperview / View / Policy /
  derived function / binding; the exported type names are `HyperSchema`, `HView`, `View`, `Policy`,
  `DerivedFn`, `BindingSpec` (confirmed in the step-1 spike). Don't parallel either with
  near-synonyms.
- **The poetry is as important as the engineering** — errors, help text, commit messages, and docs are
  first-class craft.

## Standing decisions

- **v1 is fully multi-tenant** (SPEC §7) — tenant isolation is first-class in the genesis schemas
  and gateway enforcement (Myk, 2026-07-09).
- **Chorus is reference-only** (SPEC §10) — read its plumbing as a design guide; Loam's code is
  written clean, against Loam's own tests.
- **`@bombadil/loam` publishes to npm** for turnkey install. The package is kept `"private": true`
  until Myk runs the publish; the `files`/`bin`/`exports` surface is pinned by `test/cli/pack.test.ts`.
  The publish button is Myk's.
