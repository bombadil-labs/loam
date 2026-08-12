// Repo hygiene, not runtime behavior (ticket T159): no test file may set a FILE-LEVEL timeout
// below the one `vitest.config.mjs` chose for this platform.
//
// The config's 20s is not a round number somebody liked. Its own comment records the measurement:
// the suite drives real sqlite files, and an fsync plus WAL checkpoint on a loaded Windows runner
// legitimately costs seconds, so the 5s default was failing byte-level erasure rails that pass
// everywhere else. A file that then calls setConfig with a testTimeout of 15000 silently undoes
// that decision for every test it contains.
//
// WHY A RAIL AND NOT JUST THE 32 FIXES. The failure is invisible until it fires. A lowered budget
// changes no assertion, reads as ordinary boilerplate, and copies cleanly into the next file — and
// the files that carry it do not fail together, they take turns, because which one breaches depends
// on what else the runner was doing. That is a class, and a class needs a gate: without this file
// the next copied line reopens it and nobody learns until a Windows runner picks that file.
//
// It permits every budget ABOVE the default. A browser drive, an esbuild bundle and a real scrypt
// each need more room than 20s, and asking for more is a considered decision a reviewer can read.
// Asking for LESS, for a whole file at once, is the shape that has only ever been an accident.
//
// THE GAP, STATED. This governs the FILE-LEVEL forms only — `setConfig`'s `testTimeout` and
// `hookTimeout`. It deliberately does not reach a PER-TEST budget: `it(..., 14_000)` or
// `it(name, { timeout: 4000 }, ...)`. Two of those live in the tree today and both must stay short:
//
//   - test/server/login-delay.test.ts — `{ timeout: 4000 }` on the FIFO refusal. The short ceiling
//     IS the assertion. A regressed stat guard parks the single-threaded door forever, and the 4s
//     failure is what makes that visible instead of silent.
//   - test/gateway/render-sandbox.test.ts — `}, 14_000` on the memory-bound control, which runs a
//     deliberate 10s render clock inside it.
//
// That is the whole argument for the scope: a per-test budget is one line a reviewer reads beside
// the test it governs, and it is the RIGHT place to put a deliberately short clock. A file-level
// budget is invisible from the test it caps. No rail would close this gap without also breaking the
// two sites above; what would close it honestly is a lint rule that requires a comment on any
// per-test budget below the floor, and that is not worth its own machinery for two call sites.
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

// The DECISION, in its own function so a test can drive it with a source of its choosing. Inlining
// this in the sweep below would leave the comparison — the only line that can be wrong in a
// direction that matters — reachable by nothing but a repo that already violates it, i.e. never.
const offendersIn = (rel: string, source: string): string[] =>
  budgetsIn(source).flatMap(({ key, value }) => {
    const floor = floors[key] as number;
    return value < floor ? [`${rel}: ${key} ${value} < ${floor}`] : [];
  });

// This file is its OWN exception, and only this one: it quotes below-floor declarations on purpose,
// in the synthetic sources below and in the prose above. The exception is safe because the test
// below proves this file makes no setConfig call of its own — an exclusion that could hide a real
// override would be a hole, so it is asserted rather than assumed.
const SELF = "test/scripts/timeout-floor.test.ts";

// Tracked test sources only. A build artifact or an untracked scratch file is not something a
// reviewer owns, and `dist/` carries compiled copies of these same lines.
const testSources = (): string[] =>
  execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--", "test/"], { encoding: "utf8" })
    .split(String.fromCharCode(0))
    .filter((rel) => /\.(?:ts|mts|cts|mjs|js)$/.test(rel) && rel !== SELF);

describe("no test file lowers its file-level timeout below the repo's own default", () => {
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

  // The negative control, driving the SAME function the sweep calls. Without it the comparison is
  // reachable only by a repo that already violates the rule: invert it, zero the floor, or drop the
  // push entirely, and every other test here stays green while the rail guards nothing.
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
    // The message carries the recipe, because the fix is not obvious from a failing number: the
    // answer is almost never a smaller budget in the config.
    expect(
      offenders,
      `These files ask for LESS room than ${CONFIG} grants every test file. Raise each to the ` +
        `config's own value, or delete the override and inherit it. Do not lower the config: its ` +
        `comment records the Windows fsync measurement that set it. A deliberately short clock ` +
        `belongs on the ONE test that needs it, as a per-test budget.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
