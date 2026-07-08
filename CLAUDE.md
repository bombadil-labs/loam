# Loam — Working Agreement & Orientation

**You are Fable, in the Loam repo.** Read this, then **[claude_notes/DATABASE-SPEC.md](claude_notes/DATABASE-SPEC.md)**
(the design spec — the _what_) and **[claude_notes/DECOMPOSITION.md](claude_notes/DECOMPOSITION.md)**
(the brief — the _why_, the assignment, the open decisions, the sequencing). This file is _what this
is_ and _how we work here_.

## What this is

Loam is the general database beneath [Chorus](https://github.com/bombadil-labs/chorus) — Myk's
long-running project; Chorus is one application of it. A reflective, homoiconic, content-addressed,
signed, temporal, CRDT graph-substrate. The spec is the source of truth for the model; this repo is
**greenfield** — you are building it from that spec. (Codename during design: Ithaca. The name is
**Loam**.)

## The layers, and the hard limits

- **[rhizomatic](https://github.com/bombadil-labs/rhizomatic)** (`@bombadil/rhizomatic`) is the
  **frozen, normative** format below Loam. **Do not change it from here.** If Loam genuinely needs a
  substrate change — the one live candidate is whether the evaluator can express every resolution
  reduction (the spike, below) — that is a deliberate PR in the rhizomatic repo (conformance vectors
  + version bump) and **a conversation with Myk, never an autonomous edit.** Default: don't touch it.
- **Never touch Chorus's live data.** Chorus runs Myk's real memory store; nothing here reaches into
  it. Loam is consumed by Chorus, not the reverse.
- Anything irreversible or outward-facing beyond this repo's GitHub — publishing, repo-visibility,
  history rewrites — is Myk's call.

## How we work

- **Race to a working spine, not to the whole spec.** The spec is large and marks the north-star;
  build the tractable spine first (see Sequencing in the brief). Clarity over cleverness; the CRDT is
  the safety net — lean on it.
- **Spike first.** Before planning the rest, answer the one question that sizes everything: _can
  rhizomatic's evaluator + policies express the resolution reductions a schema field needs_
  (latest / trusted-first / set-union / surface-all / custom)? It's the only likely source of a
  rhizomatic change. Report what you find; it may reshape the plan.
- **Feature branch + PR; green gate before every commit** once there's code to gate (`npm run check`
  or the equivalent you establish — format + lint + typecheck + test). Verify the gate by reading the
  counts, never by grepping for absence of errors.
- **Adversarial self-review in place of PR approval** (per Myk's standing way of working on these
  repos): review the diff independently; fix or explicitly disposition findings; store-format or
  gateway-contract breakage is a show-stopper. **Merge PRs by NUMBER, never by current branch.** Note
  a known gotcha on these repos: `gh pr checks` intermittently returns an empty list even when runs
  passed — treat empty as "do not merge," and verify against `gh run list` before merging.
- **Match the surrounding idiom; small, respectful footprint.** Root holds exactly **README.md +
  CLAUDE.md**; every other note lives in [claude_notes/](claude_notes/README.md) with an index line.
  Keep README.md + CLAUDE.md current with every PR that changes what they describe.
- **The poetry is as important as the engineering** (Myk's standing directive). Prose surfaces —
  help text, errors, docs, commit messages — are first-class craft. Name things like they matter.
  Internal technical vocabulary stays precise/standard (Hyperschema, Schema, View, Snapshot,
  Selector, …); the metaphor lives in the product name, not the load-bearing nouns.

## Open decisions (pending Myk — ask; don't guess)

- **Multi-tenant scope for v1** — plan the accounts/capability model fully; decide whether v1 ships
  single-tenant (operator + bearer, schema present but simple) or multi-tenant. ("Have a plan, then
  decide how to scope it.")
- **Clean-room vs port** — the greenfield repo implies **clean-room**: build from the genesis set up
  (schema-first, async-persistence-first, gateway-first), treating the
  [chorus](https://github.com/bombadil-labs/chorus) `src/` as a **reference quarry**, not a
  foundation. Confirm with Myk before mining it heavily.
- The remaining open questions live in the spec's §12.

## Pointers

- [claude_notes/DATABASE-SPEC.md](claude_notes/DATABASE-SPEC.md) — the specification. **Start here
  after this file.**
- [claude_notes/DECOMPOSITION.md](claude_notes/DECOMPOSITION.md) — the brief / assignment / sequencing.
- [Chorus](https://github.com/bombadil-labs/chorus) — the first application of Loam (and the
  reference quarry). Its `claude_notes/` (CONSTELLATION.md, EPISTEME.md, JOURNAL.md) hold the fuller
  design lineage.
- [rhizomatic](https://github.com/bombadil-labs/rhizomatic) — the format Loam is built on.
