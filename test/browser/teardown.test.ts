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

const openUp = (dir: string): void => {
  try {
    chmodSync(dir, 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) openUp(join(dir, entry.name));
    }
  } catch {}
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
    const dir = scratch();
    mkdirSync(join(dir, "held", "inner"), { recursive: true });
    chmodSync(join(dir, "held"), 0o500);

    expect(() => dropProfile(dir)).toThrow();
    expect(existsSync(dir)).toBe(true);
  });
});
