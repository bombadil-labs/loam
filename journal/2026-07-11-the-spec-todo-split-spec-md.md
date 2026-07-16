## 2026-07-11 — The SPEC/TODO split: SPEC.md becomes a history, TODO.md holds the backlog

Myk's process change: SPEC.md had grown to 956 lines by always appending, and mixed shipped
design with speculative/queued design under stale header tags ("queued" on sections that landed
weeks ago). Two moves fix it. (1) **SPEC.md is now the record of what IS** — grown only by a
landing PR, and every section carries a `**Provenance.**` footer linking the PR(s) that landed
it plus a short implementation note (the modules, the key decision). One long reliable history
with links to the PRs that go deeper. (2) **Unbuilt/partial design lives in [TODO.md](TODO.md)**
until its work lands, at which point the landing PR migrates it into SPEC.md with its footer. The
five-doc rule became six (CLAUDE.md amended; the loop's re-plan stage rewritten to this flow).

Executed as: a 3-agent Sonnet fan-out backfilled provenance footers across all 18 built/
foundational sections from JOURNAL + git history (I hand-wrote §1/§2/§11 first to fix the format,
then the agents mirrored it); §14 (write semantics — genuinely unbuilt) moved out to TODO.md as
the first backlog item, carrying the open "clear-others" question Myk raised (when a policy admits
others' claims, does "clear" mean retract-your-own or lens-scoped suppression — and who may negate
another's delta); the renderer task (§20 reserved, design-first) and the hardening pass joined it.
No section was renumbered — the cross-references (§15/§17/§19, and the tutorial's "SPEC §14 lands"
copy) stay valid; §14 keeps its number as a stub pointing at TODO.md. A fourth Sonnet agent
fact-checked every footer's PR numbers and module paths against the history.

Learning worth keeping: the fan-out is the right shape for a backfill — parallel research over
disjoint section-ranges, each agent returning TEXT (not editing the shared file), the orchestrator
placing it via one deterministic script so formatting can't drift between agents. Establishing the
format by hand on two or three sections BEFORE fanning out is what kept eighteen footers uniform.
