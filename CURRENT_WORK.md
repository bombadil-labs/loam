# Current work

_The live checklist for the work in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each unit of work; cleared when it merges._

**Status: step 10 (schema-schema cutover) is complete on the branch, awaiting Myk's merge.**
[PR #13](https://github.com/bombadil-labs/loam/pull/13) carries the whole step: the cutover,
the review resolution (all correctness findings fixed), the SPEC §5 passage, the README
"Schemas are data" section, and the JOURNAL entry. Gate green: 185/185, format+lint+typecheck+
build. **The merge is Myk's button** (the harness declines an agent merging its own PR — good).

**To resume after the merge:** nothing is queued. Ask Myk what to build next, then open it here
at the loop's stage 1 (see `CLAUDE.md`).

**Still Myk's by design (unchanged from the landing):**

- Drop `"private": true` from `package.json` to allow publishing.
- Add the `LICENSE-MIT` and `LICENSE-APACHE` files. Then `npm publish` is one command behind
  the gate (`prepublishOnly` runs `npm run check`).
