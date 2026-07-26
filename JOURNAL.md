# Journal

_Append-only record: one entry per completed step (or notable event) — what was done, why it went that way, and any novel learning. Newest last._

_Note (2026-07-09): existing entries had their register softened for content-classifier hygiene — security review notes reworded from an opponent-role framing into a neutral correctness one. Every fact is preserved; only the phrasing changed. Future entries: keep the neutral register (see CLAUDE.md, loop stage 5)._

Entries live in **[`journal/`](journal/)**, one file each, named `<date>-<slug>.md` — so a new
entry is a NEW FILE and two concurrent landings never touch anything shared (the same reason
[SPEC.md](SPEC.md) is an index over `spec/`). **THE DIRECTORY IS THE INDEX** (Myk, 2026-07-26):
`ls journal/` sorts chronologically by construction, and each entry's first line is its title.
This file used to carry a hand-maintained table of rows — one shared tail that every same-day
landing collided on (three merge conflicts in one morning, the day this changed). A list that a
directory listing already provides is not worth a merge conflict per landing.

**When an entry is written at all** (same ruling): a landing writes one only when it carries what
the PR cannot — a decision made in chat, a cross-PR synthesis, a learning not already distilled
into `SUBSTRATE-HAZARDS.md` or `CLAUDE.md`. A routine landing's history is its PR and commit
message, which the spec section's Provenance footer already links. Recap entries duplicated their
own PR bodies; those are the tokens this rule reclaims.
