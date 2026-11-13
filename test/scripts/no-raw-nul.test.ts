import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const BINARY_BY_DESIGN = ["test/fixtures/pre-t32/store.db"];

const nulCount = (path: string): number =>
  readFileSync(path).reduce((n, byte) => n + (byte === 0 ? 1 : 0), 0);

const candidateFiles = (): string[] =>
  execFileSync("git", ["-C", ROOT, "ls-files", "-zco", "--exclude-standard"], { encoding: "utf8" })
    .split(String.fromCharCode(0))
    .filter(Boolean)
    .filter((rel) => lstatSync(join(ROOT, rel), { throwIfNoEntry: false })?.isFile() === true);

describe("no source file smuggles a raw NUL byte", () => {
  it("every file git would carry is NUL-free, except the ones that are binary by design", () => {
    const files = candidateFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/gateway/container-identity.ts");
    expect(files).toContain("src/gateway/resolvers.ts");

    const offenders = files
      .filter((rel) => !BINARY_BY_DESIGN.includes(rel))
      .map((rel) => ({ rel, nuls: nulCount(join(ROOT, rel)) }))
      .filter(({ nuls }) => nuls > 0);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `these files hold raw 0x00 bytes, which makes them BINARY to git — their diffs ` +
            `read "Binary files differ" and review cannot see them:\n` +
            offenders.map(({ rel, nuls }) => `  ${rel} (${nuls})`).join("\n") +
            `\nWrite the byte as a "\\u0000" escape instead; it encodes identically. Then confirm ` +
            `with: perl -0777 -ne '$c=()=/\\x00/g; print "$c\\n"' <file>`,
    ).toEqual([]);
  });

  it("the binary-by-design list is live, not a stale hole", () => {
    for (const rel of BINARY_BY_DESIGN) {
      const path = join(ROOT, rel);
      expect(lstatSync(path, { throwIfNoEntry: false })?.isFile(), `${rel} is gone`).toBe(true);
      expect(nulCount(path), `${rel} is NUL-free — drop it from BINARY_BY_DESIGN`).toBeGreaterThan(
        0,
      );
    }
  });
});
