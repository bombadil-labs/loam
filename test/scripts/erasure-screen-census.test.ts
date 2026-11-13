import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNER = "function operatorSeed(";
const END = "function defaultHome()";
const SENTENCE = "loam: this store has forgotten nothing that a reader can point at today.";

const root = mkdtempSync(join(tmpdir(), "loam-census-"));
let n = 0;

function census(source?: string, rail?: string): { code: number; out: string } {
  const env = { ...process.env };
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

const sourceWith = (banner: string, end: string): string =>
  `${banner}\nfunction cmdErase(io) {\n  io.out("${SENTENCE}");\n}\n${end} {}\n`;

describe("the erasure-screen census refuses rather than reporting a serene zero", () => {
  it("refuses a source whose region banner has moved", () => {
    const result = census(sourceWith("// --- somebody renamed this banner", END), "");
    expect(result.code, result.out).not.toBe(0);
    expect(result.out).toContain("could not bound the erasure surface");
  });

  it("refuses a source whose markers are out of order", () => {
    const result = census(`${END} {}\n${sourceWith(BANNER, "// no end marker after this")}`, "");
    expect(result.code, result.out).not.toBe(0);
    expect(result.out).toContain("could not bound the erasure surface");
  });

  it("reads a region that starts at the first byte of the file", () => {
    const result = census(sourceWith(BANNER, END), "");
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/^1 distinct prose sentences /m);
  });

  it("runs against its REAL targets, with nothing overridden", () => {
    const result = census(undefined, undefined);
    expect(result.code, result.out).toBe(0);
    const total = Number(/^(\d+) distinct prose sentences /m.exec(result.out)?.[1] ?? 0);
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
    const result = census(
      `${BANNER}\nfunction cmdErase(io) {\n  io.out(\n    "The record is gone at every tier this " +\n` +
        `      "command opened for the sweep it promised."\n  );\n}\n${END} {}\n`,
      `expect(printed()).toContain("tier this command opened");`,
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/^1 distinct prose sentences /m);
    expect(result.out).toMatch(/^0 whose words /m);
  });

  it("finds prose however it reaches a screen, not only through io.out", () => {
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
