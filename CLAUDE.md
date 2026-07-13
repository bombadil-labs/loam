# Loam — how we work

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic); the
design is in **[SPEC.md](SPEC.md)** and the usage in **[README.md](README.md)** — read them before
writing code. **Get up to speed on what Loam is and how it works from SPEC.md.** This file is the
**process**. The backlog of unbuilt/partial design now lives as **ADLC tickets** in
`.adlc/tickets.json` — the contract every gate reads (it replaced the old `TODO.md` +
`CURRENT_WORK.md` hand-tracked pair). **[JOURNAL.md](JOURNAL.md)** remains the append-only record;
keep it current as you make decisions.

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
premature satisfaction is the point. Inside Claude Code *you are the model*: run any LLM-backed gate
with `--prompt-only`, answer the printed prompt yourself, and apply the judgment (no API keys
needed). Route with the `adlc` discovery skill; `adlc <tool> --help` for a tool's exact flags.

The phases, with Loam's own craft folded into each:

1. **P0 — Author the ticket** (`/adlc:adlc-ticket`). Turn the work into a self-contained ticket in
   `.adlc/tickets.json` — the body must stand alone (an agent can't see the conversation), the
   `scope`/`rails`/`edges` honest. `coldstart` will check it is executable without guesswork; a
   vague ticket fails it, and that failure is the signal to split it into finer tickets.
2. **P1 — Interrogate / design-stage.** `adlc spec-lint`, `premortem`, `parallax`, and
   `adversarial-review --prompt-only` on the ticket/design. **Many Loam tickets are "design-stage":
   the first deliverable is the drafted SPEC-section prose (staged as its future `spec/NN-*.md`
   file, to land when the work merges) plus answers to the ticket's listed design questions — and then you STOP and wait for Myk's word in
   chat before writing implementation code.** "He'd probably approve" is not his word. That stop is
   the P6 human gate arriving early, at design time.
3. **P2 — Decompose.** `adlc coldstart <id> --prompt-only` (executability), `adlc model-router`
   (which model strategy), `adlc merge-forecast` (fan-out width + `mergeOrder`).
4. **P3 — Rail (tests first).** Write clean, honest tests that capture everything in the ticket —
   the behavior it must exhibit, asserted against real outcomes, not against the shape of the
   implementation. **No reward-hacking: a test that can pass without the desired behavior is a bug.**
   Freeze them as `rails` on the ticket; `adlc rails-guard` (and the plugin's PreToolUse rail hook)
   then protect them. Once any ticket declares `rails`, `.adlc/tickets.json` itself becomes a frozen
   trust root — edits need `ADLC_RAILS_BYPASS=1` (an audited, deliberate act).
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
   ever stylistic. **Budget: one careful review pass per PR** (self-review directly for small
   mechanical diffs); a 2–3-angle panel only for the riskiest tickets (capabilities/auth,
   federation — the §23 renderer ticket names its own panel). Token spend must last the whole
   backlog. **Audits are paused** (Myk, 2026-07-09): audit 1 cost ~5% of the total token budget — no
   further audit panels until the arc and its landings are done. Retro to apply before any future
   audit: the per-finding verify stage was ~80% of the cost and refuted only 1 of 24 candidates (the
   finders were already precise), and three findings were found by multiple overlapping angles — so
   a future audit is 3–4 tightly-scoped finder angles, **no** verify stage (the fixer verifies while
   fixing), findings capped per angle.
7. **P6 — Integrate (the human gate).** Myk decides. Surface the evidence (`adlc gate-manifest
   show`, behavior diffs). **The landing PR writes the ticket's design as a new `spec/NN-slug.md`
   file** — the whole section, closed by its `**Provenance.**` footer (the PR link(s) + a short
   implementation note) — adds its row to the `SPEC.md` index, and removes the realized ticket from
   `.adlc/tickets.json`. The spec grows only here, never speculatively; a new file is the default,
   editing an existing section the rare exception. Append a record to `JOURNAL.md` (what was done +
   any novel learning).
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

## Standing rules

- **Root holds exactly four markdown docs** — `README.md` (the vision), `CLAUDE.md` (the process),
  `SPEC.md` (the spec **index**: preamble + the section table), `JOURNAL.md` (the append-only
  record). The spec itself is the **`spec/`** folder — one `NN-slug.md` file per section, what IS,
  grown only by landings, each file footered with its provenance. The backlog is not a doc anymore:
  it is `.adlc/tickets.json` (a committed contract — don't reformat it; it's machine-written, and
  becomes a frozen rail once any ticket declares `rails`). Do not accumulate more root markdown;
  fold, don't add — and a new spec section is a new file in `spec/`, never a new root doc.
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

- **Commit freely; push on request** (Myk, 2026-07-13) — commits are safe, reversible checkpoints
  and part of autonomous progress: make them at coherent checkpoints without asking first, on a
  feature branch (never `main`), with real messages (the poetry rule applies to commits too).
  Pushing is outward-facing — ask before pushing. (This replaced the deleted fleet-level
  control-pane rules; Loam is governed per-repo by this file.)
- **v1 is fully multi-tenant** (SPEC §7) — tenant isolation is first-class in the genesis schemas
  and gateway enforcement (Myk, 2026-07-09).
- **Chorus is reference-only** (SPEC §10) — read its plumbing as a design guide; Loam's code is
  written clean, against Loam's own tests.
- **`@bombadil/loam` publishes to npm** for turnkey install. The package is kept `"private": true`
  until Myk runs the publish; the `files`/`bin`/`exports` surface is pinned by `test/cli/pack.test.ts`.
  The publish button is Myk's.
