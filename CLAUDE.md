# Loam — how we work

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic); the
design is in **[SPEC.md](SPEC.md)** and the usage in **[README.md](README.md)** — read them before
writing code. **Get up to speed on what Loam is and how it works from SPEC.md.** This file is the
**process**. The backlog of unbuilt/partial design now lives as **ADLC tickets** in
`.adlc/tickets/` — one shard per ticket, the contract every gate reads (it replaced the old `TODO.md` +
`CURRENT_WORK.md` hand-tracked pair). **[JOURNAL.md](JOURNAL.md)** remains the append-only record —
an index over **[`journal/`](journal/)**, one file per entry; keep it current as you make decisions.

**SPEC.md is the record of what IS.** It is only ever grown by a **landing PR**, and every section
carries a `**Provenance.**` footer linking the PR(s) that landed it and naming the implementation —
one long reliable history with links to the PRs that go deeper. Speculative, unbuilt, or partially
designed work does **not** live in the spec; it lives as a **ticket** in the store until it
lands, and the landing PR **adds its section as a new `spec/NN-slug.md` file** (with its Provenance
footer) plus a row in the `SPEC.md` index, in the same change — and removes the ticket it realized.
Each landing writing its *own* file is deliberate: disjoint sections stop colliding, so concurrent
landings almost never touch the same file (editing an existing section file is the rare exception —
a bugfix or one-off correction).

The original v1 plan (build steps 0–9) is **complete** — all merged; the journal is its record. This
file no longer carries a plan; it carries the lifecycle any future work runs. **To resume:** route
through the **`adlc` discovery skill** — it maps what you're doing to the right gate. Read
`adlc ticket list` for the queued work; `adlc merge-forecast` gives the build order (its
`mergeOrder`) and how wide you may safely fan out (`recommendedWidth` — the design-stage arc that
all edits SPEC.md forecasts width 1, i.e. build it sequentially). If there is no ticket that fits,
author one first (`/adlc:adlc-ticket`); if the backlog is genuinely empty, ask Myk what to build
next.

## Hard limits

- **rhizomatic is frozen/normative** — never edit it from here. Most of Loam's core lives there
  already (SPEC §2); a genuine substrate need is a PR in that repo + a conversation with Myk.

## ADLC is the lifecycle

Work is run through the **Agentic Development Lifecycle**: phases with explicit, machine-checkable
**gates**. Each gate is a CLI whose **exit code is the verdict** — `0` pass, `2` fail, `1`
operational error. **Trust the gate over your own sense that a change is "done"** — defeating
premature satisfaction is the point. Route with the `adlc` discovery skill; `adlc <tool> --help` for
a tool's exact flags.

**WHO ANSWERS AN LLM-BACKED GATE — and it is NOT always you** (corrected 2026-07-21). The old rule
here said *"inside Claude Code you are the model: run any LLM-backed gate with `--prompt-only`,
answer the printed prompt yourself."* That is right for some gates and **defeats others entirely**,
and the difference is whether the gate's value is JUDGMENT or INDEPENDENCE:

- **Self-answer** where the question is about the ARTIFACT and the author is a competent judge of it:
  `coldstart` (is this ticket executable?), `model-router`, `merge-forecast`, `spec-lint`.
- **NEVER self-answer** where the whole product is a SECOND SET OF EYES: `review` / `prosecute`,
  `premortem`, `parallax`, `adversarial-review`. Self-answering these converts an adversarial
  reviewer into a mirror — it shares the ticket's premise, which is exactly the failure mode P5 now
  exists to defeat. **Spawn a subagent** with the diff, `src/gateway/SUBSTRATE-HAZARDS.md`, and
  explicitly WITHOUT the author's reasoning. That is not a workaround for a missing tool; it is the
  implementation.

**`adlc:prosecutor-{correctness,security,tests,contract,diff}` and `adlc:prosecutor-verifier` are
real agent types** — that panel IS P5's independent reviewer, and it is what the "spawn a subagent"
rule above means in practice. Use them; do not hand-roll review prompts beside a shipped panel.

**KEEP THE TOOLING CURRENT, and check it is actually loaded.** This repo spent two weeks running
ADLC's advisory half and none of its enforcing half, because a stale pin and a silent Windows spawn
failure are indistinguishable from a tool that has nothing to say (`journal/` has the account). After
any upgrade: `npm run adlc:patch`, then `adlc init` (idempotent — it owns `.gitignore`), and confirm
a gate you expect to FAIL actually fails. A gate you have never seen red has proven nothing, and
that applies to the toolchain as much as to a rail.

**The rail backstop runs in CI** (`scripts/rails-guard-ci.mjs`, wired in `.github/workflows/ci.yml`).
ADLC's PreToolUse hook is only the in-session layer and explicitly does **not** gate Bash — a shell
cannot be reliably parsed — so a rail edited through a shell command is caught by the CI diff gate or
by nothing. The wrapper exists because the bare gate will not scan the store and treats an ADDED file
as an edit, which would fail the very PR that first writes a ticket's rails; it therefore guards only
rails that already exist on the base. First-authoring is invisible, everything after it is frozen.

**TWO adlc CLIs are broken on Windows and both run via LOCAL PATCHES — re-apply after any adlc
upgrade with `npm run adlc:patch`.** They patch a GLOBAL package, so `npm i -g @adlc/cli` wipes
them; that is why they are scripts and not hand-edits. Both are idempotent, both count call sites
rather than testing presence, both read the file back, and both REFUSE rather than guess if upstream
restructures the call. Delete each once a released `@adlc/cli` works on Windows.

- **`adlc review`** (`scripts/patch-adlc-npx.mjs`) — `runExternal` spawns bare `npx`, which Node
  will not resolve without PATHEXT, so the reviewer died `ENOENT`. Naming `npx.cmd` turns that into
  `EINVAL` (Node ≥18.20.2 refuses `.cmd` without a shell, per CVE-2024-27980), and `shell: true`
  fixes the spawn by opening an argument-injection hole in a command that forwards diff paths and
  free text. The patch takes the third road: spawn **node against npm's own `npx-cli.js`** — no
  `.cmd`, no shell, argv stays an array, mitigation satisfied rather than disabled.
- **`adlc init`** (`scripts/patch-adlc-init.mjs`) — `writeFileNoFollow` opens an existing file
  `O_WRONLY|O_TRUNC`, and Windows rejects `O_TRUNC` without `O_CREAT` (`EINVAL`). The exclusive
  `O_CREAT|O_EXCL` branch works, so init cheerfully CREATES what is missing and dies on the first
  file that already exists — which is why this repo had a hand-written `.gitignore` and no
  `config.json`. The patch adds `O_CREAT` **on win32 only**, leaving POSIX flags byte-identical.

**`.adlc/` is an ALLOWLIST and `adlc init` owns it.** Committed: `config.json`, `tickets/`,
`ticket-archive/`, `specs/` — the CONTRACT. Local, per-worktree, never committed: `findings.jsonl`,
`manifest.jsonl`, `ticket-transactions/` — evidence that gates assert against *here*, which would
collide across branches if shared. Do not hand-add a negation; if an upgrade adds a contract file,
re-run `adlc init`. **Order is load-bearing** — `.adlc/*` must stay above every negation, and
`ticket store migrate` has been seen to reorder that block and strand one above it, silently killing
it (git is last-match-wins). (A committed ledger looks like durability and is really a merge conflict; the
durable home for a finding is P7 distillation into `SUBSTRATE-HAZARDS.md` and the journal.)

**`adlc run <phase>` asserts the phase's evidence exists, and the names are EXACT.** You record with
`adlc gate-manifest record <gate-name> --ticket <id>` and assert with `adlc run <phase> --ticket
<id>`; a gate recorded under an invented name satisfies nothing — the run still fails closed, and
the evidence you did produce is invisible to it. The required set per phase:

| phase | required evidence |
|---|---|
| `p1` | `spec-lint`, `premortem` |
| `p2` | `coldstart`, `merge-forecast` |
| `p3` | `rails-red`, `hollow-test`, `rails-frozen` |
| `p4` | `rails-green`, `rails-check`, `flail-check` |
| `p5` | `p5-complete` |
| `p6` | `p5-complete`, `p6-acceptance-packet` |
| `p7` | `lesson-foundry`, `rejection-mining`, `skill-rot` |

`p3`–`p6` also require a **ticket**, and `p5`/`p6` a **revision**: the P5 record binds the ticket
definition, the transcript, and a clean-worktree revision by hash, so it goes STALE the moment the
tree moves. Prosecute last, and re-prosecute after any fixup — an amended commit invalidates the
evidence by design.

**`adlc hollow-test` is the shipped detector for our worst recurring bug** — it mutates changed code
and reports the mutants your tests do not kill. Run it in P3 rather than hand-rolling revert-probes.
Scope it: it mutates **whatever is in the diff**, so a commit that bundles `.adlc/` evidence with
code will have its JSON log lines mutated and reported as survivors. Point it at source with
`--target <file>` (repeatable); `--rails` wants a SINGLE-ticket JSON with a top-level `rails` array,
which our sharded store is not, so it errors rather than expanding.

**And `adlc prosecute` is an evidence RECORDER**
(`--input passes.json`): it writes down what it is handed and never verifies a review occurred, so
it may only record what a prosecutor actually returned. Feeding it unearned passes would be an
operation reporting a success it did not achieve — hazard **H7** at the process layer, which is
exactly what the old convention produced.

## What Loam adds to each phase

**The phases are ADLC's and live in the `adlc` skill** — P0 Triage, P1 Interrogate, P2 Decompose,
P3 Rail, P4 Build, P5 Prosecute, P6 Integrate (the human gate), P7 Distill, each with its tools.
This file used to restate all of it, and that duplication is exactly how the repo came to believe it
was running gates it had never run: a phase list written here reads as the authority, so nobody
opened the skill, and the copy drifted until it described a lifecycle we were not executing. **Route
with the skill; `adlc <tool> --help` for flags.** What follows is only what Loam adds on top.

**P1 — the deliverable is a WORKING SPEC at `.adlc/specs/NN-slug.md`**, never prose staged into
`spec/`. `spec/` is the HISTORICAL record, written only at landing; treating it as the design
surface is what let P1's gates be skipped entirely, because a narrative "what IS" section carries no
acceptance criteria and `spec-lint` passes it vacuously (`WARNING: no criteria found`, exit 0 — a
gate that gates nothing). A working spec carries an `## Acceptance criteria` heading and every
criterion NAMES ITS VERIFICATION — a test path or a backtick command. That is the whole point:
**spec-lint's "verification method" is our rail**, enforcing *every promise names the test that will
prove it* at design time, before any code. A criterion with no method is a WISH and gate-FAILS.
Prefer `--llm`/`--prompt-only`, which also catches a method that is present but VACUOUS; the plain
run only catches a missing one.

**Then STOP and wait for Myk's word in chat before writing implementation code** — plus answers to
the ticket's listed design questions. "He'd probably approve" is not his word. That stop is the P6
human gate arriving early, at design time.

**P3 — ASSERT AT BOTH LEVELS, DELTA AND OBJECT. It is not either/or** (Myk, 2026-07-21). A rail that
only checks one leaves the other open, and 2026-07-21 produced the failure in *both* directions on
the same day:

- **Object-level only** missed T40: `get(id)` returned undefined — the API said forgotten — while
  the plaintext sat legible in the sqlite file. The store lied downward.
- **Delta-level only** missed T15/T38: the right deltas crossed the seeding edge, and a *reader*
  still saw a retracted claim as live, because suppression is a property of the operand set rather
  than of the delta. The store lied upward.

So a rail asks **both**: *what is actually in the store, in bytes or deltas?* **and** *what does a
reader resolve through a Schema, or a door serve?* The middle is not the top — asserting
`reactor.negationsOf(...)` is still delta-level structure; the object-level question is what a
**View** contains and what a **door** answers. When the two disagree, that disagreement is usually
the bug, and neither assertion alone can see it. Where one level is genuinely out of scope, **name
the gap in the test file** and say which rail would close it; an honest-looking comment over a
weaker test is how this class keeps surviving review.

Where a working spec exists, **its acceptance criteria ARE the rail list** — each criterion already
names its verification path, so P3 is transcription, not invention. If a criterion has no test yet,
P1 under-specified. **No reward-hacking: a test that can pass without the desired behavior is a bug.**

**Declare `rails` when the tests EXIST, never in advance.** A rail glob matching no file does not
fail and does not warn — `rails-guard` prints `all checks passed` and exits 0. Pre-declaring paths
on a `todo` ticket therefore protects nothing while manufacturing a green. There is no bulk
backfill; a ticket earns its rails at P3. A ticket listing rails that match nothing is worse than
one listing none. (Retroactive rails have a second problem: written by the author of already-merged
code, they share that code's premise — which is how three hollow rails shipped on 2026-07-21.)

**P4 — the green bar is `npm run check`** (format + lint + typecheck + **all** tests; read the
counts, never trust a silent grep). Write the code as small as it can be **without dropping a
desired behavior** — concise, not cryptic.

**P5 — THE SYSTEM CATCHES MISTAKES; THE MODEL DOES NOT AVOID THEM** (Myk, 2026-07-21). This is the
governing principle. Do not tune this process toward a model that is careful enough — that target
does not exist. 2026-07-21 is the proof: the session's own model wrote hazard **H7**, in its own
words, and violated it **three hours later** in a function whose entire stated purpose was keeping a
promise about completeness. Maximal proximity, freshest possible memory, still shipped.

**P5's default is an INDEPENDENT reviewer that did not write the diff** — a subagent with the diff,
`src/gateway/SUBSTRATE-HAZARDS.md`, and no access to the author's reasoning. The
`adlc:prosecutor-{correctness,security,tests,contract,diff}` panel IS that reviewer; use it rather
than hand-rolling prompts beside a shipped panel. Self-review is the **exception** and must be
justified in the PR body — and "small mechanical diff" is not a justification, since the worst
finding of 2026-07-21 was in a tiny one. The one-careful-pass budget is **retired**; it was priced
honestly that day:

| | caught |
|---|---|
| P5 as budgeted (self-review, one pass) | **nothing** |
| independent diff audits (3 runs) | **every finding, incl. 2 probed to certainty** |

The failure is structural, not effortful: **self-review shares the ticket's premise**, and a wrong
premise produces perfect rails around a real bug. Independence is the active ingredient — not care,
not a sharper prompt.

**Review the RAILS, not just the code.** Every audit that day found rail defects, and the rail
defects were what would have let the bug ship. Ask of each new test: *could this pass with the fix
reverted?* and *could this pass if the feature were deleted entirely?* Both were live failures.
`adlc hollow-test` asks that mechanically — use `--target <file>` (repeatable); `--rails` wants a
single-ticket JSON, which our store is not.

**Frame review prompts and finding-summaries in a neutral correctness register** — "review for
authorization and correctness gaps; what inputs or states produce a wrong outcome" — rather than
role-playing an opponent. The neutral framing finds the same issues and reads far less like
offensive security to a classifier; the sharper framing was only ever stylistic.

**AUDIT AFTER EVERY PIECE OF MAJOR WORK** (Myk, 2026-07-21) — standing. Bound the number of ANGLES,
never the independence. **Run the RETRO SHAPE:** 3–4 tightly-scoped finder angles, **no verify
stage** (the fixer verifies while fixing — verification was ~80% of audit 1's cost and refuted 1 of
24 candidates), findings capped per angle, every angle told that **a clean result is a valid
result** so it does not pad. Scale to the work: 3–4 over the tree after an arc lands, **1–2 scoped
to the diff** after a single ticket. Tell each angle what is ALREADY KNOWN so it does not re-find
it, and require CONFIRMED-vs-PLAUSIBLE on every finding. **Pick angles from what has actually
bitten** — audit 3's angles came from real bugs found hours earlier and every one landed;
`SUBSTRATE-HAZARDS.md` is the running list.

**Why this is worth the tokens:** the gates verify conformance to the ticket and cannot verify that
the ticket is right. Rails are downstream of the spec, so a wrong premise produces perfect rails
around a real bug — which is how all three negation-closure sites shipped green. The audit is the
only step that reads the code without the ticket's assumptions.

**P6 — the landing PR writes the ticket's design as a new `spec/NN-slug.md` file, the LAST step and
the only step that touches `spec/`**: the whole section closed by its `**Provenance.**` footer (the
PR link(s) + a short implementation note), plus its row in the `SPEC.md` index, and it removes the
realized ticket from the store. It is written FROM the settled working spec, re-cast as narrative —
`spec/` records what IS, in prose, for a reader; the working spec was a gateable instrument for a
builder. Different genres, different lifetimes; do not paste one into the other. The spec grows only
here, never speculatively; a new file is the default, editing an existing section the rare
exception. Append a record to the journal — a **new `journal/<date>-<slug>.md` file** (what was done
+ any novel learning) plus its row in the `JOURNAL.md` index.

**P7 — a local `findings.jsonl` is where lessons START, not where they live.** It is per-worktree and
uncommitted, so a lesson becomes durable only by landing in `SUBSTRATE-HAZARDS.md`, this file, or
the journal.

**The village is PARKED** (Myk, 2026-07-22). `demos/village/` was a per-ticket obligation — extend
the living demonstration so it exercises whatever just landed. It is set aside for now; do not treat
it as a step. The demo and its ledger stay in the tree, and `demos/village/homes/` stays untracked.

After a ticket lands, re-evaluate the **remaining** tickets against what you just learned. A learning
that changes the plan edits the relevant ticket body (not SPEC.md — SPEC.md is history, changed only
by a landing), logged in `JOURNAL.md`. Adding, splitting, or re-edging tickets is the ordinary P0
motion — author the finer tickets and wire `edges` (prerequisite → dependent).

## The design-stage convention (hard-won; don't relearn it)

- **The dependency spine is strict** — the design arc lands in order (§21 → §22 → §23 → §24 →
  hardening), encoded as ticket `edges`. Do not start a ticket's *implementation* before everything
  it depends on is IN SPEC.md — merged, provenance footer and all. Off-spine items (the §14
  amendment, as-of) interleave where their edges allow.
- **"Opens at the design stage" is a deliverable, not a mood** — drafted SPEC prose + answered
  design questions, then STOP for Myk in chat before any implementation code.
- **"(Myk)" / "Myk's call" marks a decision that needs his sentence in chat** — do not resolve it by
  inference, however obvious. Likewise anything **blocked on a rhizomatic conversation**: rhizomatic
  is frozen — no Loam workaround, no forked vocabulary, no edits to that repo. Note the wall, route
  around it.
- **Reserved section numbers are load-bearing** — tickets and SPEC sections cite each other by them.
  Never renumber.
- **"Lens" is prose, not a type** — it names the reading-side assembly (a Schema over a hyperschema,
  the composed thing that turns shared ground into a View). No exported type carries the name today;
  write `Schema` when you mean the Schema, until a design stage decides otherwise.

## Autonomous operation — churn until a human gate

The default posture is autonomous churn (Myk, 2026-07-13): Myk keeps the ticket store stocked
(that is P1 — the approval of *what* to build), and the model works the backlog until it hits a gate
that genuinely needs him. The loop, per unblocked ticket:

1. Pick the next unblocked, buildable ticket — `adlc merge-forecast`'s `mergeOrder` is the order,
   its `recommendedWidth` the safe fan-out (idle builders claim the next unblocked ticket).
2. Run it through the gates (P1→P5), building on a **feature branch**, committing and pushing freely
   as it goes. Independent unblocked tickets run **in parallel in per-ticket git worktrees**, up to
   the forecast width (this §21–§24 arc is width-1, so it runs sequentially).
3. Open a PR carrying the gate evidence. Then **merge by risk**:
   - **The model self-merges** a PR when *all* hold: `npm run check` green, **P5 prosecute clean**,
     **and the post-work AUDIT clean** (P5 above — it is now standing, and it is the gate that earns
     this). **WIDENED (Myk, 2026-07-21): the reserved-surface list no longer bars a self-merge.** The
     old rule held back anything touching trust-root / capability / auth / federation / erasure
     (§6/§7/§8/§11/§12) or shipping a §20 migration; Myk lifted that in chat, explicitly and twice,
     with "stack them up" as the fallback if the harness blocks a merge mechanically. So a
     **bugfix restoring behavior the spec already states** may self-merge on any surface — T40's
     erasure fix is the archetype.
   - **Myk still merges**: every **design-stage** spec section; anything that CHANGES WHAT THE SYSTEM
     PROMISES rather than restoring a stated promise (new capability, a widened door, a trust-model
     change); and any **breaking on-wire change** shipping a migration. This is P6. The test is not
     "which file did it touch" but "does this decide something, or repair something."
   - If a merge is blocked mechanically rather than by this rule, **stack the PRs** and say so —
     do not work around the block.
4. **Design-stage tickets never self-merge.** The model drafts the full `spec/NN-*.md` section,
   answers every open **"(Myk)"** question with a *reasoned recommendation*, and opens the PR — that
   PR is Myk's decision + merge (P6), batching his input into one review instead of chat interrupts.
   It does not decide a reserved "(Myk)" call unilaterally.
5. When a ticket is blocked (a rhizomatic version not yet landed, a "(Myk)" call the model can't
   responsibly recommend past), **surface it and move to the next unblocked ticket** — don't stall
   the loop. Stop and summarize for Myk only when nothing buildable remains.

The lever: autonomous throughput scales with how many **build** (non-design) tickets are queued —
design tickets always tap Myk at review. Stock buildable, coldstart-clean tickets to keep the model
busy.

## Standing rules

- **Root holds exactly four markdown docs** — `README.md` (the vision), `CLAUDE.md` (the process),
  `SPEC.md` (the spec **index**: preamble + the section table), `JOURNAL.md` (the journal **index**:
  preamble + the entry table). Both indexes front a folder, for the same reason: **`spec/`** is one
  `NN-slug.md` file per section (what IS, grown only by landings, each footered with its provenance),
  and **`journal/`** is one `<date>-<slug>.md` file per entry (append-only, newest last). A new
  section is a new file in `spec/`; a new entry is a new file in `journal/` plus its index row —
  never a new root doc. The backlog is not a doc anymore: it is `.adlc/tickets/`, one shard per
  ticket (a committed contract — don't hand-edit it; go through `adlc ticket update`, which is
  hash-guarded and refuses to narrow a rail set without `--authorize`). Neither is the DESIGN surface: a work-in-progress spec is a **working spec** at
  `.adlc/specs/NN-slug.md` (gateable, criteria-bearing, P1's instrument), which becomes a `spec/`
  section only at landing. `spec/` is the archive, never the drafting table. Do not accumulate more
  root markdown; fold, don't add.
- **Strict in PRs, creative and aggressive in execution.** Ship real vertical slices; don't
  gold-plate; don't reward-hack a green bar.
- **Match rhizomatic's vocabulary** — the concepts are HyperSchema / HyperView / View / Schema /
  Policy / derived function / binding; the exported type names are `HyperSchema`, `HView`, `View`,
  `Schema`, `Policy`, `DerivedFn`, `BindingSpec`. Since rhizomatic 0.3.0 (the L5 realignment):
  a **Schema** is the resolution program (`{ props: Map<field, Policy>, default: Policy }`) that
  resolves a HyperView into a View, and a **Policy** is a single property's rule (`pick` / `all` /
  `merge` / `conflicts` / `absentAs`) — the symmetry is `HyperSchema : HyperView :: Schema : View`.
  (Before 0.3.0 these were named `Policy` and `PropPolicy`; older Journal entries use the old
  names — that is historical, don't rewrite them.) The at-rest schema-definition vocabulary is
  `rhizomatic.hyperschema.*`. Don't parallel any of these with near-synonyms.
- **The poetry is as important as the engineering** — errors, help text, commit messages, and docs
  are first-class craft. This holds for ticket bodies too: they are the record now.
- **Comments explain the code; HISTORY goes in the journal** (Myk, 2026-07-21). A comment answers
  *what will bite whoever changes this next* — a non-obvious substrate behavior, an invariant, why
  not the obvious thing. It does **not** narrate how the code got here: what an audit found, what an
  earlier draft got wrong, why a test was skipped, which PR changed it. That is `JOURNAL.md`, the
  commit message, and `.adlc/findings.jsonl` — all of which a reader can reach, and none of which
  costs context on every read of the file.
  **The tell: if a comment names a PR, an audit, a draft, or a person, it is history in the wrong
  file.** Don't restate a hazard `SUBSTRATE-HAZARDS.md` already owns — cite it (`H6`) in one line.
  A test header says what the rail asserts and what it deliberately does not; not its rewrite
  history. Legacy cruft is not free: it churns tokens forever and crowds the real signal.
- **Every breaking on-wire change ships a migration** (Myk, 2026-07-12) — if a change alters the
  bytes/roles of any delta that older stores already hold, add a step to `src/migrate/` (the
  `MIGRATIONS` chain) in the SAME PR. A migration is grow-only: it re-signs each changed delta into
  the new form and NEGATES the old one with a negation that points `supersededBy` at the replacement
  and records a reason — never a silent rewrite. Steps are shape-detected and composable, so a store
  several versions back is carried forward one step at a time (naive is fine; optimize later). See
  SPEC §20.
  - **Corollary — the changed deltas must be shape-distinguishable.** Because migrations detect by
    shape, every breaking change MUST give its changed deltas a shape unambiguously distinct from all
    prior versions — the version lives IN the vocabulary (0.3 did it: `rhizomatic.hyperschema.*` can
    never be confused with `rhizomatic.schema.*`). That is what keeps shape-detection sufficient and
    makes a per-delta version stamp unnecessary (it would only pollute content addresses with metadata
    the bytes already carry). Almost no delta kinds ever change between versions — only the structural
    ones — and those few carry their version in their own roles.

## Standing decisions

- **Commit and push freely; the human gates are P1 and P6** (Myk, 2026-07-13) — commits and pushes
  to a feature branch are safe, reversible checkpoints and part of autonomous progress: make them
  without asking, on a feature branch (never `main`), with real messages (the poetry rule applies to
  commits too). The point is to churn autonomously and pull Myk in only where ADLC actually needs a
  human: **P1** (he keeps the ticket store stocked — that is the approval of what to build) and
  **P6** (accepting the merge). ~~Open PRs; don't merge to `main`~~ — **SUPERSEDED 2026-07-21 by the
  repair-vs-decide test in "merge by risk" above**: the model self-merges a REPAIR that restores
  stated behavior (green + P5 + clean audit); anything that DECIDES what the system promises, and
  every design-stage section, is still Myk's. Never self-approve the design-stage "(Myk)" sign-offs
  unless he delegates that. Parallelism is per-ticket git worktrees, width bounded
  by `adlc merge-forecast`. (This replaced the deleted fleet-level control-pane rules; Loam is
  governed per-repo by this file.)
- **v1 is fully multi-tenant** (SPEC §7) — tenant isolation is first-class in the genesis schemas
  and gateway enforcement (Myk, 2026-07-09).
- **Chorus is reference-only** (SPEC §10) — read its plumbing as a design guide; Loam's code is
  written clean, against Loam's own tests.
- **`@bombadil/loam` publishes to npm** for turnkey install. The package is kept `"private": true`
  until Myk runs the publish; the `files`/`bin`/`exports` surface is pinned by `test/cli/pack.test.ts`.
  The publish button is Myk's.
