// Shared helpers for the census scripts. Every script parses with the TypeScript compiler, so a
// comment, a string and code are told apart by the syntax tree, never by a regex.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Where each source file belongs. The first matching pattern wins.
export const SUBSYSTEMS = [
  [
    /gateway\/(registration|binding-policy|trust|public|budget|genesis|leeway|container-identity|gather|asof|receive-policy|receive-snapshot|bytes|repair)\.ts$/,
    "law & vocabulary",
  ],
  [/gateway\/accounts\.ts$/, "grants & authorization"],
  [/gateway\/(adopt|adopt-law)\.ts$/, "adoption & manifests"],
  [
    /gateway\/(container|container-census|quarantine-pool|connection-authority|envelope|probation|soup-meter|attention)\.ts$/,
    "containers & pools",
  ],
  [/gateway\/(erase|slate|custody)\.ts$/, "erasure"],
  [/(federation\/.*|gateway\/(ingest|channel))\.ts$/, "federation & ingest"],
  [
    /(gateway\/(resolvers|esm|renderers|render-worker|renderer-context|artifact|artifact-page|artifact-scan|artifact-realm|plain-text|leeway-copy)|runner\/runner)\.ts$/,
    "code in deltas",
  ],
  [
    /(gateway\/(gql|reads|mutate|listing|gateway|lifecycle)|surface\/.*)\.ts$/,
    "query surface & runtime",
  ],
  [/store\/.*\.ts$/, "storage"],
  [/migrate\/.*\.ts$/, "migration"],
  [/server\/.*\.ts$/, "HTTP, auth, admin"],
  [/(cli|client|browser|stock)\/.*\.ts$|src\/index\.ts$/, "CLI, clients, packaging"],
];

export const subsystemOf = (rel) =>
  (SUBSYSTEMS.find(([re]) => re.test(rel)) ?? [null, "unassigned"])[1];

// Every .ts file under `dir`, declarations excluded, as repo-relative paths.
export function sourceFiles(dir = "src") {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((f) => path.join(dir, String(f)))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
}

export function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
}

const STRINGY = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

// One byte class per character: 0 whitespace, 1 code, 2 comment, 3 string literal.
export function classify({ text, sf }) {
  const cls = new Uint8Array(text.length);
  const mark = (s, e, c) => {
    for (let i = s; i < e; i++) if (text.charCodeAt(i) > 32) cls[i] = c;
  };
  const walk = (n) => {
    const kids = n.getChildren(sf);
    if (kids.length > 0) return kids.forEach(walk);
    const start = n.getStart(sf);
    for (const r of ts.getLeadingCommentRanges(text, n.pos) ?? []) {
      if (r.end <= start) mark(r.pos, r.end, 2);
    }
    mark(start, n.end, STRINGY.has(n.kind) ? 3 : 1);
  };
  walk(sf);
  return cls;
}

// Lines in [s, e) that hold at least one code or string character.
export function codeLines(text, cls, s = 0, e = text.length) {
  let n = 0;
  let lineStart = s;
  for (let i = s; i <= e; i++) {
    if (i === e || text[i] === "\n") {
      for (let j = lineStart; j < i; j++) {
        if (cls[j] === 1 || cls[j] === 3) {
          n++;
          break;
        }
      }
      lineStart = i + 1;
    }
  }
  return n;
}

// Every comment block, with consecutive `//` lines merged into one block.
export function commentBlocks({ text, sf }) {
  const seen = new Set();
  const raw = [];
  const walk = (n) => {
    const kids = n.getChildren(sf);
    if (kids.length > 0) return kids.forEach(walk);
    for (const r of ts.getLeadingCommentRanges(text, n.pos) ?? []) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      raw.push({
        line: sf.getLineAndCharacterOfPosition(r.pos).line + 1,
        text: text.slice(r.pos, r.end),
      });
    }
  };
  walk(sf);
  const blocks = [];
  for (const c of raw) {
    const last = blocks.at(-1);
    if (last && c.text.startsWith("//") && last.text.startsWith("//") && c.line === last.end + 1) {
      last.text += "\n" + c.text;
      last.end = c.line;
    } else {
      blocks.push({ line: c.line, end: c.line + (c.text.match(/\n/g) ?? []).length, text: c.text });
    }
  }
  return blocks;
}

// A function is host-bound when a parameter's type names the host: the Gateway, a container, a
// backend, or an HTTP request or response. Everything else counts as host-free.
export const HOST_TYPE =
  /\b(Gateway|Container|QuarantinePool|Bound|StoreBackend|Server|IncomingMessage|ServerResponse)\b/;

// Code lines in one file, and how many of them sit in host-bound top-level functions. A class body
// counts as host-bound, because its methods reach the instance through `this`.
export function hostSplit(parsed, cls) {
  const { text, sf } = parsed;
  const total = codeLines(text, cls);
  const hosted = (fn) => fn.parameters.some((p) => p.type && HOST_TYPE.test(p.type.getText(sf)));
  const isFn = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  let host = 0;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body && hosted(st)) {
      host += codeLines(text, cls, st.getStart(sf), st.end);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (isFn(d.initializer) && hosted(d.initializer)) {
          host += codeLines(text, cls, d.getStart(sf), d.end);
        }
      }
    } else if (ts.isClassDeclaration(st)) {
      host += codeLines(text, cls, st.getStart(sf), st.end);
    }
  }
  return { total, host: Math.min(host, total) };
}

// The functions hermetic's prefer-hermetic rule considers: outermost functions bound to a name.
// That is function declarations, variable initializers, and members of top-level objects and
// classes. Callbacks and nested functions are not candidates.
export function candidates({ sf }) {
  const out = [];
  const isFn = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  const members = (list, kind) => {
    for (const m of list) {
      if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) && m.body) {
        out.push({ node: m, kind });
      } else if (
        (ts.isPropertyDeclaration(m) || ts.isPropertyAssignment(m)) &&
        isFn(m.initializer)
      ) {
        out.push({ node: m.initializer, kind });
      }
    }
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) out.push({ node: st, kind: "declaration" });
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (isFn(d.initializer)) out.push({ node: d.initializer, kind: "variable" });
        else if (d.initializer && ts.isObjectLiteralExpression(d.initializer)) {
          members(d.initializer.properties, "object member");
        }
      }
    } else if (ts.isClassDeclaration(st)) members(st.members, "class member");
  }
  return out.map(({ node, kind }) => ({
    node,
    kind,
    startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    endLine: sf.getLineAndCharacterOfPosition(node.end).line + 1,
  }));
}

// Lint files with hermetic's rules and nothing else. Inline eslint comments are ignored, so the
// repo's own disable directives cannot hide or add findings.
export async function lintHermetic(cwd, patterns, rules) {
  const [{ ESLint }, tseslint, { default: hermetic }] = await Promise.all([
    import("eslint"),
    import("typescript-eslint"),
    import("@bombadil/hermetic"),
  ]);
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tseslint.default.parser,
          parserOptions: { ecmaVersion: "latest", sourceType: "module" },
        },
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
        plugins: { hermetic },
        rules,
      },
    ],
  });
  return eslint.lintFiles(patterns);
}

export const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;

export function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

// The import graph over `files`: file -> Map(target -> { value, names }), plus external modules
// and the rhizomatic names each file imports. A type-only import has `value: false`.
export function importGraph(files) {
  const known = new Set(files);

  // file -> Map(target -> { value: boolean, names: Set<string> })
  const edges = new Map();
  const external = new Map();
  const rhizomatic = new Map();

  const resolve = (from, spec) => {
    if (!spec.startsWith(".")) return null;
    const base = path.join(path.dirname(from), spec);
    for (const c of [
      base,
      base.replace(/\.js$/, ".ts"),
      `${base}.ts`,
      path.join(base, "index.ts"),
    ]) {
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
  return { edges, external, rhizomatic };
}

// Strongly connected components (Tarjan). With `withTypes` false, type-only imports are ignored.
export function stronglyConnected(edges, withTypes) {
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

// Code that decides; the doors, the CLI and the clients may read the clock.
const CORE = /^src\/(gateway|federation|store|runner|surface|migrate|stock)\//;

// The last name in a receiver chain: `gw.options` → "options", `x["reactor"]` → "reactor",
// `globalThis.Date` → "Date". Anything else has no name.
function lastName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  if (ts.isParenthesizedExpression(node)) return lastName(node.expression);
  return undefined;
}

// A member reference `recv.name` or `recv["name"]`: [receiver, name], or undefined.
function member(node) {
  if (ts.isPropertyAccessExpression(node)) return [node.expression, node.name.text];
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return [node.expression, node.argumentExpression.text];
  }
  return undefined;
}

// The members that hold the container tree, the container code that may not touch them, and the
// files allowed to. Container code reads a child only as a Peer, through the Store. The doors and
// commands (src/server, src/cli) are facades over one container of the store, not containers, so
// they may look a container up in the table (step6-container-split.md).
const TREE_MEMBERS = new Set([
  "attachedTo",
  "parentOf",
  "quarantinePools",
  "attachedContainers",
  "channelPools",
  "connectionInboxes",
  "tableOf",
  "rootOf",
  "verifiedRootOf",
  "poolForBinding",
  "poolForBindingImpl",
  "openChild",
]);
const CONTAINER_CODE = /src\/(gateway|federation)\//;
const TREE_OWNERS = /src\/gateway\/(container|store)\.ts$/;
// The facade's own definitions: these members of class Gateway, in gateway.ts, serve the doors and
// commands. A member is exempt only while its body is exactly the one-line definition below
// (whitespace aside); any other body is counted like any other code. Nothing else is exempt.
const FACADE_FILE = /src\/gateway\/gateway\.ts$/;
const FACADE_DEFINITIONS = new Map([
  ["quarantinePools", "{return this.store.tableOf(this).pools;}"],
  ["attachedContainers", "{return this.store.tableOf(this).named;}"],
  ["connectionInboxes", "{return this.store.tableOf(this).inboxes;}"],
  ["channelPools", "{return this.store.tableOf(this).channels;}"],
  ["poolForBinding", "{return poolForBindingImpl(this, binding);}"],
]);

// The ratchet's per-file counts. They are syntactic: a read through an alias the syntax tree
// cannot see (a variable holding `options`, a computed key) is not counted.
export function couplingCountsOf(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const core = CORE.test(file.replace(/\\/g, "/"));
  const counts = { seedReads: 0, snapshotRefs: 0, coreClockReads: 0, treeReach: 0 };
  // Lines that reach across containers: a parent link or a child map, read or written anywhere but
  // the opener and the store itself (step6-container-split.md). Distinct lines, not occurrences.
  const reachLines = new Set();
  const unix = file.replace(/\\/g, "/");
  const opener = !CONTAINER_CODE.test(unix) || TREE_OWNERS.test(unix);
  const facade = FACADE_FILE.test(unix);
  const isClock = (recv) => ["Date", "performance"].includes(lastName(recv));
  const visit = (n) => {
    if (facade && definesFacadeMember(n, sf)) return;
    // A bare call counts too: an opener's function that hands a child out as a Gateway.
    if (!opener && ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (TREE_MEMBERS.has(n.expression.text)) {
        reachLines.add(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line);
      }
    }
    const m = member(n);
    if (m !== undefined) {
      const [recv, name] = m;
      if (name === "seed" && lastName(recv) === "options") counts.seedReads++;
      if (name === "snapshot" && /reactor$/i.test(lastName(recv) ?? "")) counts.snapshotRefs++;
      if (core && name === "now" && isClock(recv)) counts.coreClockReads++;
      if (!opener && TREE_MEMBERS.has(name)) {
        reachLines.add(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line);
      }
    }
    // `const { seed } = options`, `const { now } = Date`
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const from = lastName(n.initializer);
      for (const el of n.name.elements) {
        const key = (el.propertyName ?? el.name).getText(sf).replace(/^["']|["']$/g, "");
        if (key === "seed" && from === "options") counts.seedReads++;
        if (core && key === "now" && ["Date", "performance"].includes(from)) {
          counts.coreClockReads++;
        }
      }
    }
    if (core && ts.isNewExpression(n) && lastName(n.expression) === "Date") {
      if ((n.arguments?.length ?? 0) === 0) counts.coreClockReads++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  counts.treeReach = reachLines.size;
  return counts;
}

// Is `n` a getter or method of class Gateway whose body is exactly its facade definition?
function definesFacadeMember(n, sf) {
  if (!ts.isGetAccessorDeclaration(n) && !ts.isMethodDeclaration(n)) return false;
  const owner = n.parent;
  if (!ts.isClassDeclaration(owner) || owner.name?.text !== "Gateway") return false;
  if (!ts.isIdentifier(n.name) || n.body === undefined) return false;
  const squash = (text) => text.replace(/\s+/g, "");
  const expected = FACADE_DEFINITIONS.get(n.name.text);
  return expected !== undefined && squash(n.body.getText(sf)) === squash(expected);
}

// How many Gateway members one container may use of another: the members the `Peer` type in
// src/gateway/peer.ts picks. 0 when the file is absent. Any other shape of `Peer` (an intersection,
// an interface, a Pick of anything but string literals) fails the census rather than be miscounted.
export function peerSurfaceOf(files) {
  const file = files.find((f) => f.replace(/\\/g, "/").endsWith("src/gateway/peer.ts"));
  if (file === undefined) return 0;
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const refuse = (why) => {
    throw new Error(
      `census: ${file} must declare \`type Peer = Pick<Gateway, "a" | ...>\`; ${why}`,
    );
  };
  const decls = sf.statements.filter(
    (n) => (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) && n.name.text === "Peer",
  );
  if (decls.length !== 1 || !ts.isTypeAliasDeclaration(decls[0]))
    refuse("found none, or another kind");
  const type = decls[0].type;
  const isPick =
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "Pick" &&
    type.typeArguments?.length === 2 &&
    ts.isTypeReferenceNode(type.typeArguments[0]) &&
    type.typeArguments[0].typeName.getText(sf) === "Gateway";
  if (!isPick) refuse("found another shape");
  const picked = type.typeArguments[1];
  const parts = ts.isUnionTypeNode(picked) ? picked.types : [picked];
  if (!parts.every((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))) {
    refuse("every picked member must be a string literal");
  }
  return parts.length;
}

// Every ratchet count over `files`.
export function couplingCounts(files) {
  const cycles = stronglyConnected(importGraph(files).edges, false);
  const totals = {
    largestImportCycle: Math.max(0, ...cycles.map((c) => c.length)),
    importCycles: cycles.length,
    cyclicFiles: cycles.reduce((n, c) => n + c.length, 0),
    seedReads: 0,
    snapshotRefs: 0,
    coreClockReads: 0,
    treeReach: 0,
    peerSurface: peerSurfaceOf(files),
  };
  for (const file of files) {
    const per = couplingCountsOf(file, fs.readFileSync(file, "utf8"));
    for (const [k, v] of Object.entries(per)) totals[k] += v;
  }
  return totals;
}
