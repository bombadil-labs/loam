export const HOST_GLOBALS: Readonly<Record<string, readonly string[]>> = {
  browser: [
    "window",
    "document",
    "claude",
    "localStorage",
    "sessionStorage",
    "navigator",
    "location",
  ],
  node: ["require", "Buffer", "process", "module", "__dirname", "__filename"],
  worker: [
    "indexedDB",
    "caches",
    "BroadcastChannel",
    "importScripts",
    "self",
    "globalThis",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
  ],
  eval: ["eval", "Function"],
};

const FAMILY_OF = new Map<string, string>(
  Object.entries(HOST_GLOBALS).flatMap(([family, names]) => names.map((n) => [n, family] as const)),
);

const IMPORT_CALL = /\bimport\s*\(/;
const NODE_PREFIX = "node";
const NODE_SPECIFIER = new RegExp(`(["'])${NODE_PREFIX}:[a-z_/]+\\1`);

interface Token {
  readonly kind: "name" | "punct" | "string" | "keyword";
  readonly text: string;
  readonly index: number;
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;
const KEYWORDS = new Set([
  "var",
  "let",
  "const",
  "function",
  "class",
  "catch",
  "typeof",
  "if",
  "else",
  "return",
  "new",
  "in",
  "of",
  "instanceof",
  "delete",
  "void",
  "do",
  "while",
  "for",
  "throw",
  "case",
  "yield",
  "await",
  "import",
  "export",
  "default",
]);

const regexAllowedAfter = (prev: Token | undefined): boolean => {
  if (prev === undefined) return true;
  if (prev.kind === "string") return false;
  if (prev.kind === "keyword") return prev.text !== "this";
  if (prev.kind === "name") return false;
  return !(
    prev.text === ")" ||
    prev.text === "]" ||
    prev.text === "}" ||
    prev.text === "++" ||
    prev.text === "--"
  );
};

function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      i += 1;
      while (i < n && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i += 1;
      out.push({ kind: "string", text: src.slice(start, Math.min(i, n)), index: start });
      continue;
    }
    if (c === "`") {
      const start = i;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "`") {
          i += 1;
          break;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          out.push({ kind: "string", text: src.slice(start, i), index: start });
          out.push({ kind: "punct", text: "${", index: i });
          i += 2;
          let depth = 1;
          const inner = i;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") depth -= 1;
            if (depth > 0) i += 1;
          }
          for (const t of lex(src.slice(inner, i))) out.push({ ...t, index: inner + t.index });
          out.push({ kind: "punct", text: "}", index: i });
          i += 1;
          return [...out, ...lex(src.slice(i)).map((t) => ({ ...t, index: i + t.index }))];
        }
        i += 1;
      }
      out.push({ kind: "string", text: src.slice(start, Math.min(i, n)), index: start });
      continue;
    }
    if (c === "/" && regexAllowedAfter(out[out.length - 1])) {
      const start = i;
      i += 1;
      let inClass = false;
      while (i < n) {
        const d = src[i]!;
        if (d === "\\") {
          i += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        else if (d === "\n") break;
        i += 1;
      }
      i += 1;
      while (i < n && ID_PART.test(src[i]!)) i += 1;
      out.push({ kind: "string", text: src.slice(start, Math.min(i, n)), index: start });
      continue;
    }
    if (ID_START.test(c)) {
      const start = i;
      while (i < n && ID_PART.test(src[i]!)) i += 1;
      const text = src.slice(start, i);
      out.push({ kind: KEYWORDS.has(text) ? "keyword" : "name", text, index: start });
      continue;
    }
    if (c >= "0" && c <= "9") {
      while (i < n && /[0-9a-fA-FxXoObBeE._n]/.test(src[i]!)) i += 1;
      out.push({ kind: "string", text: "0", index: i });
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    const text =
      three === "===" || three === "!=="
        ? three
        : ["?.", "=>", "++", "--", "==", "!="].includes(two)
          ? two
          : c;
    out.push({ kind: "punct", text, index: i });
    i += text.length;
  }
  return out;
}

function boundNames(tokens: readonly Token[]): ReadonlySet<string> {
  const bound = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.kind === "keyword" && (t.text === "var" || t.text === "let" || t.text === "const")) {
      let j = i + 1;
      let depth = 0;
      while (j < tokens.length) {
        const u = tokens[j]!;
        if (u.kind === "punct" && (u.text === "{" || u.text === "[")) depth += 1;
        else if (u.kind === "punct" && (u.text === "}" || u.text === "]")) depth -= 1;
        else if (u.kind === "punct" && (u.text === ";" || (u.text === "=" && depth === 0))) break;
        else if (u.kind === "name" && tokens[j - 1]?.text !== ".") bound.add(u.text);
        else if (u.kind === "keyword") break;
        j += 1;
      }
      continue;
    }
    if (
      t.kind === "keyword" &&
      (t.text === "function" || t.text === "class" || t.text === "catch")
    ) {
      const next = tokens[i + 1];
      if (next?.kind === "name") bound.add(next.text);
    }
    if (t.kind === "punct" && t.text === "(") {
      const opener = tokens[i - 1];
      const isParams =
        opener?.kind === "keyword" &&
        (opener.text === "function" || opener.text === "catch" || opener.text === "class");
      const afterName = opener?.kind === "name" && tokens[i - 2]?.kind === "keyword";
      if (isParams || afterName) {
        let j = i + 1;
        let depth = 1;
        while (j < tokens.length && depth > 0) {
          const u = tokens[j]!;
          if (u.kind === "punct" && (u.text === "(" || u.text === "{" || u.text === "["))
            depth += 1;
          else if (u.kind === "punct" && (u.text === ")" || u.text === "}" || u.text === "]"))
            depth -= 1;
          else if (u.kind === "name" && tokens[j - 1]?.text !== ".") bound.add(u.text);
          j += 1;
        }
      }
    }
    if (t.kind === "punct" && t.text === "=>") {
      const prev = tokens[i - 1];
      if (prev?.kind === "name" && tokens[i - 2]?.text !== ")") bound.add(prev.text);
    }
  }
  return bound;
}

const TYPEOF_LITERAL = /^["'](undefined|object|function|string|number|boolean|symbol|bigint)["']$/;

function deadRanges(tokens: readonly Token[]): Array<[number, number]> {
  const dead: Array<[number, number]> = [];
  const blockEnd = (start: number): number => {
    let j = start;
    while (j < tokens.length && tokens[j]!.kind === "punct" && tokens[j]!.text === ")") j += 1;
    if (tokens[j]?.text === "{") {
      let depth = 0;
      while (j < tokens.length) {
        if (tokens[j]!.text === "{") depth += 1;
        else if (tokens[j]!.text === "}") {
          depth -= 1;
          if (depth === 0) return j + 1;
        }
        j += 1;
      }
      return j;
    }
    let depth = 0;
    while (j < tokens.length) {
      const u = tokens[j]!;
      if (u.kind === "punct") {
        if (u.text === "(" || u.text === "{" || u.text === "[") depth += 1;
        else if (u.text === ")" || u.text === "}" || u.text === "]") {
          if (depth === 0) return j;
          depth -= 1;
        } else if (u.text === ";" && depth === 0) return j + 1;
      }
      j += 1;
    }
    return j;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]!.kind !== "keyword" || tokens[i]!.text !== "typeof") continue;
    const name = tokens[i + 1];
    if (name?.kind !== "name" || !FAMILY_OF.has(name.text)) continue;
    const op = tokens[i + 2];
    const lit = tokens[i + 3];
    if (op?.kind !== "punct" || lit?.kind !== "string") continue;
    const eq = op.text === "===" || op.text === "==";
    const ne = op.text === "!==" || op.text === "!=";
    if (!eq && !ne) continue;
    const m = TYPEOF_LITERAL.exec(lit.text);
    if (m === null) continue;
    const truth = eq ? m[1] === "undefined" : m[1] !== "undefined";
    if (!truth) {
      let j = i + 4;
      let depth = 0;
      let end: number | undefined;
      let bail = false;
      while (j < tokens.length) {
        const u = tokens[j]!;
        if (u.kind === "punct") {
          if (u.text === "(" || u.text === "{" || u.text === "[") depth += 1;
          else if (u.text === "}" || u.text === "]") {
            if (depth === 0) {
              end = j;
              break;
            }
            depth -= 1;
          } else if (u.text === ")") {
            if (depth === 0) {
              end = blockEnd(j + 1);
              break;
            }
            depth -= 1;
          } else if (u.text === ";" && depth === 0) {
            end = j;
            break;
          } else if ((u.text === "|" || u.text === "?" || u.text === ",") && depth === 0) {
            bail = true;
            break;
          }
        }
        j += 1;
      }
      if (!bail && end !== undefined) dead.push([i + 4, end]);
    } else {
      const consequentEnd = blockEnd(i + 4);
      const els = tokens[consequentEnd];
      if (els?.kind === "keyword" && els.text === "else") {
        dead.push([consequentEnd + 1, blockEnd(consequentEnd + 1)]);
      }
    }
  }
  return dead;
}

export interface HostReference {
  readonly name: string;
  readonly family: string;
}

export function scanHostReferences(source: string): HostReference[] {
  const found = new Map<string, HostReference>();
  const add = (name: string): void => {
    const family = FAMILY_OF.get(name);
    if (family !== undefined && !found.has(name)) found.set(name, { name, family });
  };
  const tokens = lex(source);
  const bound = boundNames(tokens);
  const dead = deadRanges(tokens);
  const isDead = (i: number): boolean => dead.some(([a, b]) => i >= a && i < b);
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.kind !== "name" || !FAMILY_OF.has(t.text) || bound.has(t.text)) continue;
    const prev = tokens[i - 1];
    if (prev?.kind === "punct" && (prev.text === "." || prev.text === "?.")) continue;
    if (tokens[i + 1]?.kind === "punct" && tokens[i + 1]!.text === ":") continue;
    if (prev?.kind === "keyword" && prev.text === "typeof") continue;
    if (
      t.text === "Function" &&
      tokens[i + 1]?.text === "." &&
      tokens[i + 2]?.text === "prototype" &&
      tokens[i + 3]?.text === "." &&
      tokens[i + 4]?.text === "bind"
    )
      continue;
    if (isDead(i)) continue;
    add(t.text);
  }
  const code = tokens
    .filter((t) => t.kind !== "string")
    .map((t) => t.text)
    .join(" ");
  if (IMPORT_CALL.test(code)) {
    found.set("import(", { name: "import(", family: "browser" });
  }
  const literals = tokens
    .filter((t) => t.kind === "string")
    .map((t) => t.text)
    .join(" ");
  if (NODE_SPECIFIER.test(literals)) {
    found.set(`${NODE_PREFIX}:`, { name: `${NODE_PREFIX}:`, family: NODE_PREFIX });
  }
  return [...found.values()];
}
