// The Gateway class: its members, which files reach into them, and how many files touch each one.
// A file "touches" a member when it reads `x.member` on a variable or parameter typed as Gateway.
// Usage: node refactor/tools/gateway-surface.mjs [dir=src]

import ts from "typescript";
import { parse, sourceFiles } from "./lib.mjs";

const dir = process.argv[2] ?? "src";
const files = sourceFiles(dir);
const gatewayFile = files.find((f) => f.endsWith("gateway/gateway.ts"));
if (!gatewayFile) throw new Error(`no gateway/gateway.ts under ${dir}`);

const members = [];
ts.forEachChild(parse(gatewayFile).sf, (n) => {
  if (!ts.isClassDeclaration(n) || n.name?.text !== "Gateway") return;
  for (const m of n.members) {
    const name =
      m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : "?";
    const isPrivate =
      (ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Private) !== 0 || name.startsWith("#");
    members.push({ name, kind: ts.SyntaxKind[m.kind], isPrivate });
  }
});
const count = (kind) => members.filter((m) => m.kind === kind).length;
console.log(
  `Gateway: ${members.length} members — ${count("MethodDeclaration")} methods, ${count("PropertyDeclaration")} properties, ` +
    `${count("GetAccessor")} getters, ${members.filter((m) => m.isPrivate).length} private.`,
);

const touches = new Map();
for (const file of files) {
  if (file === gatewayFile) continue;
  const { sf } = parse(file);
  const typed = new Set();
  const findTyped = (n) => {
    if (
      (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n)) &&
      n.type &&
      ts.isIdentifier(n.name) &&
      /\bGateway\b/.test(n.type.getText(sf)) &&
      !/GatewayOptions|GatewayLike/.test(n.type.getText(sf))
    ) {
      typed.add(n.name.text);
    }
    ts.forEachChild(n, findTyped);
  };
  findTyped(sf);
  const used = new Set();
  const findUses = (n) => {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      typed.has(n.expression.text)
    ) {
      used.add(n.name.text);
    }
    ts.forEachChild(n, findUses);
  };
  findUses(sf);
  if (used.size > 0) touches.set(file, [...used].sort());
}

console.log("\nFiles that reach into Gateway members (count: members):");
for (const [f, m] of [...touches].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(m.length).padStart(3)} ${f.padEnd(42)} ${m.join(" ").slice(0, 160)}`);
}
const perMember = new Map();
for (const m of touches.values())
  for (const name of m) perMember.set(name, (perMember.get(name) ?? 0) + 1);
console.log("\nMembers by number of files that touch them:");
console.log(
  [...perMember]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k, n]) => `${k}:${n}`)
    .join("  "),
);
