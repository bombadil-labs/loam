import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CONFIG = "vitest.config.mjs";

type Budget = { key: "testTimeout" | "hookTimeout"; value: number };

const budgetsIn = (source: string): Budget[] =>
  [...source.matchAll(/\b(testTimeout|hookTimeout)\s*:\s*([0-9_]+)/g)].map((m) => ({
    key: m[1] as Budget["key"],
    value: Number((m[2] as string).replaceAll("_", "")),
  }));

const floors = (() => {
  const found = budgetsIn(readFileSync(join(ROOT, CONFIG), "utf8"));
  return {
    testTimeout: found.find((b) => b.key === "testTimeout")?.value,
    hookTimeout: found.find((b) => b.key === "hookTimeout")?.value,
  };
})();

const offendersIn = (rel: string, source: string): string[] =>
  budgetsIn(source).flatMap(({ key, value }) => {
    const floor = floors[key] as number;
    return value < floor ? [`${rel}: ${key} ${value} < ${floor}`] : [];
  });

const SELF = "test/scripts/timeout-floor.test.ts";

const testSources = (): string[] =>
  execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--", "test/"], { encoding: "utf8" })
    .split(String.fromCharCode(0))
    .filter((rel) => /\.(?:ts|mts|cts|mjs|js)$/.test(rel) && rel !== SELF);

describe("no test file lowers its file-level timeout below the repo's own default", () => {
  it("the floor is read from vitest.config.mjs, not retyped here", () => {
    expect(floors.testTimeout).toBeGreaterThan(0);
    expect(floors.hookTimeout).toBeGreaterThan(0);
  });

  it("finds the declarations it claims to be checking", () => {
    const sources = testSources();
    expect(sources.length).toBeGreaterThan(100);
    const withOverrides = sources.filter(
      (rel) => budgetsIn(readFileSync(join(ROOT, rel), "utf8")).length > 0,
    );
    expect(withOverrides.length).toBeGreaterThan(20);
  });

  it("sets no budget of its own, which is what makes excluding itself safe", () => {
    expect(readFileSync(join(ROOT, SELF), "utf8")).not.toMatch(/vi\.setConfig/);
  });

  it("reports a below-floor declaration, and says which key and by how much", () => {
    expect(offendersIn("fake.test.ts", "{ testTimeout: 15000 }")).toEqual([
      "fake.test.ts: testTimeout 15000 < 20000",
    ]);
    expect(offendersIn("fake.test.ts", "{ hookTimeout: 5_000 }")).toEqual([
      "fake.test.ts: hookTimeout 5000 < 20000",
    ]);
  });

  it("stays silent on a budget at or above the floor", () => {
    expect(offendersIn("fake.test.ts", "{ testTimeout: 20_000, hookTimeout: 90_000 }")).toEqual([]);
  });

  it("every declared file-level budget is at or above the config's", () => {
    const offenders = testSources().flatMap((rel) =>
      offendersIn(rel, readFileSync(join(ROOT, rel), "utf8")),
    );
    expect(
      offenders,
      `These files ask for LESS room than ${CONFIG} grants every test file. Raise each to the ` +
        `config's own value, or delete the override and inherit it. Do not lower the config: a ` +
        `Windows fsync measurement set it, and \`git log -p vitest.config.mjs\` shows that ` +
        `measurement. A deliberately short clock ` +
        `belongs on the ONE test that needs it, as a per-test budget.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
