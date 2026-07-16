## 2026-07-16 — The journal becomes a folder, for the reason the spec did

Myk asked the sharp version of the question: "is our width bounded mostly by the journal? would it make
sense to break that up the way we did schema?" The first half is answered by data, and the answer is NO —
`JOURNAL.md` appears in no ticket's `scope`, so `merge-forecast` has never once seen it. Width is bounded
by **`src/gateway/gateway.ts`**: 2,166 lines holding `append`, `federate`, `erase`, `promote`,
`openQuarantine`, `serveRoute`, `writeRoute`, `serveBytes`, `register`/`rebind`, `query`, the public-door
predicates, as-of, and the resolver memo. Every ticket collides there because everything lives there — T2
rewires its serving loop, T16 fixes its erase fan-out, T18 caps its render path: three unrelated concerns,
one file. The shared spec sections (§24 in three tickets at once) are the rest.

But the second half stands on its own merits, and this entry is the change: the journal was a real
papercut even though it was never the bound. It conflicted **twice today** — #114 and the audit branch,
both trivial append-order, both hand-resolved. So it splits exactly as the spec did (2026-07-13): the
monolith becomes **`journal/<date>-<slug>.md`, one file per entry**, and `JOURNAL.md` becomes the index —
preamble plus a date/title table. 2,333 lines → a 79-line index + 67 entry files. A new entry is now a NEW
FILE, so two concurrent landings never touch the same one.

**The honest limit, stated so nobody oversells this later:** it shrinks conflicts, it does not abolish
them. Every landing still appends one row to the index, and two landings on one day still meet there — but
they meet over a ONE-LINE row instead of thirty lines of prose, which is the difference between a
two-second resolution and a two-minute one. This is precisely the deal `SPEC.md` already runs on, and it
was worth taking for the same reason. A monotonic `NNN-` prefix was considered and REFUSED: a shared
counter is a shared resource, so two concurrent PRs would both grab `0068` and collide on the number —
reintroducing the exact conflict the split exists to remove. Date+slug has no such contention.

Three things worth keeping:

- **The migration verified itself, and the verifier fired.** The splitter asserts the rejoined entries
  equal the original before writing a single file, and it FAILED on the first run — over one missing blank
  line between two entries. That wart was left by my own hand-resolution of one of today's journal
  conflicts, hours earlier. The papercut had already drawn blood, quietly, and the guard is what found it.
  The assertion was then relaxed to "identical modulo blank lines before headings" and SAYS so — a
  verifier that is loosened without stating what it stopped checking is worse than none.
- **One entry had no date** (`## SPEC §14 — clearing is retraction…`). It sits between two 2026-07-12
  entries and git agrees, so it was stamped, not invented — and every file is now self-describing.
- **A pre-existing broken link, found while restructuring what it pointed at.** Four `spec/*.md`
  provenance footers said `[Journal](JOURNAL.md)`, which from inside `spec/` resolves to
  `spec/JOURNAL.md` — nonexistent, and broken since the spec split. Now `../JOURNAL.md`. Reorganizing a
  thing is when you find out who was pointing at it wrong.

Learning, and it generalizes past docs: **the friction you feel and the constraint that binds you are
different things, and the loud one is usually not the bound.** The journal conflicted twice today and was
therefore top-of-mind; it costs width zero. `gateway.ts` never once announced itself and it is the whole
ceiling. Fix the papercut because papercuts are cheap to fix — but do not mistake having fixed it for
having widened anything. (And the actual bound may not be worth attacking either: at width 1 the
bottleneck is the human at P6, not the builder. Decomposing a 2,166-line class on the capability/erasure
surface should be argued on readability and testability — a design-stage call, Myk's — never smuggled in
as a parallelism optimization.)
