#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const SCOPE = [
  "src",
  "test",
  "scripts",
  "demos",
  "refactor",
  "eslint.config.js",
  "vitest.config.mjs",
];

const EXTENSIONS = /\.(ts|mts|cts|tsx|mjs|cjs|js|jsx)$/;
const EXCLUDED = [
  /(^|\/)node_modules\//,
  /^demos\/village\/homes\//,
  /^test\/gateway\/fixtures\/.*\.bundle\.mjs$/,
];

const DIRECTIVES = [
  /^eslint-disable(-next-line|-line)?(\s|$)/,
  /^eslint-enable(\s|$)/,
  /^@ts-(expect-error|ignore|nocheck|check)(\s|$)/,
  /^prettier-ignore(\s|$)/,
  /^(c8|v8|istanbul) ignore(\s|$)/,
  /^@vitest-environment\s/,
  /^[#@]__(PURE|NO_SIDE_EFFECTS)__$/,
];

const MARK = "\uE000";

function scriptKind(file) {
  if (/\.(tsx|jsx)$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.(ts|mts|cts)$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function isJsDocNode(n) {
  return n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode;
}

export function codeSpans(text, file = "x.ts") {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const spans = [];
  const walk = (n) => {
    if (isJsDocNode(n)) return;
    const kids = n.getChildren(sf);
    if (kids.length > 0) return kids.forEach(walk);
    if (n.kind === ts.SyntaxKind.JsxText) throw new Error(`${file}: JSX text is not supported`);
    const start = n.getStart(sf);
    if (n.end > start) spans.push({ start, end: n.end, kind: n.kind });
  };
  walk(sf);
  return { sf, spans };
}

function triviaComments(text, from, to, file) {
  const out = [];
  let i = from;
  if (i === 0 && text.startsWith("#!")) {
    while (i < to && text[i] !== "\n") i++;
  }
  while (i < to) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") {
      i++;
    } else if (text.startsWith("//", i)) {
      let e = i;
      while (e < to && text[e] !== "\n" && text[e] !== "\r") e++;
      out.push({ pos: i, end: e, block: false });
      i = e;
    } else if (text.startsWith("/*", i)) {
      const e = text.indexOf("*/", i + 2);
      if (e < 0 || e + 2 > to) throw new Error(`${file}: unterminated comment at ${i}`);
      out.push({ pos: i, end: e + 2, block: true });
      i = e + 2;
    } else {
      throw new Error(`${file}: unexpected trivia ${JSON.stringify(c)} at offset ${i}`);
    }
  }
  return out;
}

export function findComments(text, file = "x.ts") {
  const { spans } = codeSpans(text, file);
  const comments = [];
  let prev = 0;
  for (const s of spans) {
    if (s.start < prev) throw new Error(`${file}: overlapping tokens at ${s.start}`);
    comments.push(...triviaComments(text, prev, s.start, file));
    prev = s.end;
  }
  comments.push(...triviaComments(text, prev, text.length, file));
  return comments;
}

function bodyOf(text, c) {
  const raw = text.slice(c.pos, c.end);
  if (!c.block) return raw.replace(/^\/\/\/?/, "").trim();
  return raw
    .slice(2, -2)
    .replace(/^\*+/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, ""))
    .join("\n")
    .trim();
}

export function directiveOf(text, c) {
  const raw = text.slice(c.pos, c.end);
  if (!c.block && /^\/\/\/\s*<(reference|amd-module|amd-dependency)\b/.test(raw)) return raw.trim();
  const body = bodyOf(text, c);
  const first = body.split("\n")[0].trim();
  if (!DIRECTIVES.some((re) => re.test(first))) return null;
  let kept = first;
  if (/^eslint-(disable|enable)/.test(first)) {
    const full = body.replace(/\s+/g, " ");
    kept = full.split(" -- ")[0].replace(/\s--$/, "").trim();
  } else if (/^@ts-/.test(first)) {
    kept = first.split(/\s/)[0];
  } else if (/^@vitest-environment/.test(first)) {
    kept = first.split(/\s+/).slice(0, 2).join(" ");
  }
  const rewritten = c.block ? `/* ${kept} */` : `// ${kept}`;
  if (/^[#@]__/.test(first)) return raw;
  return rewritten;
}

const WORD = /[A-Za-z0-9_$\u0080-￿]/;
const OP = /[+\-*/&|<>=!?.:%^~]/;

function joiner(before, after, comment) {
  if (comment.includes("\n")) return "\n";
  if (before === undefined || after === undefined) return "";
  if (/\s/.test(before) || /\s/.test(after)) return "";
  if (WORD.test(before) && WORD.test(after)) return " ";
  if (OP.test(before) && OP.test(after)) return " ";
  return "";
}

function tidy(text) {
  const out = [];
  const isBlank = (l) => l.trim() === "";
  let dropped = false;
  for (const line of text.split("\n")) {
    if (line.includes(MARK)) {
      const cleaned = line
        .replace(new RegExp(`[ \\t]*${MARK}[ \\t]*$`), "")
        .replace(new RegExp(`^([ \\t]*)${MARK}[ \\t]*`), "$1")
        .replaceAll(MARK, "");
      if (isBlank(cleaned)) {
        dropped = true;
        continue;
      }
      out.push(cleaned);
      dropped = false;
      continue;
    }
    if (dropped) {
      const last = out.at(-1);
      if (isBlank(line)) {
        if (last === undefined || isBlank(last) || /[{[(]$/.test(last)) continue;
        out.push(line);
        continue;
      }
      if (last !== undefined && isBlank(last)) {
        const before = out.at(-2);
        if (/^\s*[}\])]/.test(line) || (before !== undefined && /[{[(]$/.test(before))) out.pop();
      }
      dropped = false;
    }
    out.push(line);
  }
  while (out.length > 1 && out.at(-1) === "" && out.at(-2) === "") out.pop();
  return out.join("\n");
}

export function strip(text, file = "x.ts") {
  if (text.includes(MARK)) throw new Error(`${file}: holds the private-use marker U+E000`);
  const comments = findComments(text, file);
  const removed = [];
  let kept = 0;
  let result = "";
  let at = 0;
  for (const c of comments) {
    const raw = text.slice(c.pos, c.end);
    const directive = directiveOf(text, c);
    const from = at;
    result += text.slice(at, c.pos);
    at = c.end;
    if (directive !== null) {
      kept++;
      result += directive;
      if (directive !== raw) removed.push(c);
      continue;
    }
    removed.push(c);
    let back = c.pos;
    while (back > from && (text[back - 1] === " " || text[back - 1] === "\t")) back--;
    let ahead = c.end;
    while (ahead < text.length && (text[ahead] === " " || text[ahead] === "\t")) ahead++;
    const codeBefore = back > 0 && text[back - 1] !== "\n";
    const codeAfter = ahead < text.length && text[ahead] !== "\n" && text[ahead] !== "\r";
    if (codeBefore && codeAfter && !raw.includes("\n")) {
      result = result.slice(0, result.length - (c.pos - back));
      at = ahead;
      const spaced = back < c.pos && ahead > c.end;
      result += MARK + (spaced ? " " : joiner(text[back - 1], text[ahead], raw));
      continue;
    }
    result += MARK + joiner(text[c.pos - 1], text[c.end], raw);
  }
  result += text.slice(at);
  const out = removed.length === 0 ? text : tidy(result);
  return { text: out, removed, kept, comments };
}

export function tokenStream(text, file = "x.ts") {
  const { spans } = codeSpans(text, file);
  return spans.map((s) => `${s.kind}:${text.slice(s.start, s.end)}`);
}

export function listFiles(root, args) {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...args],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
  return [...new Set(listed)]
    .filter((f) => EXTENSIONS.test(f) && !EXCLUDED.some((re) => re.test(f)))
    .filter((f) => existsSync(resolve(root, f)))
    .sort();
}

function lineOf(text, pos) {
  let n = 1;
  for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const rel = paths.map((p) => relative(root, resolve(p)) || ".");
  const files = listFiles(root, rel.length > 0 ? rel : SCOPE);
  let dirty = 0;
  let removedTotal = 0;
  let keptTotal = 0;
  const findings = [];
  for (const f of files) {
    const abs = resolve(root, f);
    const text = readFileSync(abs, "utf8");
    const r = strip(text, f);
    keptTotal += r.kept;
    if (r.removed.length === 0) continue;
    dirty++;
    removedTotal += r.removed.length;
    if (check) {
      for (const c of r.removed) findings.push(`${f}:${lineOf(text, c.pos)}`);
      continue;
    }
    const a = tokenStream(text, f);
    const b = tokenStream(r.text, f);
    if (a.length !== b.length || a.some((t, i) => t !== b[i])) {
      throw new Error(`${f}: the token stream changed; refusing to write`);
    }
    writeFileSync(abs, r.text);
  }
  if (check) {
    if (findings.length > 0) {
      for (const line of findings) console.error(line);
      console.error(
        `comments: ${findings.length} comment(s) in ${dirty} file(s). The code carries no comments; ` +
          `run \`node scripts/strip-comments.mjs\` to remove them. Only tool directives stay.`,
      );
      process.exit(2);
    }
    console.log(`comments: ${files.length} files clean (${keptTotal} tool directives kept)`);
    return;
  }
  console.log(
    `comments: removed ${removedTotal} from ${dirty} of ${files.length} files; ${keptTotal} tool directives kept`,
  );
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
