// The peer probe: container code uses a child only through `Peer` (ruling 13). The census counts the
// tree's gateway-typed members; this closes what it cannot see, a child reached through a handle an
// opener returns. It type-checks src/ with every such handle's `gateway` typed as a `Peer`, in memory.
// Any error that causes in container code (src/gateway, src/federation) outside the openers is a use
// of a child beyond its peer interface, and fails the check.
// Usage: node refactor/tools/peer-probe.mjs

import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "../..");
// Every handle an opener returns with a child in it. A declaration that moves fails the probe.
const HANDLES = [
  {
    file: "src/gateway/container.ts",
    declared: "  readonly gateway?: Gateway;\n",
    asPeer: '  readonly gateway?: import("./peer.js").Peer;\n',
  },
  {
    file: "src/gateway/quarantine-pool.ts",
    declared: "  readonly gateway: Gateway;\n",
    asPeer: '  readonly gateway: import("./peer.js").Peer;\n',
  },
];
// The opener attaches, discards and closes children, so it holds each as its gateway.
const OPENERS = new Set(["src/gateway/container.ts", "src/gateway/quarantine-pool.ts"]);
const CONTAINER_CODE = /^src\/(gateway|federation)\//;

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, "/");
const config = ts.getParsedCommandLineOfConfigFile(
  path.join(ROOT, "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => fail([flatten(d)]) },
);
const host = ts.createCompilerHost(config.options);
const read = host.readFile.bind(host);
const patched = new Map();
host.readFile = (file) => {
  const text = read(file);
  const handle = HANDLES.find((h) => h.file === rel(file));
  if (text === undefined || handle === undefined) return text;
  patched.set(handle.file, text.split(handle.declared).length - 1);
  return text.replace(handle.declared, handle.asPeer);
};
const roots = config.fileNames.filter((f) => rel(f).startsWith("src/"));
const program = ts.createProgram(roots, config.options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
const unpatched = HANDLES.filter((h) => patched.get(h.file) !== 1);
if (unpatched.length > 0) {
  fail(unpatched.map((h) => `${h.file} must declare \`${h.declared.trim()}\` exactly once`));
}
const leaks = diagnostics
  .filter((d) => d.file !== undefined)
  .filter((d) => CONTAINER_CODE.test(rel(d.file.fileName)) && !OPENERS.has(rel(d.file.fileName)))
  .map((d) => {
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    return `${rel(d.file.fileName)}:${line + 1}: ${flatten(d.messageText)}`;
  });
if (leaks.length > 0) fail(leaks);
console.log(`peer-probe: container code uses children only as peers (${roots.length} files)`);

function flatten(message) {
  return typeof message === "string" ? message : ts.flattenDiagnosticMessageText(message, " ");
}

function fail(lines) {
  for (const l of lines) console.log(`peer-probe: ${l}`);
  console.log("peer-probe: a child is used beyond its Peer interface; see src/gateway/peer.ts");
  process.exit(2);
}
