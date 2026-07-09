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
5. **Adversarial review.** Run a strict review (the `code-review` skill or a review agent) against:
   (a) is the code high-quality, concise, efficient — no dead weight, no cleverness that hides
   behavior; (b) are any tests misaligned with the step's goals; (c) are there missing tests.
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
1. **Confirm the rhizomatic surface** (the spike, SPEC §2). Tests that exercise the real dependency:
   `loadSchema(deltas) → HyperSchema`; `resolveView(Policy, HView) → View` across a few `PropPolicy`s
   (pick/all/conflicts); a reactor materialization + `subscribe` firing on ingest; a `DerivationHost`
   binding firing and emitting.
   _Success:_ those pass; `JOURNAL.md` records what's confirmed vs. differs from SPEC §2, and SPEC is
   corrected if reality differs.
   _Flag:_ if `rhizomatic` itself needs to be changed, surface this need immediately. If this is a long-
   running loop and the user is away, you MAY create a local mutation to `rhizomatic` to unblock yourself,
   but *be sure to create a matching PR it into `rhizomatic` too* and be sure to flag this for the user!
   Ideally, `rhizomatic` is frozen and will not need updates, but let's be intentional!
2. **Persistence tier.** An **async** `StoreBackend` seam + an in-memory driver + one durable driver
   (sqlite or libSQL). Chorus's tier (SPEC §10) is the design reference; write Loam's clean.
   _Success:_ append; `deltasSince(known)` returns the complement; state survives close/reopen;
   driver-substitution contract test; all green.
3. **Read gateway.** GraphQL derived from a `HyperSchema` + `Policy`, exposing `query` + `loadSchema`,
   resolving via `resolveView` over reactor materializations, with content-addressed snapshots.
   _Success:_ load `SCHEMA_SCHEMA`; define a schema via `loadSchema`; append deltas; a GraphQL query
   returns the resolved view; its snapshot hash is stable.
4. **Mutations + subscriptions.** GraphQL `mutate` (args → deltas → append) and `subscribe`
   (materialization → initial snapshot + patch stream).
   _Success:_ a mutation appends the right deltas and a re-query reflects them; a subscription emits an
   initial snapshot then a patch on a relevant mutation.
5. **Accounts & capabilities.** Users / ownership / capability-grants as genesis schemas; gateway
   enforces (authorize iff a resolved grant permits); an operator root bootstraps grants.
   _Success:_ unauthorized mutation rejected; a grant permits it; revocation re-denies; grants are
   auditable via query.
6. **Gateway transport.** MCP + HTTP serving the gateway (chorus `mcp-http` as reference): token
   auth, multi-store mounts.
   _Success:_ a real HTTP/MCP client runs query/mutate/subscribe end-to-end with a bearer token; a
   junk token is rejected.
7. **Runner + genesis assembly.** A peer-client runner over `DerivationHost` that installs
   function-definitions from the store and executes them (pure in-process first); the genesis
   delta-set (`SCHEMA_SCHEMA` + accounts + names + fn-schemas).
   _Success:_ install a derived function via the store; on ingest it fires and emits; passive
   (no runner) vs animate (runner attached) demonstrated; genesis boots a fresh store.
8. **CLI + deploy.** A `loam` CLI (init / serve / store) + a container with pluggable/hosted
   persistence (Turso/libSQL) + a turnkey deploy.
   _Success:_ `loam serve --http` answers a query; a container runs with durable persistence; an
   install/tarball smoke passes.
9. **Federation.** Expose `Peer` sync over the authed HTTP + a "subscribe to instance X's published
   lens" declaration.
   _Success:_ two instances federate — a delta on A resolves on B; union-merge holds; no conflict.

**Decisions (Myk, 2026-07-09):** v1 is **fully multi-tenant** (§7). Chorus is **reference-only** —
read its plumbing as a design guide; write Loam's code clean, against Loam's tests (§10). Run
autonomously until the plan's steps are secured, then regroup with Myk to plan future phases.
