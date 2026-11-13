import { readFileSync } from "node:fs";

const cli = readFileSync(process.env["CENSUS_SOURCE"] ?? "src/cli/cli.ts", "utf8");
const rail = readFileSync(process.env["CENSUS_RAIL"] ?? "test/cli/erasure-verbs.test.ts", "utf8");

const from = cli.indexOf("function operatorSeed(");
const to = cli.indexOf("function defaultHome()");
if (from < 0 || to < 0 || to <= from) {
  throw new Error(`could not bound the erasure surface in cli.ts (from=${from}, to=${to})`);
}
const region = cli.slice(from, to);

const code = region
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .map((line) => {
    const at = line.search(/(?<![:"`])\/\//);
    return at < 0 ? line : line.slice(0, at);
  })
  .join("\n");

const groups = [];
let end = 0;
for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"/g)) {
  const text = (m[1] ?? m[2] ?? "")
    .split(/\$\{[^}]*\}/)
    .join(" ")
    .replace(/\\n/g, " ")
    .replace(/\\([`"])/g, "$1");
  if (groups.length > 0 && /^[\s+]*$/.test(code.slice(end, m.index))) {
    groups[groups.length - 1] += text;
  } else {
    groups.push(text);
  }
  end = m.index + m[0].length;
}

const statements = [];
const seen = new Set();
for (const group of groups) {
  for (const piece of group.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    const sentence = piece.trim();
    if (sentence.split(" ").filter((w) => /[A-Za-z]/.test(w)).length < 6) continue;
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    statements.push(sentence);
  }
}

const railCode = rail
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .map((line) => {
    const at = line.search(/(?<![:"`])\/\//);
    return at < 0 ? line : line.slice(0, at);
  })
  .join("\n");

const needles = [...railCode.matchAll(/(\.not)?\.(?:toMatch|toContain)\(\s*([\s\S]*?)\)/g)]
  .filter((m) => m[1] === undefined)
  .map((m) => m[2])
  .join("   ")
  .replace(/[\\^$.*+?()[\]{}|/]/g, " ")
  .replace(/\s+/g, " ");

const railed = (text) => {
  const words = text.split(" ").filter((w) => /[A-Za-z]/.test(w));
  for (let i = 0; i + 3 <= words.length; i += 1) {
    if (needles.includes(words.slice(i, i + 3).join(" "))) return true;
  }
  return false;
};

const unrailed = statements.filter((s) => !railed(s));
console.log(`${statements.length} distinct prose sentences in the erasure surface`);
console.log(`${unrailed.length} whose words no positive assertion appears to name:\n`);
for (const s of unrailed) console.log(`  - ${s.slice(0, 150)}\n`);
