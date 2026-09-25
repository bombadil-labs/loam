// Code lines by subsystem, split into host-bound and host-free function code (see HOST_TYPE in
// lib.mjs). With --files, one row per file instead. Comments and blank lines are not counted.
// Usage: node refactor/tools/split.mjs [dir=src] [--files]

import { classify, hostSplit, parse, pct, sourceFiles, subsystemOf } from "./lib.mjs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "src";
const rows = sourceFiles(dir).map((file) => {
  const parsed = parse(file);
  return { file, sub: subsystemOf(file), ...hostSplit(parsed, classify(parsed)) };
});
const total = rows.reduce((s, r) => s + r.total, 0);

if (args.includes("--files")) {
  console.log("file".padEnd(44), " code  host-bound  host-free  free%");
  for (const r of rows.sort((a, b) => b.total - a.total)) {
    console.log(
      r.file.padEnd(44),
      String(r.total).padStart(5),
      String(r.host).padStart(11),
      String(r.total - r.host).padStart(10),
      pct(r.total - r.host, r.total).padStart(6),
    );
  }
} else {
  const bySub = new Map();
  for (const r of rows) {
    const a = bySub.get(r.sub) ?? { files: 0, total: 0, host: 0 };
    a.files++;
    a.total += r.total;
    a.host += r.host;
    bySub.set(r.sub, a);
  }
  console.log("subsystem".padEnd(26), "files   code   share  host-bound  host-free");
  for (const [k, a] of [...bySub].sort((x, y) => y[1].total - x[1].total)) {
    console.log(
      k.padEnd(26),
      String(a.files).padStart(5),
      String(a.total).padStart(6),
      pct(a.total, total).padStart(7),
      String(a.host).padStart(11),
      String(a.total - a.host).padStart(10),
    );
  }
}
console.log(`\nTotal code lines: ${total}`);
