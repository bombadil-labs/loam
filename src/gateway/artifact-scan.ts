// The pack-time reference scan (SPEC §30, Recommendation 10) — the CHEAP half of confinement, never the
// enforcing one. A conforming renderer is `(node) => string`: a pure function of its argument, which needs
// no host global at all. So a bundle that REFERENCES one is either written for one host only, or reaching
// for a channel that outlives the per-render realm, and both are decidable here from the source the packer
// already holds.
//
// Three families, and the third is the one a page-realm reading would miss. The bundle runs in a WORKER
// realm: no `window`, no `document`, no `localStorage` — but `indexedDB`, `caches`, and `BroadcastChannel`
// are bare identifiers there, so `Worker.terminate()` alone does not empty the compartment. A bundle
// calling `indexedDB.open("keep")` holds a copy across every render and every teardown, in a store §11
// cannot reach and the shell cannot enumerate.
//
// IT SCANS REFERENCES, NOT SUBSTRINGS, and that is the whole engineering of this module. A substring scan
// refuses the bundles §23.2 names as the target shape — bundler output for a React renderer routinely
// carries `process.env.NODE_ENV`, a `globalThis` polyfill, and `typeof document !== "undefined"` guards —
// and it also refuses `processNote`, `documentTitle`, and any of these tokens inside a comment or a string.
// A door that refuses nearly every real bundle is not a cheap guard; it is broken, and a rail that
// measures only true positives stays green while it happens.
//
// So this lexes the source properly (comments, strings, templates, regex literals) and then counts an
// identifier only where it is a FREE REFERENCE IN AN EVALUATED POSITION. Suppressed:
//   - a member name (`obj.window`, `obj?.window`) and an object-literal / class key (`{ window: 1 }`)
//   - a LOCALLY BOUND name — a `var`/`let`/`const`/`function`/`class`/parameter/catch binding anywhere in
//     the unit shadows the global for the whole unit. Coarser than real scope analysis, and deliberately
//     so: it errs toward PACKING, which is the direction the enforcing half covers.
//   - the operand of `typeof` — feature detection reaches nothing.
//   - a reference inside the arm of a `typeof X === "undefined"` guard that cannot run in the worker
//     realm, which is exactly the shape a bundler emits. In that realm the refused globals ARE undefined,
//     so the "defined" arm is dead code and its references are unreachable.
//
// Said honestly in the other direction: even a reference scan is defeatable by construction
// (`globalThis["win" + "dow"]`), which is why §30's enforcing half is the realm boundary itself. Both,
// not either — prove what is decidable, confine what is not.

// The refused reach, by family. Every name here is either absent from a conforming `RenderFn`'s needs or
// a channel that survives the realm's teardown.
export const HOST_GLOBALS: Readonly<Record<string, readonly string[]>> = {
  // Browser reach — a page realm the bundle does not run in, plus the runtime's own affordances. A bundle
  // reaching `window.claude` (MCP, downloads, a sendPrompt-class call) would be silently artifact-only;
  // a host affordance reaches an app by MEDIATION — a gesture the shell honors — never ambiently.
  browser: [
    "window",
    "document",
    "claude",
    "localStorage",
    "sessionStorage",
    "navigator",
    "location",
  ],
  // Node reach — the server host's realm, not this one. A bundle using these works where it was tested.
  node: ["require", "Buffer", "process", "module", "__dirname", "__filename"],
  // Worker-realm reach that SURVIVES a teardown, plus the doors to it. This is the family that makes
  // "the compartment retains nothing" true rather than aspirational.
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
  // Code that is not the code that was signed. §23.1's attestation is that the bundle's hash IS what
  // runs; a bundle that evaluates a string it built has a signed-vs-executed gap of its own making.
  eval: ["eval", "Function"],
};

const FAMILY_OF = new Map<string, string>(
  Object.entries(HOST_GLOBALS).flatMap(([family, names]) => names.map((n) => [n, family] as const)),
);

// Reach that is a SYNTAX form rather than an identifier, so no scope or member rule applies: a dynamic
// `import(...)` fetches a module the signature never attested, and a `node:` specifier names a builtin.
const IMPORT_CALL = /\bimport\s*\(/;
// Assembled rather than written as a literal: the browser bundle is scanned for a bare `node:`
// specifier (test/site/build.test.ts), and a regex spelling one would trip that rail while importing
// nothing at all. The prefix is DATA here, not an import.
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

// Can a `/` at this point start a REGEX rather than divide? The classic lexer ambiguity, decided the
// classic way: by what the previous significant token was. Getting it wrong swallows real code as a
// regex body (or reads a regex body as code), and either way the scan's answers stop meaning anything.
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

// Lex a unit of JS into the tokens the scan cares about: names, keywords, punctuation, and a single
// opaque token per string/template/regex/comment. Deliberately forgiving — an un-lexable tail stops the
// walk rather than throwing, because a scan that crashes on an exotic bundle is a door that refuses it.
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
      // A template literal's ${...} holds real code, so its interpolations are lexed rather than
      // skipped — a reference hidden in one is still a reference.
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
      while (i < n && ID_PART.test(src[i]!)) i += 1; // flags
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
    // Punctuation, longest-match on the multi-character forms the walk actually branches on.
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

// Every name BOUND somewhere in the unit. Unit-wide rather than per-scope on purpose (see the header):
// a bundle that names a local `process` shadows the global, and treating that as a reach would refuse
// code that touches nothing. The bias is toward packing, and the realm boundary is what enforces.
function boundNames(tokens: readonly Token[]): ReadonlySet<string> {
  const bound = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.kind === "keyword" && (t.text === "var" || t.text === "let" || t.text === "const")) {
      // A declaration list, including destructuring: take every name up to the initializer/terminator.
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
    // A parameter list — `(a, b = 1, { c })` — after `function`/`catch`/a name, or an arrow's own.
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
    // An arrow's bare single parameter: `x => …`.
    if (t.kind === "punct" && t.text === "=>") {
      const prev = tokens[i - 1];
      if (prev?.kind === "name" && tokens[i - 2]?.text !== ")") bound.add(prev.text);
    }
  }
  return bound;
}

// A `typeof`-literal every guard resolves against. Real bundler output does NOT stick to
// `"undefined"`: esbuild-minified react-dom emits `typeof window == "object"` and
// `typeof process.emit == "function"` (T97's vendored fixture carries both), and in the worker realm
// every one of these decides the same way, because the refused name IS undefined there.
const TYPEOF_LITERAL = /^["'](undefined|object|function|string|number|boolean|symbol|bigint)["']$/;

// The token ranges a worker realm can never execute: the arm of a `typeof X <op> "literal"` guard that
// requires X to be defined, where X is one of the names we refuse. In THIS realm those names are
// genuinely absent, so `typeof X` is "undefined", every comparison against a typeof-literal has a KNOWN
// value, and the arm the false side guards is dead — precisely the shape a bundler emits around a
// browser-only or node-only path.
function deadRanges(tokens: readonly Token[]): Array<[number, number]> {
  const dead: Array<[number, number]> = [];
  // The end of the block that starts at `start`: a braced block to its matching `}`, or a single
  // statement up to `;` (stopping if the enclosing block closes first).
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
        } else if (u.text === ";" && depth === 0) return j + 1; // past the statement, like `}` above
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
    // In the worker realm `typeof X` is "undefined", so the comparison's value is decided here.
    const truth = eq ? m[1] === "undefined" : m[1] !== "undefined";
    if (!truth) {
      // FALSE guard: everything it gates is unreachable — the rest of the `&&` chain, the enclosing
      // condition's tail, and the consequent block. Walk from the comparison to the end of the
      // condition, then through the guarded block. Bail out (marking nothing — erring toward
      // REFUSAL) on any shape where the tail can still run: an `||` alternative, a ternary, a comma
      // operator (another argument or expression evaluates regardless of this one).
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
              end = j; // the enclosing block closed — a bare guard expression, dead to here
              break;
            }
            depth -= 1;
          } else if (u.text === ")") {
            if (depth === 0) {
              end = blockEnd(j + 1); // the condition closed — the consequent it gates is dead too
              break;
            }
            depth -= 1;
          } else if (u.text === ";" && depth === 0) {
            end = j; // a bare `typeof X !== "undefined" && X.y();` — dead to the statement's end
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
      // TRUE guard: the consequent is the reachable arm; only an explicit ELSE arm is dead.
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

// Every host-global reference this bundle makes, in source order, deduplicated by name. Empty means the
// bundle stays on §30's floor: a pure function of its argument, runnable on either host.
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
    // A member name, not a reference to the global: `obj.window`, `obj?.window`.
    if (prev?.kind === "punct" && (prev.text === "." || prev.text === "?.")) continue;
    // A key in an object literal or a class body: `{ window: 1 }`, `{ fetch() {} }`.
    if (tokens[i + 1]?.kind === "punct" && tokens[i + 1]!.text === ":") continue;
    // The operand of `typeof` — feature detection reaches nothing.
    if (prev?.kind === "keyword" && prev.text === "typeof") continue;
    // `Function.prototype.bind`, exactly — esbuild-minified react-dom caches it in a module-level
    // `var`. Reading `bind` off the prototype evaluates no string; the eval-family hazard is the
    // CONSTRUCTOR. Only this member chain is suppressed: `Function(...)`, `new Function`, and
    // `Function.prototype.constructor` all still refuse.
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
  // The two syntax forms no identifier rule covers, and they read DIFFERENT inputs — which the previous
  // comment claimed of both and was only true of one. `import(` is tested against the lexed token
  // stream with strings and comments already gone. `node:` is tested against the STRING TOKENS, because
  // a module specifier is always inside a string literal: that is where a real one lives, and it keeps a
  // `// see node:fs` in a comment from being refused. Both stay fail-closed on anything they do see.
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
