# Loam — how we work

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic); the
design is in **[SPEC.md](SPEC.md)** and the usage in **[README.md](README.md)** — read them before
writing code. **Get up to speed on what Loam is and how it works from SPEC.md.** This file is the
**process**. The backlog of unbuilt/partial design now lives as **ADLC tickets** in
`.adlc/tickets.json` — the contract every gate reads (it replaced the old `TODO.md` +
`CURRENT_WORK.md` hand-tracked pair). **[JOURNAL.md](JOURNAL.md)** remains the append-only record —
an index over **[`journal/`](journal/)**, one file per entry; keep it current as you make decisions.

**SPEC.md is the record of what IS.** It is only ever grown by a **landing PR**, and every section
carries a `**Provenance.**` footer linking the PR(s) that landed it and naming the implementation —
one long reliable history with links to the PRs that go deeper. Speculative, unbuilt, or partially
designed work does **not** live in the spec; it lives as a **ticket** in `.adlc/tickets.json` until it
lands, and the landing PR **adds its section as a new `spec/NN-slug.md` file** (with its Provenance
footer) plus a row in the `SPEC.md` index, in the same change — and removes the ticket it realized.
Each landing writing its *own* file is deliberate: disjoint sections stop colliding, so concurrent
landings almost never touch the same file (editing an existing section file is the rare exception —
a bugfix or one-off correction).

The original v1 plan (build steps 0–9) is **complete** — all merged; the journal is its record. This
file no longer carries a plan; it carries the lifecycle any future work runs. **To resume:** route
through the **`adlc` discovery skill** — it maps what you're doing to the right gate. Read
`.adlc/tickets.json` for the queued work; `adlc merge-forecast` gives the build order (its
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

**THE TOOLING WAS NEVER TURNED ON — fixed 2026-07-21, and here is what to use.** For two weeks this
repo ran ADLC's *advisory* half (`merge-forecast`, `coldstart`, `hollow-test`) and none of its
*enforcing* half. What was actually wrong, so nobody assumes it again:

- The `adlc` **plugin** was pinned at 0.2.0 while upstream was 1.5.1 (35 commits). Its **discovery
  skill**, its `/adlc:*` commands, its **PreToolUse rails + buildgate hooks**, its **SessionStart
  preflight hook**, and its **seven prosecutor agents** were all installed and none were loading.
- `@adlc/cli` was 1.3.0 against 1.5.1; `adversarial-review` was **never installed at all**.

All updated. **`adlc:prosecutor-{correctness,security,tests,contract,diff}` and
`adlc:prosecutor-verifier` are real agent types** — that panel IS P5's independent reviewer, and it
is what the "spawn a subagent" rule above means in practice. Use them; do not hand-roll review
prompts beside a shipped panel (that mistake cost a day).

**`adlc review` works on Windows via a LOCAL PATCH — re-apply it after any adlc upgrade:**
`npm run adlc:patch` (`scripts/patch-adlc-npx.mjs`). Upstream's `runExternal` spawns bare `npx`,
which on Windows needs BOTH `npx.cmd` AND `shell: true` — naming the `.cmd` alone turns `ENOENT`
into `EINVAL`, because Node ≥18.20.2 refuses to spawn `.bat`/`.cmd` without a shell
(CVE-2024-27980). The script is idempotent, completes a half-applied patch, and REFUSES rather than
guessing if upstream restructures the call. It patches a GLOBAL package, so `npm i -g @adlc/cli`
wipes it — that is the whole reason it is a script and not a hand-edit. Delete it once a released
`@adlc/cli` spawns correctly on Windows.

**And `adlc prosecute` is an evidence RECORDER**
(`--input passes.json`): it writes down what it is handed and never verifies a review occurred, so
it may only record what a prosecutor actually returned. Feeding it unearned passes would be an
operation reporting a success it did not achieve — hazard **H7** at the process layer, which is
exactly what the old convention produced.

The phases, with Loam's own craft folded into each:

1. **P0 — Author the ticket** (`/adlc:adlc-ticket`). Turn the work into a self-contained ticket in
   `.adlc/tickets.json` — the body must stand alone (an agent can't see the conversation), the
   `scope`/`rails`/`edges` honest. `coldstart` will check it is executable without guesswork; a
   vague ticket fails it, and that failure is the signal to split it into finer tickets.
2. **P1 — Interrogate / design-stage.** The deliverable is a **WORKING SPEC at
   `.adlc/specs/NN-slug.md`** — *not* prose staged into `spec/`. `spec/` is the HISTORICAL record
   and is written only at landing (P6); treating it as the design surface is what let P1's gates be
   skipped entirely, because a narrative "what IS" section carries no acceptance criteria and
   `spec-lint` passes it vacuously (`WARNING: no criteria found`, exit 0 — a gate that gates nothing).

   A working spec carries an **`## Acceptance criteria`** heading, and every criterion NAMES ITS
   VERIFICATION — a test path or a backtick command. That is the whole point: **spec-lint's
   "verification method" is our rail**, so `adlc spec-lint <path>` mechanically enforces *every
   promise names the test that will prove it*, at design time, before any code. A criterion with no
   method is a WISH and gate-FAILS (exit 2). This is the hollow-rail defense moved upstream — from
   something the model must remember into something the gate refuses.

   Run: `adlc spec-lint .adlc/specs/NN-slug.md` (exit 2 on a wish), then `adlc premortem <path>`
   (failure-first stress) and `adlc parallax --file <path>` (ambiguity fan-out), plus
   `adversarial-review --prompt-only` on the design.

   **Then STOP and wait for Myk's word in chat before writing implementation code** — plus answers to
   the ticket's listed design questions. "He'd probably approve" is not his word. That stop is the P6
   human gate arriving early, at design time.
3. **P2 — Decompose.** `adlc coldstart <id> --prompt-only` (executability), `adlc model-router`
   (which model strategy), `adlc merge-forecast` (fan-out width + `mergeOrder`).
4. **P3 — Rail (tests first).** Write clean, honest tests that capture everything in the ticket —
   the behavior it must exhibit, asserted against real outcomes, not against the shape of the
   implementation. **No reward-hacking: a test that can pass without the desired behavior is a bug.**
   **Where a working spec exists, its acceptance criteria ARE the rail list** — each criterion already
   names its verification path, so P3 is writing the tests P1 already committed to, not inventing a
   set. Freezing them should be transcription; if a criterion has no test yet, P1 under-specified.
   Freeze them as `rails` on the ticket; `adlc rails-guard` (and the plugin's PreToolUse rail hook)
   then protect them. Once any ticket declares `rails`, `.adlc/tickets.json` itself becomes a frozen
   trust root — edits need `ADLC_RAILS_BYPASS=1` (an audited, deliberate act).

   **ASSERT AT BOTH LEVELS — DELTA AND OBJECT. It is not either/or** (Myk, 2026-07-21). A rail that
   only checks one leaves the other open to nuanced bugs, and 2026-07-21 produced the failure in
   *both* directions on the same day:
   - **Object-level only** missed T40: `get(id)` returned undefined — the API said forgotten — while
     the plaintext sat legible in the sqlite file. The store lied downward.
   - **Delta-level only** missed T15/T38: the right deltas crossed the seeding edge, and a *reader*
     still saw a retracted claim as live, because suppression is a property of the operand set
     rather than of the delta. The store lied upward.

   So a rail asks **both**: *what is actually in the store, in bytes or deltas?* **and** *what does a
   reader resolve through a Schema, or a door serve?* Note the middle is not the top — asserting
   `reactor.negationsOf(...)` is still delta-level structure; the object-level question is what a
   **View** contains and what a **door** answers. When the two levels disagree, that disagreement is
   usually the bug, and neither assertion alone can see it.

   Where one level is genuinely out of scope (a unit-level migration step, say), **name the gap in
   the test file** and say which rail would close it. Do not write a header that claims the stronger
   assertion — an honest-looking comment over a weaker test is how this class keeps surviving review.
5. **P4 — Build.** Write the code to make the tests pass. Concise, not cryptic — as small as it can
   be **without dropping a desired behavior**. The green bar is `npm run check` (format + lint +
   typecheck + **all** tests; read the counts, never trust a silent grep). If mid-build you loop or
   drift, `adlc flail-detector`; for a hard failing test, `adlc consensus-fix`.
6. **P5 — Prosecute.** Before merge, run the adversarial prosecutor on the diff
   (`/adlc:adlc-prosecute`; `adlc hollow-test` finds tests that pass without testing behavior).
   **Frame review prompts and finding-summaries in a neutral correctness register** — "review for
   authorization and correctness gaps; what inputs or states produce a wrong outcome" — rather than
   role-playing an opponent trying to defeat the system. The neutral framing finds the same issues
   and reads far less like offensive security to a content classifier; the sharper framing was only
   ever stylistic.

   **THE SYSTEM CATCHES MISTAKES; THE MODEL DOES NOT AVOID THEM** (Myk, 2026-07-21). This is the
   governing principle, and it replaces the old budget rule below it. Do not tune this process
   toward a model that is careful enough — that target does not exist. 2026-07-21 is the proof: the
   session's own model wrote hazard **H7**, in its own words, and violated it **three hours later**
   in a function whose entire stated purpose was keeping a promise about completeness. Maximal
   proximity, freshest possible memory, still shipped. Knowing a trap in the abstract does almost
   nothing to help you notice you are standing in it.

   **~~Budget: one careful review pass per PR (self-review for small mechanical diffs)~~ — RETIRED.**
   That rule optimized for spending less on review, and 2026-07-21 priced it honestly:

   | | caught |
   |---|---|
   | P5 as budgeted (self-review, one pass) | **nothing** |
   | independent diff audits (3 runs) | **every finding, incl. 2 probed to certainty** |

   Prosecute-as-practiced passed all three negation-closure sites, a hollow rail in the PR *about*
   hollow rails, and a keystone file that merged as a **zero-line diff**. The failure is structural,
   not effortful: **self-review shares the ticket's premise**, and a wrong premise produces perfect
   rails around a real bug. Independence is the active ingredient — not care, not a sharper prompt.

   **So: P5's default is an INDEPENDENT reviewer that did not write the diff** — a subagent with the
   diff, the hazards file, and no access to the author's reasoning. Self-review is the **exception**,
   and it must be justified in the PR body. Note that "small mechanical diff" is not a justification:
   the worst finding of 2026-07-21 was in a tiny one.

   **Review the RAILS, not just the code.** Every audit that day found rail defects, and the rail
   defects were what would have let the bug ship. Ask of each new test: *could this pass with the fix
   reverted?* and *could this pass if the feature were deleted entirely?* Both were live failures.

   **Budget honestly.** Review is the cheapest thing here relative to shipping an erasure leak. Where
   spend must be bounded, bound the number of ANGLES, never the independence. ~~**Audits are paused**~~ — **UNPAUSED, and now STANDING: audit after every piece of
   major work** (Myk, 2026-07-21). Audit 1's pause was a cost decision; audit 3 justified reversing
   it by finding **13 real issues in one pass**, two of them probed to certainty (a completed
   erasure left the plaintext recoverable from the sqlite file; `migrate` resurrected withdrawn
   operator law, turning a §17 410 into a 200 and potentially serving it anonymously) and one of
   them a build rule §24.8 had already written and nobody had built.

   **Run the RETRO SHAPE, which is what makes this affordable:** 3–4 tightly-scoped finder angles,
   **no verify stage** (the fixer verifies while fixing — the verify stage was ~80% of audit 1's
   cost and refuted 1 of 24 candidates), findings capped per angle, and every angle told that **a
   clean result is a valid result** so it does not pad. Scale the angles to the work: 3–4 over the
   whole tree after an arc lands; **1–2 scoped to the diff** after a single ticket. Tell each angle
   what is ALREADY KNOWN so it does not re-find it, and require CONFIRMED-vs-PLAUSIBLE on every
   finding.

   **Pick angles from what has actually bitten**, not from a generic checklist — audit 3's angles
   were drawn from real bugs found hours earlier and every one landed. `src/gateway/SUBSTRATE-HAZARDS.md`
   is the running list; a hazard there that keeps recurring is next audit's angle.

   **Why this is worth the tokens, stated plainly:** the gates verify conformance to the ticket, and
   they cannot verify that the ticket is right. Rails are downstream of the spec, so a wrong premise
   produces perfect rails around a real bug — which is exactly how all three of the negation-closure
   sites shipped green. The audit is the only step that reads the code without the ticket's
   assumptions, and that is a different question from every other gate.
7. **P6 — Integrate (the human gate).** Myk decides. Surface the evidence (`adlc gate-manifest
   show`, behavior diffs). **The landing PR writes the ticket's design as a new `spec/NN-slug.md`
   file — the LAST step, and the only step that touches `spec/`** — the whole section, closed by its
   `**Provenance.**` footer (the PR link(s) + a short implementation note) — adds its row to the
   `SPEC.md` index, and removes the realized ticket from `.adlc/tickets.json`. It is written FROM the
   settled working spec (`.adlc/specs/NN-slug.md`), re-cast as narrative: `spec/` records what IS, in
   prose, for a reader; the working spec was a gateable instrument for a builder. Different genres,
   different lifetimes — do not paste one into the other. The working spec has served its purpose at
   this point and may be left as the design's audit trail. The spec grows only here, never
   speculatively; a new file is the default, editing an existing section the rare exception. Append a record to the journal — a **new
   `journal/<date>-<slug>.md` file** (what was done + any novel learning) plus its row in the
   `JOURNAL.md` index, the same new-file-per-landing discipline the spec runs on.
8. **The village.** Extend `demos/village/` — the living demonstration, see
   `demos/village/README.md` — so the village *exercises the behavior this ticket added*,
   end-to-end and ambitiously: new acts, new stores, new lenses, whatever makes the feature visible
   in a running federated world. RUN what you added; update the demonstration ledger in
   `demos/village/README.md` (Myk, 2026-07-09: with each new PR, document how you've updated the
   village). `demos/village/homes/` stays untracked (stores and seeds are disposable); the village's
   code and docs ride the ticket's PR.
9. **P7 — Distill.** Repeated review findings become defenses (`/adlc:adlc-distill`).

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

The default posture is autonomous churn (Myk, 2026-07-13): Myk keeps `.adlc/tickets.json` stocked
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
  never a new root doc. The backlog is not a doc anymore: it is `.adlc/tickets.json` (a committed
  contract — don't reformat it; it's machine-written, and becomes a frozen rail once any ticket
  declares `rails`). Neither is the DESIGN surface: a work-in-progress spec is a **working spec** at
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
  human: **P1** (he keeps `.adlc/tickets.json` stocked — that is the approval of what to build) and
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
