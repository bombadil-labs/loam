# Current work

_The live checklist for the work in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each unit of work; cleared when it merges._

**Status:** the v1 plan (build steps 0–9) is complete and merged. The landing is in progress:

- [x] Strip the "plan — build steps" section from `CLAUDE.md` (the journal is the record)
- [x] Rewrite `README.md` as a real manual (install, CLI, HTTP API, embedding, capabilities,
      runner, federation, deploy) grounded in the shipped code
- [ ] npm-publish prep: confirm the `files`/`bin`/`exports` tarball surface (pinned by
      `test/cli/pack.test.ts`); leave `"private": true` for Myk to drop at publish
- [ ] Land the landing (gate green → PR → merge)

**Left off here:** CLAUDE.md stripped, README rewritten; next confirm the package surface and
open the landing PR. After this: **regroup with Myk** to plan future phases (the autonomy grant
covered "until the plan's steps are secured").
