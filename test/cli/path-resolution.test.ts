// T98's contract: `--store` and `--archive` resolve the way their help text says — a relative
// value names a place INSIDE THE HOME, an absolute value is used as-is, and the config path keeps
// its long-standing home-relative rule. Both levels are railed here: the resolvers themselves
// (unit), and a real `serve --archive` run from a foreign working directory (object), whose
// negative half — NOTHING minted in the CWD — is the assertion that failed before the fix: a
// relative `--archive` used to mint an erasure-bearing vault beside whoever ran it, silently,
// while the vault the help text promised was never opened.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archivePath, storePath } from "../../src/cli/config.js";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 15000 });

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-pathres-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("storePath and archivePath resolve overrides against the home", () => {
  it("a relative --store override lands inside the home", () => {
    expect(storePath(home, "vault.sqlite")).toBe(join(home, "vault.sqlite"));
  });

  it("an absolute --store override passes through unchanged", () => {
    const abs = join(home, "elsewhere", "s.sqlite");
    expect(isAbsolute(abs)).toBe(true);
    expect(storePath(home, abs)).toBe(abs);
  });

  it("a --store override never opens config.json (a home with none still resolves)", () => {
    // `home` has no config.json at all; only the no-override path may read it.
    expect(storePath(home, "s.sqlite")).toBe(join(home, "s.sqlite"));
  });

  it("the config store path is unchanged: home-relative, as it always was", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ operator: "x", store: "db.sqlite" }));
    expect(storePath(home)).toBe(join(home, "db.sqlite"));
  });

  it("a relative --archive override lands inside the home", () => {
    expect(archivePath(home, "vault")).toBe(join(home, "vault"));
  });

  it("an absolute --archive override passes through unchanged", () => {
    const abs = join(home, "cold", "vault");
    expect(archivePath(home, abs)).toBe(abs);
  });

  it("the config archive path is unchanged: home-relative, and absent means no archive", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ operator: "x", store: "s.sqlite", archive: "cold" }),
    );
    expect(archivePath(home)).toBe(join(home, "cold"));
    writeFileSync(join(home, "config.json"), JSON.stringify({ operator: "x", store: "s.sqlite" }));
    expect(archivePath(home)).toBeUndefined();
  });
});

describe("serve --archive <relative>, run from a foreign working directory", () => {
  const out: string[] = [];
  const err: string[] = [];
  const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

  let scratch: string;
  let cwdBefore: string;
  beforeEach(() => {
    out.length = 0;
    err.length = 0;
    scratch = mkdtempSync(join(tmpdir(), "loam-pathres-cwd-"));
    cwdBefore = process.cwd();
    process.chdir(scratch);
  });
  afterEach(() => {
    process.chdir(cwdBefore);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("mirrors into the home's vault and mints NOTHING in the CWD", async () => {
    const handle = await run(
      ["serve", "--http", "--port", "0", "--token", "t", "--home", home, "--archive", "vault"],
      io(),
      { detach: true },
    );
    if (typeof handle === "number") throw new Error(`serve failed: ${err.join("\n")}`);
    await handle.close();

    // The documented half: the vault is under the home, holding the genesis deltas.
    const vault = join(home, "vault");
    expect(existsSync(vault)).toBe(true);
    const cold = (readdirSync(vault, { recursive: true }) as string[]).filter((f) =>
      f.endsWith(".json"),
    );
    expect(cold.length).toBeGreaterThan(0);

    // The negative half — the one that fails on the pre-fix code: the old CWD-relative
    // resolution is redirected, not silently accepted. The scratch CWD stays empty.
    expect(readdirSync(scratch)).toEqual([]);

    // And serve's own announcement names the home's vault, so the operator reads the truth.
    expect(out.join("\n")).toContain(`archive ${vault}`);
  });
});
