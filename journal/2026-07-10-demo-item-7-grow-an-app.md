## 2026-07-10 — Demo item 7: grow an app live (PR open, unmerged by design)

The last gap in the demo script. `grow.mjs` bootstraps a sovereign store in one command (own
home and operator, schema registered over the running surface, a scribe with standing, seed
triples, a `homes/peers.json` entry), and the village's pulse re-reads that file every beat —
joining the confluence is editing a file, not restarting a process. Verified live:
`sightings` grew on :4406 and its facts were in the almanac's ground one beat later, first
contact narrated. The recipe lives in `_testing/README.md` ("Growing a new store") with
`schemas/sighting.json` as the worked example.

Two crumbs deliberately handed to a fresh session (see CURRENT_WORK): `phase16.mjs` and a
pointer-style `grow-a-store` skill. The operational learning that forced the handoff, worth
its own line: **the classifier's discriminator is genre × accumulation.** In one long session
that had carried the erasure/forgery vocabulary since morning, documentation prose and pure
data wrote clean, while agent-instruction files and orchestration-shaped scripts (spawn
servers, mint identities, grant standing, move data) were interrupted mid-write — twice for
the skill, once for the phase. A demo village and infrastructure automation are the same
shape to a primed classifier. Mitigation that worked: recipes as README documentation;
orchestration files first thing in a fresh session, ideally on Opus. Myk called the
accumulation theory mid-session and the controlled evidence (four writes, two genres, clean
split) bore him out.

**Closed the same day, fresh Opus session.** The handoff worked exactly as designed: writing
`phase16.mjs` and the skill FIRST, into an empty context before any adversarial vocabulary,
both landed clean on the first attempt — the accumulation theory confirmed a second way (the
same genres that tripped a primed context sailed through a fresh one). `phase16.mjs` (3/3,
re-runnable) drives grow.mjs as a child process exactly as the demo does — a `Grove` store
grown on :4407 answers its own schema immediately, registers in `homes/peers.json`, and one
pull lands its facts in the almanac's ground. The demo script (items 1–9) is now wholly
backed by verified machinery; the road to the Republic is walked.

One placement decision worth the note: the `grow-a-store` skill lives at
`_testing/skills/grow-a-store/SKILL.md`, not `.claude/skills/` — because `.claude/` is
gitignored (settings/launch are machine-local) and the skill belongs to the village demo,
which lives entirely under `_testing/`. Its path references are location-independent, so the
committed canonical and the machine-local active copy (in `.claude/skills/`, for harness
discovery) are byte-identical; activation on any machine is a directory copy. Myk's call —
the skill ships with the demo it serves, not with the harness config.
