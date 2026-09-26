// Source signs with `stamp()`, never with `nextTimestamp()`. `nextTimestamp` is the ordering time
// alone and can run ahead of the wall clock; a claim that took it as `validFrom` would not be valid
// on the next read. `stamp()` gives each field its own time. Only the two files that define the
// split may name `nextTimestamp(`: gateway.ts declares it, and stamp.ts builds `stamp` on it.
// The scan is textual, so a comment that quotes the call counts as a use: name it without the
// parenthesis.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "..", "src");
const DEFINERS = new Set(["src/gateway/gateway.ts", "src/gateway/stamp.ts"]);

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );

const naming = sources(SRC)
  .filter((f) => readFileSync(f, "utf8").includes("nextTimestamp("))
  .map((f) => relative(join(SRC, ".."), f).split("\\").join("/"));

describe("source signs with stamp(), never nextTimestamp()", () => {
  it("no file under src/ but the two that define the split calls nextTimestamp", () => {
    expect(naming.filter((f) => !DEFINERS.has(f)).sort()).toEqual([]);
  });

  it("the scan reads real source: both defining files are found by it", () => {
    // A control, not a gate: a scan that walked the wrong directory would find nothing and pass.
    expect(naming.filter((f) => DEFINERS.has(f)).sort()).toEqual([...DEFINERS].sort());
  });
});
