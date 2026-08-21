// The census (`scripts/erasure-screen-census.mjs`) is an INSTRUMENT, and this rails the instrument.
//
// It reads every sentence the erasure verbs can print and reports the ones no assertion in
// `test/cli/erasure-verbs.test.ts` names. That rail file's header cites its output as the derivation
// of "what has no rail" — so a census that quietly reports a serene zero would not weaken a test,
// it would make a header lie about coverage. That is the exact shape the census exists to find.
//
// WHAT IS PINNED HERE, each of it a way the instrument has already been wrong:
//
//   1. It REFUSES when it cannot bound the region, rather than censusing an empty slice.
//   2. It refuses when the two markers are out of order, which slices backwards.
//   3. A needle inside a COMMENT is not coverage. The rail file's own header quotes assertion calls
//      while describing this defect, and that prose was being served back as proof.
//   4. A `.not.` assertion is not coverage either: it says a sentence must be ABSENT.
//   5. The unit of coverage is the SENTENCE. One statement of three sentences with one of them
//      named is two gaps, not zero — the defect that scored a twenty-sentence screen covered.
//   6. Literals joined by `+` are ONE sentence. Scoring them apart chops every real screen in half
//      and no needle can match a half.
//   7. Prose is found however it is reached — a concise arrow body, a ternary const, a `return`.
//      Enumerating the syntactic forms is the losing game that hid four sentences.
//   8. It runs against its REAL targets, not only fixtures. Every case below overrides both paths,
//      so a renamed marker in `cli.ts` would leave the instrument broken with every case green.
//
// It lives beside `no-raw-nul.test.ts` and `timeout-floor.test.ts`, where this repo keeps the rails
// that assert on the REPOSITORY rather than on Loam.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNER = "// --- the erasure surface (SPEC §11, §29; T206)";
const END = "function defaultHome()";
const SENTENCE = "loam: this store has forgotten nothing that a reader can point at today.";

const root = mkdtempSync(join(tmpdir(), "loam-census-"));
let n = 0;

/**
 * Run the census. With both arguments it reads FIXTURES; with neither it reads the real `cli.ts`
 * and the real rail file, which is the only case that proves the instrument still runs where it is
 * pointed in earnest.
 */
function census(source?: string, rail?: string): { code: number; out: string } {
  const env = { ...process.env };
  // CLEARED, NEVER INHERITED. The no-override case exists to prove the instrument still runs
  // against the real `cli.ts`; a shell that already exports these would point it at a fixture and
  // the case would pass having proven nothing.
  delete env["CENSUS_SOURCE"];
  delete env["CENSUS_RAIL"];
  if (source !== undefined && rail !== undefined) {
    const dir = join(root, `case-${(n += 1)}`);
    mkdirSync(dir, { recursive: true });
    const sourcePath = join(dir, "source.ts");
    const railPath = join(dir, "rail.ts");
    writeFileSync(sourcePath, source);
    writeFileSync(railPath, rail);
    env["CENSUS_SOURCE"] = sourcePath;
    env["CENSUS_RAIL"] = railPath;
  }
  try {
    const out = execFileSync("node", ["scripts/erasure-screen-census.mjs"], {
      encoding: "utf8",
      env,
    });
    return { code: 0, out };
  } catch (err) {
    const failed = err as { status?: number; stderr?: string; stdout?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

/** A source file whose erasure region prints exactly one sentence. */
const sourceWith = (banner: string, end: string): string =>
  `${banner}\nfunction cmdErase(io) {\n  io.out("${SENTENCE}");\n}\n${end} {}\n`;

describe("the erasure-screen census refuses rather than reporting a serene zero", () => {
  it("refuses a source whose region banner has moved", () => {
    const result = census(sourceWith("// --- somebody renamed this banner", END), "");
    expect(result.code, result.out).not.toBe(0);
    expect(result.out).toContain("could not bound the erasure surface");
  });

  it("refuses a source whose markers are out of order", () => {
    // `to <= from` slices backwards, which yields an empty region and a census of nothing.
    const result = census(`${END} {}\n${sourceWith(BANNER, "// no end marker after this")}`, "");
    expect(result.code, result.out).not.toBe(0);
    expect(result.out).toContain("could not bound the erasure surface");
  });

  it("reads a region that starts at the first byte of the file", () => {
    // The bound is `from < 0`, not `from < 1`: a banner at offset 0 is a found banner.
    const result = census(sourceWith(BANNER, END), "");
    expect(result.code, result.out).toBe(0);
    // ANCHORED. "1 distinct prose sentences" is a substring of "21 distinct prose sentences", so a
    // `toContain` here reads a count of twenty-one as a count of one.
    expect(result.out).toMatch(/^1 distinct prose sentences /m);
  });

  it("runs against its REAL targets, with nothing overridden", () => {
    // EVERY OTHER CASE POINTS IT AT A FIXTURE. Nothing else in this repo runs the instrument
    // against `src/cli/cli.ts`, so a renamed region banner would leave it unrunnable — refusing
    // correctly, and refusing where nobody looks — with this whole file still green. That is the
    // rail-glob-matching-nothing shape, one layer up.
    const result = census(undefined, undefined);
    expect(result.code, result.out).toBe(0);
    const total = Number(/^(\d+) distinct prose sentences /m.exec(result.out)?.[1] ?? 0);
    // A FLOOR ON THE DENOMINATOR, not a target. A moved MARKER makes the script throw and the two
    // refusal cases catch it — but a SHRUNKEN region does not: move one verb below the end marker
    // and the instrument censuses a fraction of the surface, prints a small honest-looking count,
    // exits 0, and every other case here stays green while the rail file's header still cites its
    // output. Three verbs' screens do not fit in fifty sentences.
    expect(total, result.out).toBeGreaterThan(50);
  });
});

describe("the erasure-screen census counts only what a rail POSITIVELY asserts", () => {
  it("credits a positive assertion", () => {
    const result = census(
      sourceWith(BANNER, END),
      `expect(printed()).toContain("${SENTENCE.slice(0, 40)}");`,
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("0 whose words");
  });

  it("does not credit a needle that appears only inside a comment", () => {
    const result = census(
      sourceWith(BANNER, END),
      `// The header explains .toContain("${SENTENCE.slice(0, 40)}") and must not score it.\n`,
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("1 whose words");
  });

  it("counts each SENTENCE of a statement, not the statement", () => {
    // The defect this replaced scored whole statements, so four matched words anywhere in a
    // twenty-sentence screen scored all twenty. Three sentences in one `io.out`, one of them named.
    const result = census(
      `${BANNER}\nfunction cmdErase(io) {\n  io.out("The record is gone at every tier. The pen ` +
        `was not read by this run. A peer keeps a copy of its own.");\n}\n${END} {}\n`,
      `expect(printed()).toContain("The record is gone at every tier.");`,
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/^3 distinct prose sentences /m);
    expect(result.out).toMatch(/^2 whose words /m);
  });

  it("re-joins literals a `+` split, and reads them as one sentence", () => {
    // A screen's prose is written as a run of literals joined by `+`. Scored apart, no needle can
    // match across the join and every such sentence reads as a gap.
    // BOTH HALVES CARRY ENOUGH WORDS TO SURVIVE ON THEIR OWN, and the needle matches only ACROSS
    // the join. Split, that is two sentences and the first is a gap; joined, it is one and covered.
    // A fixture whose second half is too short to count cannot tell the two apart.
    const result = census(
      `${BANNER}\nfunction cmdErase(io) {\n  io.out(\n    "The record is gone at every tier this " +\n` +
        `      "command opened for the sweep it promised."\n  );\n}\n${END} {}\n`,
      // THE NEEDLE STOPS AT THE JOIN. "command opened for" would be found inside the second half
      // on its own, and "gone at every" inside the first — a needle containing both credits each
      // half separately and only the sentence COUNT would discriminate.
      `expect(printed()).toContain("tier this command opened");`,
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/^1 distinct prose sentences /m);
    // Split, BOTH halves are gaps: neither carries a three-word run of the needle. Joined, the one
    // sentence does. So this assertion moves with the re-join rather than riding on the count.
    expect(result.out).toMatch(/^0 whose words /m);
  });

  it("finds prose however it reaches a screen, not only through io.out", () => {
    // `where`, `at`, `idle` and `withheld` reach a screen through a concise arrow body or a
    // ternary const. An extractor that enumerates `io.out(` and `return` cannot see any of them.
    const result = census(
      `${BANNER}\nconst where = () => "A tier that cannot answer has proven nothing here.";\n` +
        `const idle = true ? "No cold archive was consulted by this run at all." : "";\n${END} {}\n`,
      "",
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/^2 distinct prose sentences /m);
  });

  it("does not credit an assertion that the sentence is ABSENT", () => {
    const result = census(
      sourceWith(BANNER, END),
      `expect(printed()).not.toContain("${SENTENCE.slice(0, 40)}");`,
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("1 whose words");
  });
});
