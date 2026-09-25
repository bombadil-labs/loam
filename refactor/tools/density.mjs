// Code, string literals and comments: bytes and lines, per file and in total.
// Usage: node refactor/tools/density.mjs [dir=src] [--top 25]

import { classify, option, parse, pct, sourceFiles } from "./lib.mjs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && a !== option(args, "--top")) ?? "src";
const top = Number(option(args, "--top", 25));

const rows = [];
for (const file of sourceFiles(dir)) {
  const parsed = parse(file);
  const cls = classify(parsed);
  const bytes = [0, 0, 0, 0];
  for (const c of cls) bytes[c]++;
  // A line counts as code if it holds any code, else as string, else as comment.
  const lines = { code: 0, string: 0, comment: 0 };
  let start = 0;
  const { text } = parsed;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== "\n") continue;
    const seen = [0, 0, 0, 0];
    for (let j = start; j < i; j++) seen[cls[j]]++;
    if (seen[1]) lines.code++;
    else if (seen[3]) lines.string++;
    else if (seen[2]) lines.comment++;
    start = i + 1;
  }
  rows.push({ file, code: bytes[1], comment: bytes[2], string: bytes[3], lines });
}

rows.sort((a, b) => b.comment - a.comment);
console.log("file".padEnd(46), "codeLn  strLn  cmtLn    code  string  comment");
for (const r of rows.slice(0, top)) {
  const all = r.code + r.string + r.comment;
  console.log(
    r.file.padEnd(46),
    String(r.lines.code).padStart(6),
    String(r.lines.string).padStart(6),
    String(r.lines.comment).padStart(6),
    pct(r.code, all).padStart(7),
    pct(r.string, all).padStart(7),
    pct(r.comment, all).padStart(8),
  );
}
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const sumLines = (k) => rows.reduce((s, r) => s + r.lines[k], 0);
const all = sum("code") + sum("string") + sum("comment");
console.log(
  `\n${rows.length} files. Lines: code ${sumLines("code")}, string-only ${sumLines("string")}, comment-only ${sumLines("comment")}.`,
);
console.log(
  `Non-whitespace bytes: code ${pct(sum("code"), all)}, strings ${pct(sum("string"), all)}, comments ${pct(sum("comment"), all)}.`,
);
