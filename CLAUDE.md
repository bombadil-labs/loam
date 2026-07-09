# Loam — how we work

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic); the
design is in **[SPEC.md](SPEC.md)** — read it before writing code. This file is the **process and the
plan**. **[CURRENT_WORK.md](CURRENT_WORK.md)** is the live checklist for the step in progress.
**[JOURNAL.md](JOURNAL.md)** is the append-only record.

**To resume:** read `CURRENT_WORK.md`. If a step is in progress, continue from the "left off here"
note. If it is empty, start the first unchecked step in the plan below, at cycle stage 1.

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
5. **Adversarial review.** Run a strict review against: (a) is the code high-quality, concise,
   efficient — no dead weight, no cleverness that hides behavior; (b) are any tests misaligned
   with the step's goals; (c) are there missing tests. **Budget: one careful review agent per
   PR** (self-review directly for small mechanical diffs); a 2–3-angle panel only for the
   riskiest steps (capabilities/auth, federation). Token spend must last the whole plan.
   **Audits are paused** (Myk, 2026-07-09): audit 1 (after PR #5) cost ~5% of the total token
   budget — no further audit panels until every queued step and the landing are done. Before any
   future audit, apply audit 1's retro: the per-finding verify stage was ~80% of the cost and
   refuted only 1 of 24 candidates (the finders were already precise), and three findings were
   discovered by multiple overlapping angles. A future audit is 3–4 tightly-scoped finder angles,
   NO verify stage (the fixer verifies while fixing), findings capped per angle.
6. **Resolve → merge.** If step 5 generates feedback, take it into consideration and go back to step 1,
   and feed forward; confirm the PR is genuinely good. Append a record to `JOURNAL.md` (what was done +
   any novel learning).
7. **Re-plan.** With the step done, re-evaluate the **remaining** steps against anything you just learned.
   If a learning changes the plan, edit SPEC.md to take it into consideration, log the change in 
   `JOURNAL.md`, and commit it.
8. **Next step.** Clear `CURRENT_WORK.md` and begin the next unchecked step at stage 1.

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

## The plan — build steps (success criteria are the gate)

The following are the anticipated initial steps. If you are coming at this fresh, start here - use these
to inform your initial plan (but verify that they're necessary, and use your own judgment about the process), 
then remove these items from `CLAUDE.md` when they are accounted for.

Ordered; re-evaluated after each merge (cycle stage 7). Adopt rhizomatic's core; build the wrapper.

0. **Scaffold.** _Done — merged as PR #1 (2026-07-09); see `JOURNAL.md`._
1. **Confirm the rhizomatic surface.** _Done — merged as PR #2 (2026-07-09); the substrate is what
   SPEC §2 says it is (see `JOURNAL.md` for the confirmed surface + refinements). No rhizomatic
   changes were needed._
2. **Persistence tier.** _Done — merged as PR #3 (2026-07-09); async `StoreBackend` + memory/sqlite
   witnesses behind one contract (see `JOURNAL.md`)._
3. **Read gateway.** _Done — merged as PR #4 (2026-07-09); GraphQL derived from (HyperSchema,
   Policy) over a boot-replaying, write-through Gateway (see `JOURNAL.md`)._
4. **Mutations + subscriptions.** _Done — merged as PR #5 (2026-07-09); GraphQL mutate + subscribe
   over leavable, coalescing channels (see `JOURNAL.md`). First 5-PR audit panel run after this
   merge._
5. **Accounts & capabilities.** _Done — merged as PR #7 (2026-07-09); full multi-tenant capability
   grants with operator-rooted authority chains (see `JOURNAL.md` and SPEC §7)._
6. **Gateway transport.** _Done — merged as PR #8 (2026-07-09); node:http serving GraphQL + SSE +
   MCP behind timing-safe bearer tokens over isolated mounts (see `JOURNAL.md`)._
7. **Runner + genesis assembly.** A peer-client runner over `DerivationHost` that installs
   function-definitions from the store and executes them (pure in-process first); the genesis
   delta-set (`SCHEMA_SCHEMA` + accounts + names + fn-schemas). **Includes closing the audit-1
   gap:** registrations become deltas (schema + policy + roots stored, so the GraphQL surface is
   a function of the store and survives reopen) and `loadSchema` is exposed through GraphQL,
   honoring SPEC §5's "nothing is reachable except through GraphQL — including schema CRUD."
   _Success:_ install a derived function via the store; on ingest it fires and emits; passive
   (no runner) vs animate (runner attached) demonstrated; genesis boots a fresh store; a
   reopened store serves its registered schemas without re-registration code.
8. **CLI + deploy.** A `loam` CLI (init / serve / store) + a container with pluggable/hosted
   persistence (Turso/libSQL) + a turnkey deploy.
   _Success:_ `loam serve --http` answers a query; a container runs with durable persistence; an
   install/tarball smoke passes.
9. **Federation.** Expose `Peer` sync over the authed HTTP + a "subscribe to instance X's published
   lens" declaration.
   _Success:_ two instances federate — a delta on A resolves on B; union-merge holds; no conflict.

**Landing (after the steps above are all merged):**

- **Remove this "plan — build steps" section from `CLAUDE.md`** — the journal is the record; the
  plan section exists only while steps remain.
- **Rewrite `README.md`** as full project documentation — installation, configuration, and usage,
  grounded in the code actually shipped (not aspiration). The vision prose gives way to a manual.
- **Ship `@bombadil/loam` to npm** for turnkey install: drop `"private": true`, verify the
  `files`/`exports`/`bin` surface against a tarball smoke (step 8's), and hand Myk the
  ready-to-run `npm publish` (the button itself is his).

**Decisions (Myk, 2026-07-09):** v1 is **fully multi-tenant** (§7). Chorus is **reference-only** —
read its plumbing as a design guide; write Loam's code clean, against Loam's tests (§10). Run
autonomously until the plan's steps are secured, then regroup with Myk to plan future phases.
