// Re-derive the "what has no rail" census MECHANICALLY instead of editing it by hand.
//
// The hand-edited list was wrong four times, always the same way: a fix adds a printed line, the
// list is updated for the lines a reviewer named, and the line the fix itself introduced goes
// unlisted. So this reads the SOURCE for the sentences the three verbs can print and the RAIL FILE
// for what it actually ASSERTS, and reports source prose no needle appears to match.
//
// THE TOOL HAS BEEN WRONG TWICE ITSELF, both times by counting something as coverage that was not:
//
//  1. It matched against the rail file VERBATIM, so the gap list's own prose counted — a sentence
//     quoted here to say a line was unrailed matched that line and scored it railed. The list was
//     hiding gaps from the tool built to find them. Only assertion needles count now.
//  2. `.toMatch(` also matches `.not.toMatch(`, so an assertion that a sentence is ABSENT supplied
//     the needle proving it was covered — and the unconsulted disclosure was scored covered by the
//     rail asserting it never prints. A negative is now rejected outright.
//  3. It censused whole STATEMENTS, and the erase screen is one statement of some twenty sentences:
//     four matched words anywhere in it scored the entire screen covered. It also enumerated the
//     syntactic forms that return prose — `return` and nothing else — so a concise arrow body or a
//     ternary const was simply not seen. Both are gone: comments are stripped, every string literal
//     in the region is collected however it is reached, and the unit of coverage is the SENTENCE.
//
// Both were the same shape as the bug the census exists to find: something that looks like proof,
// isn't, and is quiet about it. Expect a third; re-read this list rather than trusting the count.
//
// It still errs in both directions, so it is a WORKLIST and not an oracle:
//   - FALSE NEGATIVE: a regex needle (`/BROUGHT \d+ CLAIM/`) is not a substring of the source, so a
//     railed sentence can read as unrailed. Check each hit by hand.
//   - FALSE POSITIVE: it censuses SENTENCES, not BRANCHES. A sentence asserted once counts as
//     covered even where the loop producing it for a second store is unrailed — which is exactly how
//     `setAsideWarning`'s pool arm survived until a reviewer found it by hand.

import { readFileSync } from "node:fs";

// THE PATHS ARE OVERRIDABLE so the instrument itself can be railed. An instrument nobody can
// point at a fixture is one nobody can prove wrong, which is the property it exists to deny others.
const cli = readFileSync(process.env["CENSUS_SOURCE"] ?? "src/cli/cli.ts", "utf8");
const rail = readFileSync(process.env["CENSUS_RAIL"] ?? "test/cli/erasure-verbs.test.ts", "utf8");

const from = cli.indexOf("// --- the erasure surface (SPEC §11, §29; T206)");
const to = cli.indexOf("function defaultHome()");
// A moved banner would otherwise slice an empty region and report a serene 0 of 0.
if (from < 0 || to < 0 || to <= from) {
  throw new Error(`could not bound the erasure surface in cli.ts (from=${from}, to=${to})`);
}
const region = cli.slice(from, to);

// EVERY STRING LITERAL IN THE REGION, however it is reached. Enumerating the syntactic forms that
// carry prose to a screen was a losing game: `io.out(...)` and `return` were listed, and a concise
// arrow body (`where`, `at`) or a ternary const (`idle`, `withheld`) reached a screen without
// matching either — invisible to the instrument that exists to find what is invisible. Comments are
// stripped first, since this file's comments quote identifiers in backticks.
const code = region
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .map((line) => {
    // Only outside a string, and never a protocol's "//". Cheap, and the region holds no URL.
    const at = line.search(/(?<![:"`])\/\//);
    return at < 0 ? line : line.slice(0, at);
  })
  .join("\n");

// THE UNIT OF COVERAGE IS THE SENTENCE, not the statement. The erase screen is ONE `io.out` of some
// twenty sentences, so a statement-level census scored the whole screen covered on four matched
// words — the limits, the reused-receipt caveat and the pen disclosure all rode in free on the
// success line's needle. A sentence has to earn its own.
// CONCATENATION IS ONE SENTENCE. A screen's prose is written as a run of literals joined by `+`,
// so collecting each literal on its own chopped nearly every sentence in half and no needle could
// match a half. Literals separated by nothing but whitespace and `+` are re-joined first.
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

// THE UNIT OF COVERAGE IS THE SENTENCE, not the statement. The erase screen is ONE `io.out` of some
// twenty sentences, so a statement-level census scored the whole screen covered on four matched
// words — the limits, the reused-receipt caveat and the pen disclosure all rode in free on the
// success line's needle. A sentence has to earn its own.
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

// COMMENTS STRIPPED FIRST, and this is the first wrongness returning in a new costume: the needle
// scan reads the whole rail file, so a HEADER SENTENCE quoting `.toMatch(` — as the paragraph
// describing this very defect does — opened a capture that swallowed the prose around it and served
// it back as coverage. The census would then credit a line because a comment about the census
// mentioned it.
const railCode = rail
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .map((line) => {
    const at = line.search(/(?<![:"`])\/\//);
    return at < 0 ? line : line.slice(0, at);
  })
  .join("\n");

// ONLY what the rails POSITIVELY assert. A `not.toMatch` says a sentence must be absent, which is
// the opposite of evidence that it is pinned when present.
const needles = [...railCode.matchAll(/(\.not)?\.(?:toMatch|toContain)\(\s*([\s\S]*?)\)/g)]
  .filter((m) => m[1] === undefined)
  .map((m) => m[2])
  .join("   ")
  // A NEEDLE IS AS OFTEN A REGEX AS A SUBSTRING, and a regex is not a substring of anything. Every
  // metacharacter becomes a space, so an alternation becomes the literal runs it is made of and a
  // railed sentence stops reading as a gap. It cannot make a match where none exists: the words
  // still have to appear, in order, in something this rail file passed to an assertion.
  .replace(/[\\^$.*+?()[\]{}|/]/g, " ")
  .replace(/\s+/g, " ");

const railed = (text) => {
  const words = text.split(" ").filter((w) => /[A-Za-z]/.test(w));
  // THREE, not four. Needles are regexes as often as substrings, and an alternation
  // (`/had no BEFORE|did not look/`) has no four-word run to be found in — so a four-word window
  // reported two dozen railed sentences as gaps and buried the real ones. Three over-credits in
  // principle; the list is read by hand anyway, and a list nobody finishes reading is worse.
  for (let i = 0; i + 3 <= words.length; i += 1) {
    if (needles.includes(words.slice(i, i + 3).join(" "))) return true;
  }
  return false;
};

const unrailed = statements.filter((s) => !railed(s));
console.log(`${statements.length} distinct prose sentences in the erasure surface`);
console.log(`${unrailed.length} whose words no positive assertion appears to name:\n`);
for (const s of unrailed) console.log(`  - ${s.slice(0, 150)}\n`);
