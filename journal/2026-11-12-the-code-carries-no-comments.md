# The code carries no comments

*2026-11-12. Claude, under a ruling from Myk in chat. The pull request carries the mechanics.*

## The measurement

- Comments were 45% of the bytes in `src/` and 26% of the bytes in `test/`.
- An agent reads every one of those bytes each time it opens a file.
- `src/` fell from 3,023,730 bytes to 1,652,187 bytes.
- `test/` fell from 5,957,600 bytes to 4,384,664 bytes.

## The decision

- Myk ruled: "delete everything and then add them if we get bitten later".
- `scripts/strip-comments.mjs` removed every comment in one mechanical commit.
- Only tool directives stay: `eslint-disable`, `@ts-expect-error`, `prettier-ignore`, coverage
  hints, `@vitest-environment`, `#__PURE__` and triple-slash references.
- `npm run check` now runs `npm run comments:check`. A new comment fails the bar.
- A hazard lives in `src/gateway/SUBSTRATE-HAZARDS.md`. History lives here and in commit messages.
- A known gap in a rail goes in the test title, for example `[gap: no door-level assertion]`.
- `comments:check` reads every tracked `.ts`, `.mts`, `.cts`, `.tsx`, `.mjs`, `.cjs` and `.js` file.
  It also reads untracked files that git does not ignore.
- It excludes vendored bundles, `node_modules`, `demos/village/homes/`, and `dist/` and `site-dist/`
  at the repo root.
- Inline `<script>` in `.html` files is out of scope. Comments in YAML are out of scope.

## The proof

- The script finds comments with the TypeScript parser, never with a regular expression.
- The script refuses to write a file if its token stream changes.
- The script also refuses if a line break before a token changes. A line break decides automatic
  semicolon insertion.
- We compiled the whole TypeScript program with `removeComments` before and after the strip.
- 566 of 587 emitted files are byte-identical.
- The other 21 differ only where Prettier moved a line break or a trailing comma.
- Their token streams are identical apart from one trailing comma.
- For every in-scope file, the token stream before and after matches the same way.

## What broke, and the repair

- Three tests asserted on comment text. They now assert on behavior or on code.
- The erasure-screen census found its region by a comment banner. It now uses a function name.
- ESLint's `no-empty` read a comment as the content of an empty `catch`. The config now allows an
  empty `catch`.
- The doc generator wrote a header comment into `src/server/docs-content.ts`. It no longer does.

## The gap notes

- Some test files named their own gaps in comments. The strip deleted those notes too.
- `test/server/credentials.test.ts` is an example. Its header named two gaps: the file mode on
  Windows, and `fsync`.
- About 120 such notes were deleted. Myk ruled not to restore them.
- Recover them from the commit before the strip, as below.
- Four working-spec criteria named such a comment as their check. Each criterion now says so.

## How to recover a deleted comment

- Every comment is in the commit before the strip commit.
- `git log -S "<words>" -- <path>` finds the commit that held a phrase.
- `git show <strip-commit>^:<path>` prints the file as it was, with its comments.
- If a missing comment causes a real defect, record the defect in the journal first.
- Then propose a change to the rule in CLAUDE.md.
