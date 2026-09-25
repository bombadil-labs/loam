// The import graph of a source tree: dependency cycles, directory-level edges, fan-in and fan-out,
// external modules, and which rhizomatic names are used.
// Usage: node refactor/tools/imports.mjs [dir=src] [--json out.json]

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { option, parse, sourceFiles } from "./lib.mjs";

const args = process.argv.slice(2);
const jsonOut = option(args, "--json");
const dir = args.find((a) => !a.startsWith("--") && a !== jsonOut) ?? "src";
const files = sourceFiles(dir);
const known = new Set(files);

// file -> Map(target -> { value: boolean, names: Set<string> })
const edges = new Map();
const external = new Map();
const rhizomatic = new Map();

const resolve = (from, spec) => {
  if (!spec.startsWith(".")) return null;
  const base = path.join(path.dirname(from), spec);
  for (const c of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts")]) {
    if (known.has(c)) return c;
  }
  return `unresolved:${base}`;
};

for (const file of files) {
  const { sf } = parse(file);
  const out = new Map();
  edges.set(file, out);
  const add = (spec, typeOnly, names) => {
    const target = resolve(file, spec);
    if (target === null) {
      external.set(spec, (external.get(spec) ?? 0) + 1);
      if (spec === "@bombadil/rhizomatic") {
        for (const n of names) rhizomatic.set(n, (rhizomatic.get(n) ?? 0) + 1);
      }
      return;
    }
    const e = out.get(target) ?? { value: false, names: new Set() };
    if (!typeOnly) e.value = true;
    names.forEach((n) => e.names.add(n));
    out.set(target, e);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      const names = [];
      let value = !c; // a bare `import "x"` runs the module
      if (c?.name) {
        names.push(c.name.text);
        value = true;
      }
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) {
        names.push(`* as ${c.namedBindings.name.text}`);
        value = true;
      } else if (c?.namedBindings) {
        for (const el of c.namedBindings.elements) {
          names.push((el.propertyName ?? el.name).text);
          if (!el.isTypeOnly) value = true;
        }
      }
      add(st.moduleSpecifier.text, Boolean(c?.isTypeOnly) || !value, names);
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      const names =
        st.exportClause && ts.isNamedExports(st.exportClause)
          ? st.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
          : ["*"];
      add(st.moduleSpecifier.text, st.isTypeOnly, names);
    }
  }
  const dynamic = (n) => {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      add(n.arguments[0].text, false, ["(dynamic)"]);
    }
    ts.forEachChild(n, dynamic);
  };
  dynamic(sf);
}

// Strongly connected components (Tarjan). With `withTypes` false, type-only imports are ignored.
function cycles(withTypes) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const idx = new Map();
  const low = new Map();
  const found = [];
  const visit = (v) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const [w, e] of edges.get(v) ?? []) {
      if ((!withTypes && !e.value) || !edges.has(w)) continue;
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) found.push(comp.sort());
    }
  };
  for (const v of edges.keys()) if (!idx.has(v)) visit(v);
  return found.sort((a, b) => b.length - a.length);
}

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
