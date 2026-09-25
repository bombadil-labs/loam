// How hermetic a source tree is already. Runs hermetic's prefer-hermetic rule in report mode, so
// nothing is changed. Every candidate function is already hermetic, liftable by the rule's fix,
// or left for a person. Shares are given by count and by code lines.
// Usage: node refactor/tools/hermetic-census.mjs [dir=src]

import path from "node:path";
import { candidates, classify, codeLines, lintHermetic, parse, pct, sourceFiles } from "./lib.mjs";

const dir = process.argv[2] ?? "src";
const results = await lintHermetic(path.resolve(dir), ["**/*.ts"], {
  "hermetic/prefer-hermetic": ["warn", { lift: true }],
});
const byFile = new Map(results.map((r) => [path.resolve(r.filePath), r.messages]));

const rows = [];
for (const file of sourceFiles(dir)) {
  const parsed = parse(file);
  const cls = classify(parsed);
  const lineStarts = parsed.sf.getLineStarts();
  const cands = candidates(parsed).map((c) => ({
    ...c,
    file,
    verdict: "left",
    lines: codeLines(parsed.text, cls, lineStarts[c.startLine - 1], c.node.end),
  }));
  for (const m of byFile.get(path.resolve(file)) ?? []) {
    if (m.ruleId !== "hermetic/prefer-hermetic") continue;
    const owner = cands
      .filter((c) => c.startLine <= m.line && m.line <= c.endLine)
      .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
    if (owner) owner.verdict = m.messageId;
  }
  rows.push(...cands);
}

const sum = (list) => ({ n: list.length, lines: list.reduce((s, c) => s + c.lines, 0) });
const all = sum(rows);
console.log(`${all.n} candidate functions, ${all.lines} code lines.`);
for (const v of ["alreadyHermetic", "liftable", "left"]) {
  const s = sum(rows.filter((c) => c.verdict === v));
  console.log(
    `${v.padEnd(16)} ${String(s.n).padStart(5)} ${pct(s.n, all.n).padStart(7)}   lines ${pct(s.lines, all.lines).padStart(7)}`,
  );
}
console.log("\nBy top-level directory (lines: hermetic / liftable / left):");
const areas = [...new Set(rows.map((c) => path.relative(dir, c.file).split(path.sep)[0]))].sort();
for (const a of areas) {
  const inArea = rows.filter((c) => path.relative(dir, c.file).split(path.sep)[0] === a);
  const t = sum(inArea).lines;
  const share = (v) => pct(sum(inArea.filter((c) => c.verdict === v)).lines, t);
  console.log(
    `${a.padEnd(18)} ${share("alreadyHermetic").padStart(6)} / ${share("liftable").padStart(6)} / ${share("left").padStart(6)}   of ${t}`,
  );
}
const leftKinds = new Map();
for (const c of rows.filter((r) => r.verdict === "left"))
  leftKinds.set(c.kind, (leftKinds.get(c.kind) ?? 0) + 1);
console.log(`\nLeft alone, by kind: ${[...leftKinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
