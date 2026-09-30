// The peer probe: container code uses a child only through `Peer` (ruling 13). The census counts the
// tree's gateway-typed members; this closes what it cannot see, a child reached through an opener's
// handle. It type-checks src/ with one change made in memory: a Container's `gateway` is a `Peer`.
// Any error that change causes in container code (src/gateway, src/federation) outside the opener
// is a use of a child beyond its peer interface, and fails the check.
// Usage: node refactor/tools/peer-probe.mjs

import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HANDLE = "src/gateway/container.ts";
const DECLARED = "  readonly gateway?: Gateway;\n";
const AS_PEER = '  readonly gateway?: import("./peer.js").Peer;\n';
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
let patched = 0;
host.readFile = (file) => {
  const text = read(file);
  if (text === undefined || rel(file) !== HANDLE) return text;
  patched = text.split(DECLARED).length - 1;
  return text.replace(DECLARED, AS_PEER);
};
const roots = config.fileNames.filter((f) => rel(f).startsWith("src/"));
const program = ts.createProgram(roots, config.options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (patched !== 1) {
  fail([`${HANDLE} must declare the handle as \`${DECLARED.trim()}\` exactly once`]);
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
