# Current work — SPEC/TODO split + provenance backfill

_In flight (branch `spec-todo-split`). Establishes the doc model Myk asked for: SPEC.md is the
record of what IS (grown only by landing PRs, every section carrying a `**Provenance.**` footer),
and unbuilt/partial design lives in [TODO.md](TODO.md) until its PR migrates it in._

## Done this step

- [x] `CLAUDE.md`: five-doc rule → **six** (TODO.md named); the loop now keeps unbuilt steps in
      TODO.md and migrates them to SPEC.md via the landing PR, with a Provenance footer.
- [x] `TODO.md` created: the backlog — §14 write-semantics (moved out of SPEC, carries its OPEN
      clear-others question), the renderer task (design-first, §20 reserved), the hardening pass.
- [x] `SPEC.md`: `**Provenance.**` footers on all 18 built/foundational sections (PR links +
      implementation notes), backfilled from JOURNAL + git history by a 3-agent Sonnet fan-out;
      §14 replaced by a stub pointing to TODO.md; stale `(queued)/(SHIPPED)` header tags removed.
      No section renumbering — the cross-references (§15, §17, §19, …) stay valid.

## Remaining before merge

- [ ] Verify PR→section attributions are accurate (a review agent cross-checks the footers'
      PR numbers + module paths against JOURNAL/git — the footers must be a *reliable* history).
- [ ] `npm run check` (docs-only, but the gate must stay green) + link sanity.
- [ ] JOURNAL entry recording the process change; PR through the cycle.

## After this: the backlog is TODO.md

Next steps live in [TODO.md](TODO.md): the **renderer task** (opens at design/SPEC stage, STOP
for Myk before code) and the **hardening pass**. §14 write-semantics is unblocked only once Myk
rules on the clear-others question.
