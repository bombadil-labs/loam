// Where the defensive prose sits: each subsystem's share of comment characters, and its hazard
// (H1, H2, ...) and ticket (T1, T2, ...) citations, raw and per 1,000 code lines. Hazards are
// defined in src/gateway/SUBSTRATE-HAZARDS.md.
// Usage: node refactor/tools/hazards.mjs [dir=src]

import {
  classify,
  commentBlocks,
  hostSplit,
  parse,
  pct,
  sourceFiles,
  subsystemOf,
} from "./lib.mjs";

const dir = process.argv[2] ?? "src";
const bySub = new Map();
for (const file of sourceFiles(dir)) {
  const parsed = parse(file);
  const a = bySub.get(subsystemOf(file)) ?? { chars: 0, hazards: 0, tickets: 0, code: 0 };
  a.code += hostSplit(parsed, classify(parsed)).total;
  for (const b of commentBlocks(parsed)) {
    a.chars += b.text.length;
    a.hazards += (b.text.match(/\bH\d{1,2}\b/g) ?? []).length;
    a.tickets += (b.text.match(/\bT\d{1,3}\b/g) ?? []).length;
  }
  bySub.set(subsystemOf(file), a);
}
const allChars = [...bySub.values()].reduce((s, a) => s + a.chars, 0);

console.log("subsystem".padEnd(26), "comments  hazards  per 1k lines  tickets");
for (const [k, a] of [...bySub].sort(
  (x, y) => y[1].hazards / y[1].code - x[1].hazards / x[1].code,
)) {
  console.log(
    k.padEnd(26),
    pct(a.chars, allChars).padStart(8),
    String(a.hazards).padStart(8),
    ((1000 * a.hazards) / Math.max(1, a.code)).toFixed(1).padStart(13),
    String(a.tickets).padStart(8),
  );
}
