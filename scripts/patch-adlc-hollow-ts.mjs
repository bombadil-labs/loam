#!/usr/bin/env node
// Re-appliable local patch: `adlc hollow-test` cannot mutate a TypeScript file.
//
// @adlc/hollow-test's `SOURCE_EXT_RE` (lib/targets.mjs) is `/\.(?:mjs|cjs|js)$/i` — an
// include-list of what the tool will mutate, and TypeScript is simply absent from it. The
// omission reads as deliberate because the refusal is loud, but the message contradicts itself:
//
//   --target src/server/http.ts is not a supported source language — mutation operators are
//   JS/TS-shaped, and mutating another language yields syntactically invalid code [...]
//
// The operators ARE JS/TS-shaped. They are line-level regex rewrites in @adlc/core's OPERATORS
// (invert-comparison, bool-flip, null-return, off-by-one, logic-swap, negate-guard-subclause,
// ternary-swap) — every one of them valid on TypeScript, which is a syntactic superset. The guard
// meant to exclude .py and .css and caught .ts by never listing it. Upstream knows the shape of
// this bug: the comment directly above the regex describes a predicate drift where "A TypeScript-only
// diff did exactly that" and went green without testing the change.
//
// LOAM IS ENTIRELY TYPESCRIPT UNDER src/, so this was total. CLAUDE.md mandates hollow-test at P3
// and P5 via `--target <file>`, and every such invocation exited 1 — the gate called "the shipped
// detector for our worst recurring bug" had never mutated a line of Loam source. In diff-scoped mode
// (no --target) it is worse: `filterTargetFiles` drops the .ts files silently and the run reports
// zero mutants as a PASS. A green that proves nothing is the exact failure hollow-test exists to
// detect, and it was reporting one about itself.
//
// TWO SITES, and the second is why this patch is not one line:
//
//   1. targets.mjs SOURCE_EXT_RE — admit ts/mts/cts/tsx/jsx alongside the JS forms.
//   2. core/lib/mutate.mjs invert-comparison — the bare-angle swaps (`<` → `>=`, `>` → `<=`)
//      cannot tell a comparison from a type argument. On `Record<string, Gateway>` they emit
//      `Record>=string, Gateway>`, which does not parse. runner.mjs scores
//      `killed = timedOut || status !== 0`, so a mutant that breaks the build is recorded as
//      KILLED BY THE TESTS. Admitting TS without this guard would trade a gate that refuses for a
//      gate that inflates its own kill rate — the same false green wearing a better hat. The guard
//      skips only the two bare-angle swaps, and only on lines carrying a generic-shaped token;
//      `===`/`!==`/`<=`/`>=` are unambiguous and keep firing everywhere.
//
// THIS IS A GLOBAL PACKAGE PATCH, so `npm i -g @adlc/cli` wipes it — run it after any adlc upgrade
// (`npm run adlc:patch` runs it alongside the npx and init patches). Idempotent, counts call sites
// rather than testing presence, READS EACH FILE BACK to verify, and refuses rather than guessing if
// upstream has restructured either site.
//
// Upstream: github.com/voodootikigod/adlc — remove this script once a released @adlc/cli mutates
// TypeScript. Last checked against 1.7.0 (latest); no published version admits .ts.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Site 1 — the include-list that decides what may be mutated at all.
const EXT_NEEDLE = "const SOURCE_EXT_RE = /\\.(?:mjs|cjs|js)$/i;";
const EXT_PATCHED = "const SOURCE_EXT_RE = /\\.(?:mts|cts|tsx?|mjs|cjs|jsx?)$/i;";

// Site 2 — the operator that would mangle a type argument into a parse error.
// `GENERIC_RE` is deliberately narrow: an identifier immediately followed by a bracketed run with
// no intervening angle bracket. `a < b && c > d` does not match (spaces); `Promise<void>` does.
// When it matches, the two ambiguous swaps are withheld for that line rather than the operator
// being skipped — an unambiguous `===` on the same line still mutates.
//
// THE PATCHED FORM MUST NOT CONTAIN THE NEEDLE, and this site wants to keep the two regexes it
// guards — so the obvious shape (wrap the line, leave it byte-identical inside) is wrong twice
// over: `count(after, needle)` stays 1, which the verify step reads as "unpatched site remains",
// and a re-run re-wraps, nesting the guard once per invocation. Indenting the inner line does not
// help either; a deeper indent still contains the shallower needle as a substring. The regexes are
// therefore re-laid-out onto a bracket-prefixed line, which no amount of leading whitespace can
// match. `assertReplaces()` below enforces the rule structurally rather than trusting this comment.
const CMP_NEEDLE = "        [/(?<![<>=!])<(?![=<])/g, '>='], [/(?<![<>=!-])>(?![=>])/g, '<='],\n";
const CMP_PATCHED =
  "        ...(/[A-Za-z_$][\\w$]*\\s*<[^<>]*>/.test(line)\n" +
  "          ? []\n" +
  "          : [[/(?<![<>=!])<(?![=<])/g, '>='], [/(?<![<>=!-])>(?![=>])/g, '<=']]),\n";

// Reaching npm to find the global root has the same shell-free-spawn problem the npx patch
// documents: `npm.cmd` without a shell throws EINVAL. Spawn node against npm's own CLI instead.
const nodeAdjacentNpm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const globalRoot = existsSync(nodeAdjacentNpm)
  ? execFileSync(process.execPath, [nodeAdjacentNpm, "root", "-g"], { encoding: "utf8" }).trim()
  : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
if (!isAbsolute(globalRoot)) {
  console.error(
    `adlc-hollow-ts-patch: 'npm root -g' gave a non-absolute path (${globalRoot}) — refusing.`,
  );
  process.exit(1);
}

const count = (hay, needle) => hay.split(needle).length - 1;

// npm honors `npm_config_prefix` and `.npmrc`, so pin every write target inside the resolved root
// rather than trusting whatever came back.
function pin(...segments) {
  const target = resolve(globalRoot, ...segments);
  if (!target.startsWith(resolve(globalRoot))) {
    console.error(`adlc-hollow-ts-patch: refusing to write outside the global root (${target}).`);
    process.exit(1);
  }
  return target;
}

/**
 * A patch whose output still contains its own input is not a substitution — it is a loop. Every
 * run would find the needle "stale", rewrite, and nest one layer deeper, while the read-back check
 * reported a mixed state it could never clear. Checked BEFORE any write, so the failure mode is a
 * refusal on a clean tree rather than a corrupted global package.
 */
function assertReplaces(label, needle, patched) {
  if (patched.includes(needle)) {
    console.error(
      [
        `adlc-hollow-ts-patch: the ${label} substitution embeds its own needle — it would nest on`,
        "  every re-run and never verify. Fix the patched form; refusing to write.",
      ].join("\n"),
    );
    process.exit(1);
  }
}

/**
 * Apply one needle→patched substitution to one file, verifying by reading it back.
 * Returns a one-line report. Exits non-zero rather than guessing.
 */
function patchSite({ label, target, needle, patched }) {
  assertReplaces(label, needle, patched);

  let source;
  try {
    source = readFileSync(target, "utf8");
  } catch {
    console.error(`adlc-hollow-ts-patch: cannot read ${target} — is @adlc/cli installed globally?`);
    process.exit(1);
  }

  // Count call sites rather than testing presence — a first-occurrence replace that then reports
  // "already applied" forever is a completeness claim nobody verified (H7).
  const stale = count(source, needle);
  const alreadyPatched = count(source, patched);

  if (stale === 0) {
    if (alreadyPatched > 0) {
      return `${label}: already applied (${alreadyPatched} site(s)).`;
    }
    console.error(
      [
        `adlc-hollow-ts-patch: the expected ${label} expression is not present in ${target}.`,
        "  Upstream may have fixed this (try `adlc hollow-test --target <file>.ts`) or",
        "  restructured it. Refusing to patch — inspect the file rather than letting this guess.",
      ].join("\n"),
    );
    process.exit(2);
  }

  writeFileSync(target, source.split(needle).join(patched), "utf8");

  const after = readFileSync(target, "utf8");
  const left = count(after, needle);
  const now = count(after, patched);
  if (left > 0 || now === 0) {
    console.error(
      [
        `adlc-hollow-ts-patch: VERIFICATION FAILED for ${label} — ${left} unpatched site(s) ` +
          `remain, ${now} patched.`,
        `  ${target} may be in a mixed state; inspect it before running hollow-test.`,
      ].join("\n"),
    );
    process.exit(1);
  }
  return `${label}: ${stale} site(s) rewritten, ${now} verified after write.`;
}

const reports = [
  patchSite({
    label: "source-extension include-list",
    target: pin("@adlc", "cli", "node_modules", "@adlc", "hollow-test", "lib", "targets.mjs"),
    needle: EXT_NEEDLE,
    patched: EXT_PATCHED,
  }),
  patchSite({
    label: "invert-comparison generic guard",
    target: pin("@adlc", "cli", "node_modules", "@adlc", "core", "lib", "mutate.mjs"),
    needle: CMP_NEEDLE,
    patched: CMP_PATCHED,
  }),
];

for (const line of reports) console.log(`adlc-hollow-ts-patch: ${line}`);
console.log("adlc-hollow-ts-patch: hollow-test now mutates TypeScript.");
