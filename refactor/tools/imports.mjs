// The import graph of a source tree: dependency cycles, directory-level edges, fan-in and fan-out,
// external modules, and which rhizomatic names are used.
// Usage: node refactor/tools/imports.mjs [dir=src] [--json out.json]

import fs from "node:fs";
import path from "node:path";
import { importGraph, option, sourceFiles, stronglyConnected } from "./lib.mjs";

const args = process.argv.slice(2);
const jsonOut = option(args, "--json");
const dir = args.find((a) => !a.startsWith("--") && a !== jsonOut) ?? "src";
const { edges, external, rhizomatic } = importGraph(sourceFiles(dir));
const cycles = (withTypes) => stronglyConnected(edges, withTypes);

for (const [label, withTypes] of [
  ["value imports", false],
  ["value and type imports", true],
]) {
  const sccs = cycles(withTypes);
  console.log(
    `== Cycles over ${label}: ${sccs.length} (sizes ${sccs.map((c) => c.length).join(", ") || "none"})`,
  );
  for (const c of sccs) console.log(`   ${c.join(" ")}`);
}

const area = (f) => {
  const parts = path.relative(dir, f).split(path.sep);
  return parts.length > 1 ? parts[0] : `(${parts[0].replace(/\.ts$/, "")})`;
};
const byArea = new Map();
for (const [f, out] of edges) {
  for (const [t, e] of out) {
    if (t.startsWith("unresolved:")) {
      console.log(`unresolved import in ${f}: ${t}`);
      continue;
    }
    if (area(f) === area(t)) continue;
    const key = `${area(f)} -> ${area(t)}`;
    const v = byArea.get(key) ?? { value: 0, type: 0 };
    v[e.value ? "value" : "type"]++;
    byArea.set(key, v);
  }
}
console.log("== Directory-level edges (file pairs: value / type-only)");
for (const [k, v] of [...byArea].sort()) console.log(`   ${k.padEnd(30)} ${v.value} / ${v.type}`);

const fanIn = new Map();
for (const out of edges.values()) for (const t of out.keys()) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
console.log("== Top fan-in");
for (const [f, n] of [...fanIn].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`   ${String(n).padStart(3)} ${f}`);
console.log("== Top fan-out");
for (const [f, out] of [...edges].sort((a, b) => b[1].size - a[1].size).slice(0, 12)) {
  console.log(`   ${String(out.size).padStart(3)} ${f}`);
}
console.log("== External modules (importing files)");
for (const [k, n] of [...external].sort((a, b) => b[1] - a[1]))
  console.log(`   ${String(n).padStart(3)} ${k}`);
console.log("== rhizomatic names (importing files)");
console.log(
  `   ${[...rhizomatic]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
    .join("  ")}`,
);

if (jsonOut) {
  const graph = [...edges].map(([f, out]) => [
    f,
    [...out].map(([t, e]) => [t, e.value, [...e.names]]),
  ]);
  fs.writeFileSync(jsonOut, JSON.stringify(graph));
}
