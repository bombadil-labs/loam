#!/usr/bin/env node
// P5 triage — decide which prosecution lenses a diff actually earns, before spending a subagent on it.
//
// The panel in `.claude/agents/` is six lenses, and running all six on every change is the
// bound-the-angles rule violated in the expensive direction: six context spin-ups, each re-reading
// the same diff, most of them with nothing to say. This script does the part that does not need a
// model — read the diff, decide what it TOUCHES, and name only the lenses with a reason to run.
//
// It also surfaces the two lenses that are already MECHANIZED and were never used as a gate:
//
//   - H6's common case is an ESLint error (eslint.config.js, no-restricted-syntax) — it fires in
//     `npm run check` for free. The lens is only worth spawning for what the selector cannot see:
//     a name flowing through a variable, a map key, or an error message.
//   - "could this test pass with the fix reverted?" is `adlc hollow-test`, which mutates the changed
//     code and reports the mutants your tests do not kill. That is the same question, answered
//     mechanically, on every changed line. Run it FIRST; a survivor is a finding without a model,
//     and a clean run narrows the lens to what mutation cannot reach — a vacuous fixture, a header
//     that overclaims, a feature that could be deleted whole.
//
// So the ladder is: free checks → mutation → a small number of chosen lenses → a verifier per
// finding. Never the reverse.
//
// This is a ROUTER, not a gate: it has no verdict and no exit-2. Deciding what to review is not the
// same as reviewing, and a script that pretended otherwise would be its own hollow gate.

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const baseArg = args.indexOf("--base");
const base = baseArg >= 0 ? args[baseArg + 1] : "origin/main";
const maxArg = args.indexOf("--max");
const max = maxArg >= 0 ? Number(args[maxArg + 1]) : 3;
const headArg = args.indexOf("--head");
const head = headArg >= 0 ? args[headArg + 1] : "HEAD";

const git = (a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let changed, diff;
try {
  changed = git(["diff", "--name-only", `${base}...${head}`])
    .split("\n")
    .filter(Boolean);
  diff = git(["diff", "--unified=0", `${base}...${head}`]);
} catch (err) {
  console.error(`p5-triage: cannot diff against ${base}: ${err.message}`);
  process.exit(1);
}

// Only ADDED lines, and only from CODE files, vote. Both halves were learned by running this
// against a docs-only diff and watching three lenses fire: the added lines were PROSE — a commit
// message and a runbook that happened to contain "erase" and "lensName" — and prose about erasure
// is not erasure. A lens triggered by deleted code is the same error pointed backwards, sending a
// reviewer to hunt for something that is no longer there.
const CODE = /\.(ts|mjs|js)$/;
const addedCode = (() => {
  const out = [];
  let file = null;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+?) b\//.exec(line);
    if (header) {
      file = header[1];
      continue;
    }
    if (file && CODE.test(file) && line.startsWith("+") && !line.startsWith("+++")) out.push(line);
  }
  return out.join("\n");
})();

const isSource = (f) => f.startsWith("src/") && f.endsWith(".ts");
const isTest = (f) => f.startsWith("test/") && f.endsWith(".ts");

// Each lens declares what evidence earns it. `paths` and `code` are independent signals; either can
// trigger, and both firing ranks it higher. Keep these patterns tied to the hazard, not to a
// filename fashion — a rename should not silently disarm a lens.
const LENSES = [
  {
    name: "loam-erasure",
    why: "erasure / completeness (H7, §11)",
    paths:
      /^src\/(gateway\/erase|gateway\/repair|store\/(mirror|archive|sqlite|memory|local-storage|quarantine))/,
    code: /\berase|purge|assertBytesGone|tombstone|removed\s*===|Math\.max\(|\bheal\b|holds\(/,
  },
  {
    name: "loam-suppression",
    why: "negation closure across a delta-set edge (H1)",
    paths: /^src\/(gateway\/(adopt|promote|genesis)|federation\/|migrate\/|store\/quarantine)/,
    code: /negat|suppress|struck|retract|withdraw|deltasSince|new Set\(|operand/i,
  },
  {
    name: "loam-lens-name",
    why: "lens-vs-program identity (H6)",
    paths: /^src\/(gateway\/(registration|genesis)|surface\/|server\/)/,
    code: /hyperschema\.name|lensName|lensOf\(|programOf\(|schema:/,
  },
  {
    name: "loam-scan-scale",
    why: "full-scan / stale-index (H8)",
    paths: /^src\/store\//,
    code: /deltasSince\(new Set|readdirSync|readdir\(|\.forEach\(.*\.forEach|for \(const .* of .*(all|every)|index/i,
  },
  {
    name: "loam-hollow-rail",
    why: "test adequacy — but run hollow-test first",
    paths: /^test\//,
    code: /\bit\(|\bexpect\(/,
  },
];

const scored = LENSES.map((l) => {
  const pathHits = changed.filter((f) => l.paths.test(f));
  const codeHit = l.code.test(addedCode);
  return { ...l, pathHits, codeHit, score: (pathHits.length > 0 ? 2 : 0) + (codeHit ? 1 : 0) };
})
  .filter((l) => l.score > 0)
  .sort((a, b) => b.score - a.score);

const picked = scored.slice(0, max);
const dropped = scored.slice(max);

const changedSource = changed.filter(isSource);
const changedTests = changed.filter(isTest);

const mechanical = [];
mechanical.push({
  name: "lint (H6 selector)",
  cmd: "npm run lint",
  note: "free; already part of npm run check",
});
if (changedSource.length > 0) {
  mechanical.push({
    name: "hollow-test",
    cmd: `adlc hollow-test --test-cmd "npx vitest run" --base ${base} ${changedSource.map((f) => `--target ${f}`).join(" ")}`,
    note: "mutates changed source; a survivor is a finding with no model involved",
  });
}

if (asJson) {
  console.log(
    JSON.stringify(
      { base, changed, changedSource, changedTests, mechanical, lenses: picked, dropped },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`p5-triage: ${changed.length} file(s) changed against ${base}`);
console.log(`  source: ${changedSource.length}   tests: ${changedTests.length}\n`);

console.log("RUN THESE FIRST — no tokens:");
for (const m of mechanical) console.log(`  ${m.name}\n    ${m.cmd}\n    (${m.note})`);

if (picked.length === 0) {
  console.log(
    "\nNo lens indicated. Nothing in this diff matches a hazard the panel covers — that is a\n" +
      "valid outcome, not a reason to run all six. If you believe a lens applies anyway, say which\n" +
      "signal was missed and add it here; a lens chosen by hand this time is a lens nobody routes\n" +
      "to next time.",
  );
} else {
  console.log(
    `\nTHEN SPAWN ${picked.length} LENS(ES), independently, without the author's reasoning:`,
  );
  for (const l of picked) {
    const ev = [
      l.pathHits.length > 0 ? `paths: ${l.pathHits.slice(0, 3).join(", ")}` : null,
      l.codeHit ? "code signal in added lines" : null,
    ]
      .filter(Boolean)
      .join(" | ");
    console.log(`  ${l.name.padEnd(18)} ${l.why}\n    ${ev}`);
  }
  console.log("\n  then: loam-verifier, once per finding — not once per lens.");
}

if (dropped.length > 0) {
  console.log(
    `\nDROPPED by --max ${max} (lower signal, named so the cap is not silent): ` +
      dropped.map((l) => l.name).join(", "),
  );
}
