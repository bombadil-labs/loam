// T156 — the browser rail's teardown, railed on the ground a POSIX runner can reach.
//
// WHAT THIS ASSERTS: that `killTree` really stops the process it is handed, that `dropProfile`
// really removes the directory it is handed, and that a removal failure PROPAGATES off Windows.
// The third is the two-sided half: the win32 swallow exists so a held handle cannot redden a rail,
// and a swallow that leaked onto every platform would hide real defects instead.
//
// WHAT IT DELIBERATELY DOES NOT ASSERT, because no POSIX runner can: that a tree kill collects
// Chrome's renderer, GPU and crashpad children, and that the win32 branch swallows EPERM and only
// EPERM, EBUSY or ENOTEMPTY. Those two are proven by the windows-latest leg going green and
// staying green. The rail that would close the gap is a Windows-only test spawning a grandchild,
// and it can only run where the bug lives.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { dropProfile, killTree } from "./teardown.js";

const onWindows = process.platform === "win32";
const asRoot = process.getuid?.() === 0;

const opened: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "loam-teardown-rail-"));
  opened.push(dir);
  return dir;
};

// Every mode this file narrows is put back before the removal, top-down, so the cleanup can never
// be the thing that fails. Only ever this test's own mkdtemp directories.
const openUp = (dir: string): void => {
  try {
    chmodSync(dir, 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) openUp(join(dir, entry.name));
    }
  } catch {
    /* already gone */
  }
};

afterEach(() => {
  for (const dir of opened.splice(0)) {
    openUp(dir);
    dropProfile(dir);
  }
});

describe("T156 — Chrome teardown", () => {
  it("killTree stops the process it is handed", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await new Promise((resolve) => child.once("spawn", resolve));
    expect(child.exitCode).toBeNull();

    killTree(child);

    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 10_000).unref();
    });
    expect(child.exitCode === null && child.signalCode === null).toBe(false);
  });

  it("dropProfile removes a populated profile directory", () => {
    const dir = scratch();
    mkdirSync(join(dir, "Default", "Cache"), { recursive: true });
    writeFileSync(join(dir, "Default", "Preferences"), "{}");

    dropProfile(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it.skipIf(onWindows || asRoot)("a removal that cannot succeed still THROWS off Windows", () => {
    // Root ignores the mode bits, so the failure this needs cannot be manufactured there; the skip
    // is honest rather than a widened assertion.
    const dir = scratch();
    mkdirSync(join(dir, "held", "inner"), { recursive: true });
    chmodSync(join(dir, "held"), 0o500); // r-x: the inner directory cannot be unlinked

    expect(() => dropProfile(dir)).toThrow();
    expect(existsSync(dir)).toBe(true);
  });
});
