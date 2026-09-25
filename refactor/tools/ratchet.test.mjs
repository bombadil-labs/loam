// Probes for the census ratchet: each form it claims to count must move its count. A form the
// ratchet misses is a coupling that can rise while `npm run check` stays green.

import { describe, expect, it } from "vitest";
import { couplingCountsOf } from "./lib.mjs";

const CORE = "src/gateway/probe.ts";
const count = (text, file = CORE) => couplingCountsOf(file, text);

describe("census ratchet counts", () => {
  it.each([
    ["property", "gw.options.seed;"],
    ["element", 'gw.options["seed"];'],
    ["bare receiver", "options.seed;"],
    ["destructured", "const { seed } = gw.options;"],
    ["destructured and renamed", "const { seed: s } = options;"],
  ])("counts a seed read: %s", (_, text) => {
    expect(count(text).seedReads).toBe(1);
  });

  it.each([
    ["call", "gw.reactor.snapshot();"],
    ["element call", 'gw.reactor["snapshot"]();'],
    ["reference", "const f = reactor.snapshot;"],
    ["other casing", "this.primaryReactor.snapshot();"],
  ])("counts a snapshot reference: %s", (_, text) => {
    expect(count(text).snapshotRefs).toBe(1);
  });

  it.each([
    ["Date.now()", "Date.now();"],
    ["globalThis", "globalThis.Date.now();"],
    ["element", 'Date["now"]();'],
    ["reference", "const clock = Date.now;"],
    ["performance", "performance.now();"],
    ["new Date()", "new Date();"],
    ["new globalThis.Date()", "new globalThis.Date();"],
    ["destructured", "const { now } = performance;"],
  ])("counts a core clock read: %s", (_, text) => {
    expect(count(text).coreClockReads).toBe(1);
  });

  it("counts a clock read in a core file under a Windows path", () => {
    expect(count("Date.now();", "src\\gateway\\probe.ts").coreClockReads).toBe(1);
  });

  it("does not count controls", () => {
    const text = [
      "new Date(0);",
      "other.seed;",
      "gw.options.seedHex;",
      "view.snapshot();",
      "// options.seed reactor.snapshot() Date.now()",
      'const s = "options.seed";',
    ].join("\n");
    expect(count(text)).toEqual({ seedReads: 0, snapshotRefs: 0, coreClockReads: 0 });
    expect(count("Date.now();", "src/server/probe.ts").coreClockReads).toBe(0);
  });
});
