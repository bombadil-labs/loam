// What each function reaches outside itself. Copies the tree to a temp dir, marks every candidate
// function "use hermetic" there, and runs hermetic/sealed over the copy. Each free variable is an
// import, a module-level binding, or a global. The repo itself is never modified.
// Usage: node refactor/tools/ambient-reach.mjs [dir=src]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { candidates, lintHermetic, parse, sourceFiles, subsystemOf } from "./lib.mjs";

const dir = process.argv[2] ?? "src";
const AMBIENT =
  /^(Date|crypto|console|process|setTimeout|setInterval|clearTimeout|clearInterval|setImmediate|queueMicrotask|fetch|performance|globalThis|Buffer|require|structuredClone)$/;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ambient-reach-"));
try {
  fs.cpSync(dir, tmp, { recursive: true });
  const names = new Map(); // copied file -> { imports, decls, rel }
  for (const rel of sourceFiles(dir)) {
    const copy = path.join(tmp, path.relative(dir, rel));
    const parsed = parse(copy);
    const inserts = candidates(parsed)
      .map((c) => c.node.body)
      .filter((b) => b && ts.isBlock(b))
      .map((b) => b.getStart(parsed.sf) + 1);
    let text = parsed.text;
    for (const at of inserts.sort((a, b) => b - a))
      text = `${text.slice(0, at)} "use hermetic";${text.slice(at)}`;
    fs.writeFileSync(copy, text);

    const imports = new Set();
    const decls = new Set();
    for (const st of parsed.sf.statements) {
      const c = ts.isImportDeclaration(st) ? st.importClause : undefined;
      if (c?.name) imports.add(c.name.text);
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings))
        imports.add(c.namedBindings.name.text);
      else if (c?.namedBindings) c.namedBindings.elements.forEach((e) => imports.add(e.name.text));
      if (
        (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) &&
        st.name
      ) {
        decls.add(st.name.text);
      }
      if (ts.isVariableStatement(st)) {
        const collect = (n) =>
          ts.isIdentifier(n)
            ? decls.add(n.text)
            : n.elements?.forEach((e) => e.name && collect(e.name));
        st.declarationList.declarations.forEach((d) => collect(d.name));
      }
    }
    names.set(path.resolve(copy), { imports, decls, rel });
  }

  const results = await lintHermetic(tmp, ["**/*.ts"], { "hermetic/sealed": "error" });
  const kinds = { import: 0, module: 0, global: 0 };
  const globals = new Map(); // global name -> Set of "file:function"
  const reach = new Map(); // "file:function" -> Set of kinds or "global:Name"
  for (const r of results) {
    const info = names.get(path.resolve(r.filePath));
    if (!info) continue;
    for (const m of r.messages) {
      if (m.messageId !== "freeVariable") continue;
      const hit = /^'([^']+)' is a free variable in hermetic function '([^']*)'/.exec(m.message);
      if (!hit) continue;
      const [, name, fn] = hit;
      const kind = info.imports.has(name) ? "import" : info.decls.has(name) ? "module" : "global";
      kinds[kind]++;
      const key = `${info.rel}:${fn}`;
      if (!reach.has(key)) reach.set(key, new Set());
      reach.get(key).add(kind === "global" ? `global:${name}` : kind);
      if (kind === "global") {
        if (!globals.has(name)) globals.set(name, new Set());
        globals.get(name).add(key);
      }
    }
  }

  console.log(
    `Free-variable references: ${kinds.import} imports, ${kinds.module} module bindings, ${kinds.global} globals.`,
  );
  console.log(`Functions that reach outside themselves: ${reach.size}.`);
  console.log("\nGlobals reached (number of functions):");
  console.log(
    [...globals]
      .sort((a, b) => b[1].size - a[1].size)
      .map(([n, s]) => `${n}:${s.size}`)
      .join("  "),
  );
  const ambient = [...reach].filter(([, s]) =>
    [...s].some((k) => k.startsWith("global:") && AMBIENT.test(k.slice(7))),
  );
  const bySub = new Map();
  for (const [key] of ambient) {
    const sub = subsystemOf(key.slice(0, key.lastIndexOf(":")));
    bySub.set(sub, (bySub.get(sub) ?? 0) + 1);
  }
  console.log(
    `\nFunctions reaching ambient authority (clock, crypto, console, process, timers, network): ${ambient.length}`,
  );
  for (const [k, n] of [...bySub].sort((a, b) => b[1] - a[1]))
    console.log(`   ${String(n).padStart(3)} ${k}`);
  const clock = [...(globals.get("Date") ?? [])]
    .filter((k) => /\/(gateway|federation|store)\//.test(k))
    .sort();
  console.log(`\nCore functions that read the clock (${clock.length}):`);
  for (const k of clock) console.log(`   ${k}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
