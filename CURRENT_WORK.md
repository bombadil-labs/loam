# Current work

_The live checklist for the work in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each unit of work; cleared when it merges._

**Status: nothing in progress.** The v1 plan (build steps 0–9) is complete and merged, and the
landing is done — `CLAUDE.md` is process-only, `README.md` is a full manual, the package is
npm-ready. `main` is green; the working tree is clean. 151 tests, all steady under load.

**To resume:** there is no queued work. Ask Myk what to build next, then open it here at the loop's
stage 1 (see `CLAUDE.md`).

**Two things left, both Myk's by design (not to be automated):**

- Drop `"private": true` from `package.json` to allow publishing.
- Add the `LICENSE-MIT` and `LICENSE-APACHE` files (they carry a copyright line and a license
  choice that are the author's to make). Then `npm publish` is one command behind the gate
  (`prepublishOnly` runs `npm run check`).
