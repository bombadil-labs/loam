#!/usr/bin/env node
// The comment-budget gate (Myk, 2026-07-23): CLAUDE.md's comment discipline, made checkable.
// Examines only the lines a branch ADDS — history is grandfathered, exactly like rails-guard-ci.
//
// Two checks, different sins:
//   RATIO   — added-comment / added-code above the threshold fails, but only on diffs adding
//             enough code to mean it. The threshold is main's own measured average (25%): new
//             code may not out-comment the norm the codebase already carries.
//   MARKERS — a comment narrating HISTORY (a review round, an earlier draft, a confidence score)
//             fails at ANY ratio; each offending line is printed. This is the "tell" from
//             CLAUDE.md as a regex.
//
// The override is a COMMIT TRAILER, not an env var: `Comment-Budget: <why>` in the HEAD commit
// message passes the gate loudly, so the exception is auditable prose in history.
//
// Exit codes match the house style: 0 pass, 1 operational, 2 over budget.

import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";
const RATIO_MAX = 0.25;
const MIN_CODE_LINES = 80;

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const trailer = /^comment-budget:\s*\S/im;
let headMsg;
try {
  headMsg = git(["log", "-1", "--format=%B"]);
} catch (err) {
  console.error(`comment-budget: cannot read HEAD: ${err.message}`);
  process.exit(1);
}
if (trailer.test(headMsg)) {
  console.log(
    `comment-budget: OVERRIDDEN by the HEAD commit's Comment-Budget trailer — the reason is in history where it belongs.`,
  );
  process.exit(0);
}

let diff;
try {
  diff = git(["diff", `${base}...HEAD`, "--", "src/*.ts", "src/**/*.ts", "scripts/*.mjs", "test/**/*.ts"]);
} catch (err) {
  console.error(`comment-budget: cannot diff against ${base}: ${err.message}`);
  process.exit(1);
}

// A block-comment interior line starts with `*`; both styles count. Only ADDED lines are judged.
const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
const commentLines = added.filter((l) => /^\+\s*(\/\/|\/\*|\*)/.test(l));
const codeLines = added.filter((l) => !/^\+\s*(\/\/|\/\*|\*|$)/.test(l));

// The tell, as a regex: phrases that narrate how the code got here rather than what bites next.
const MARKERS =
  /\b(an earlier (draft|form|version|fix)|premortem C?\d|round (one|two|three|four|five|six|seven|eight|nine|ten|\d+)['’]?s?\b|confidence [01]\.\d|conf 0\.\d|adversarial[- ]review|prosecution|caught by (a |the )?(review|audit|lens)|audit (found|\d)|probed (red|to certainty)|PR #\d)/i;
const markerHits = commentLines.filter((l) => MARKERS.test(l));

if (markerHits.length > 0) {
  console.error(
    `comment-budget: ${markerHits.length} added comment line(s) narrate HISTORY — that lives in the commit message and the journal, never the file:`,
  );
  for (const l of markerHits.slice(0, 20)) console.error(`  ${l.slice(1).trim()}`);
  process.exit(2);
}

if (codeLines.length >= MIN_CODE_LINES) {
  const ratio = commentLines.length / Math.max(1, codeLines.length);
  if (ratio > RATIO_MAX) {
    console.error(
      `comment-budget: ${commentLines.length} comment lines against ${codeLines.length} code lines ` +
        `(${Math.round(ratio * 100)}%) exceeds the ${Math.round(RATIO_MAX * 100)}% budget — main's own ` +
        `average. Cut each comment to the invariant, the hazard, or the why (1-3 lines), or override ` +
        `deliberately with a 'Comment-Budget: <reason>' trailer in the HEAD commit.`,
    );
    process.exit(2);
  }
  console.log(
    `comment-budget: ${commentLines.length}/${codeLines.length} added comment/code lines (${Math.round((commentLines.length / Math.max(1, codeLines.length)) * 100)}%) — within budget.`,
  );
} else {
  console.log(
    `comment-budget: only ${codeLines.length} added code lines (< ${MIN_CODE_LINES}) — too small to gate, and no history markers found.`,
  );
}
process.exit(0);
