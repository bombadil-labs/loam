## 2026-08-14 — v0.2.0: the design arc ships (340 PRs, §21–§45)

The second real release, and the first cut under branch protection. The recipe in `scripts/release.mjs`
pushes a version commit straight to `main`; `main` now enforces admins, so that push is refused. The
path that respects the protection, and is now the standing one: **bump via PR** (`npm version <bump>
--no-git-tag-version` — the `version` hook still syncs the in-source constants), Myk merges, then
**tag the merge commit** and push the tag alone. A tag push is not a branch push. The workflow fires
from the tag exactly as designed. `scripts/release.mjs` is now a description of the pre-protection
world; it should be rewritten to this shape or deleted (a ticket's worth, not this entry's).

Two lessons, both paid for once:

- **The release workflow ran the gate and never provisioned `@adlc/cli`.** Two suites drive the real
  CLI and FAIL CLOSED on CI when it is absent — correctly. `ci.yml` installs it; `release.yml` was
  written before those suites existed. First tag: gate red, publish never ran, nothing on npm. The
  fix is one step copied with its reason (#416). Then delete the tag, re-tag the fixed main, re-fire.
  A tag that never published is safe to move; a tag that published is not — check `npm view` first.
- **`gh release edit --notes-file` silently did nothing**, exactly as `gh pr edit --body-file` did
  earlier this month. `gh api -X PATCH ... -F body=@file` wrote it. Read the body back after any
  gh edit; the deprecation warning is the only tell.

The notes: a curated "what's new since 0.1.0" in STE, organized by what a person can now do, above
the generated PR list. Minor, not major — 0.x, where minor is the breaking-change signal, and 1.0 is a
stability promise the open decision tickets (T99, T161, T165, T172) do not yet let the spec make.
