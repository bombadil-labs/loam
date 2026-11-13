import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archivePath, storePath } from "../../src/cli/config.js";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 20_000 });

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

describe("the help text states the rule, per flag", () => {
  it("serve --help names home-relative resolution for --archive and --store", async () => {
    const lines: string[] = [];
    const io = { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) };
    expect(await run(["serve", "--help"], io)).toBe(0);
    const printed = lines.join("\n");
    expect(printed).toMatch(
      /--archive <dir>\s+mirror every delta into a cold store inside the home/,
    );
    expect(printed).toMatch(/an absolute path is used as-is/);
    expect(printed).toMatch(/--store <file>\s+the store file inside the home/);
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

    const vault = join(home, "vault");
    expect(existsSync(vault)).toBe(true);
    const cold = (readdirSync(vault, { recursive: true }) as string[]).filter((f) =>
      f.endsWith(".json"),
    );
    expect(cold.length).toBeGreaterThan(0);

    expect(readdirSync(scratch)).toEqual([]);

    expect(out.join("\n")).toContain(`archive ${vault}`);
  });

  it("--store <relative> lands the sqlite inside the home, and NOTHING in the CWD", async () => {
    const handle = await run(
      ["serve", "--http", "--port", "0", "--token", "t", "--home", home, "--store", "db.sqlite"],
      io(),
      { detach: true },
    );
    if (typeof handle === "number") throw new Error(`serve failed: ${err.join("\n")}`);
    await handle.close();

    expect(existsSync(join(home, "db.sqlite"))).toBe(true);
    expect(readdirSync(scratch)).toEqual([]);
  });
});
