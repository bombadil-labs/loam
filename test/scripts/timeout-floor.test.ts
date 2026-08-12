// Repo hygiene, not runtime behavior (ticket T159): no test file may set a per-file timeout BELOW
// the one `vitest.config.mjs` chose for this platform.
//
// The config's 20s is not a round number somebody liked. Its own comment records the measurement:
// the suite drives real sqlite files, and an fsync plus WAL checkpoint on a loaded Windows runner
// legitimately costs seconds, so the 5s default was failing byte-level erasure rails that pass
// everywhere else. A file that then calls setConfig with a testTimeout of 15000 silently undoes
// that decision for itself.
//
// WHY A RAIL AND NOT JUST THE 32 FIXES. The failure is invisible until it fires. A lowered budget
// changes no assertion, reads as ordinary boilerplate, and copies cleanly into the next file — and
// the files that carry it do not fail together, they take turns, because which one breaches depends
// on what else the runner was doing. That is a class, and a class needs a gate: without this file
// the next copied line reopens it and nobody learns until a Windows runner picks that file.
//
// It permits every budget ABOVE the default. A browser drive, an esbuild bundle and a real scrypt
// each need more room than 20s, and asking for more is a considered decision a reviewer can read.
// Asking for LESS is the shape that has only ever been an accident.
//
// It lives beside `no-raw-nul.test.ts` because that is where this repo keeps the rails that assert
// on the REPOSITORY rather than on Loam.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The floor comes from the config itself, never from a number retyped here. A duplicated constant
// would let the config move up and leave this rail guarding the old value — the exact drift the
// rail exists to prevent, reintroduced by the rail.
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

// This file is its OWN exception, and only this one: it quotes a below-floor declaration on
// purpose, in the negative control and in the prose above it. The exception is safe because the
// test below proves this file makes no setConfig call of its own — an exclusion that could hide
// a real override would be a hole, so it is asserted rather than assumed.
const SELF = "test/scripts/timeout-floor.test.ts";

// Tracked test sources only. A build artifact or an untracked scratch file is not something a
// reviewer owns, and `dist/` carries compiled copies of these same lines.
const testSources = (): string[] =>
  execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--", "test/"], { encoding: "utf8" })
    .split(String.fromCharCode(0))
    .filter((rel) => /\.(?:ts|mts|cts|mjs|js)$/.test(rel) && rel !== SELF);

describe("no test file lowers its timeout below the repo's own default", () => {
  // Read first, assert second. Every check below is vacuous if the config's numbers did not parse —
  // an undefined floor compares false against everything and would report a clean sweep.
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
    // A scan that matched nothing would pass the real assertion below in perfect silence. This is
    // the count that makes that impossible: the suite genuinely does carry per-file budgets.
    expect(withOverrides.length).toBeGreaterThan(20);
  });

  it("sets no budget of its own, which is what makes excluding itself safe", () => {
    expect(readFileSync(join(ROOT, SELF), "utf8")).not.toMatch(/vi\.setConfig/);
  });

  it("the extractor reports a below-floor declaration when it sees one", () => {
    // The negative control. Without it, a regex that silently stopped matching would turn this
    // whole file green — the rail would still be here, and would be guarding nothing.
    const probe = budgetsIn("{ testTimeout: 15000 } // a copied habit");
    expect(probe).toEqual([{ key: "testTimeout", value: 15000 }]);
    expect(probe[0]?.value).toBeLessThan(floors.testTimeout as number);
  });

  it("every declared budget is at or above the config's", () => {
    const offenders: string[] = [];
    for (const rel of testSources()) {
      for (const { key, value } of budgetsIn(readFileSync(join(ROOT, rel), "utf8"))) {
        const floor = floors[key] as number;
        if (value < floor) offenders.push(`${rel}: ${key} ${value} < ${floor}`);
      }
    }
    // The message carries the recipe, because the fix is not obvious from a failing number: the
    // answer is almost never a smaller budget in the config.
    expect(
      offenders,
      `These files ask for LESS room than ${CONFIG} grants every test file. Raise each to the ` +
        `config's own value, or delete the override and inherit it. Do not lower the config: its ` +
        `comment records the Windows fsync measurement that set it.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
