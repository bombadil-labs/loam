// The census ratchet: coupling counts that may only fall. Fails when a count rises above
// `ratchet.json`, and when one falls below it, so a gain is locked in by rewriting the file.
// Usage: node refactor/tools/ratchet.mjs [--write]

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { importGraph, parse, sourceFiles, stronglyConnected } from "./lib.mjs";

const BASELINE = path.join(import.meta.dirname, "ratchet.json");

// Code that decides; the doors, the CLI and the clients may read the clock.
const CORE = /^src\/(gateway|federation|store|runner|surface|migrate|stock)\//;

const files = sourceFiles("src");
const { edges } = importGraph(files);

const counts = {
  // Files in the largest cycle over value imports.
  largestImportCycle: Math.max(0, ...stronglyConnected(edges, false).map((c) => c.length)),
  // Reads of the operator's private key: `options.seed`, on any receiver.
  seedReads: 0,
  // Full copies of the delta set: `<...>reactor.snapshot()`.
  snapshotCalls: 0,
  // Wall-clock reads in core code: `Date.now()`, `performance.now()`, `new Date()`.
  coreClockReads: 0,
};

for (const file of files) {
  const { sf } = parse(file);
  const core = CORE.test(file);
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "seed") {
      const on = n.expression;
      const receiver = ts.isPropertyAccessExpression(on) ? on.name.text : on.getText(sf);
      if (receiver === "options") counts.seedReads++;
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const { name, expression } = n.expression;
      const target = expression.getText(sf);
      if (name.text === "snapshot" && n.arguments.length === 0 && /reactor$/i.test(target)) {
        counts.snapshotCalls++;
      }
      if (core && name.text === "now" && (target === "Date" || target === "performance")) {
        counts.coreClockReads++;
      }
    }
    if (core && ts.isNewExpression(n) && n.expression.getText(sf) === "Date") {
      if ((n.arguments?.length ?? 0) === 0) counts.coreClockReads++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`census: wrote ${path.relative(process.cwd(), BASELINE)}`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
let failed = false;
for (const [name, now] of Object.entries(counts)) {
  const was = baseline[name];
  if (was === undefined) {
    console.log(`census: ${name} = ${now} has no baseline; run with --write`);
    failed = true;
  } else if (now > was) {
    console.log(`census: ${name} rose from ${was} to ${now}. Coupling may only fall.`);
    failed = true;
  } else if (now < was) {
    console.log(`census: ${name} fell from ${was} to ${now}. Lock it in: run with --write.`);
    failed = true;
  }
}
if (!failed) console.log(`census: ${JSON.stringify(counts)}`);
process.exit(failed ? 2 : 0);
