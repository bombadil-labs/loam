// Repo hygiene, not runtime behavior (ticket T48): no tracked text file may hold a raw 0x00 byte.
//
// This is here because the failure mode is INVISIBLE at every surface a reviewer normally trusts.
// `.gitattributes` is `* text=auto`, so one NUL flips git's detection and the file's every future
// diff reads `Binary files differ` — an ABSENCE, not a warning. `grep` skips the file just as
// quietly. A keystone module already merged that way, and the byte arrives by accident: a tool in
// the authoring chain has twice now written the raw character where an escape sequence was typed.
// The escaped form compiles to the identical byte, so nothing is given up by requiring it.
//
// It lives beside `rails-guard-ci.test.ts` because that is where this repo keeps the rails that
// assert on the REPOSITORY rather than on Loam. `test/cli/pack.test.ts` was the other candidate and
// is the wrong home: it pins the published surface, and a NUL in a test or a script never ships
// while still destroying the reviewability of everything around it.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Binary BY DESIGN, listed one path at a time. Deliberately not an extension pattern: a new binary
// asset should cost somebody a line here, because that line is the moment they decide it is really
// binary rather than really broken.
const BINARY_BY_DESIGN = ["test/fixtures/pre-t32/store.db"];

const nulCount = (path: string): number =>
  readFileSync(path).reduce((n, byte) => n + (byte === 0 ? 1 : 0), 0);

// `-c -o --exclude-standard`: the index AND the un-ignored untracked files. Index alone would be
// blind at the one moment that matters — a tool has just written the raw byte into a new file, and
// nobody has staged it yet, so the local green bar would pass over exactly the hazard it exists to
// catch. Ignored paths (`dist/`, the village's homes, the per-worktree `.adlc/` evidence) are out,
// so a build artifact cannot fail this.
//
// Symlinks and gitlinks are listed but not readable as content — the repo tracks a `node_modules`
// symlink, and reading it raises EISDIR rather than reporting a clean file.
const candidateFiles = (): string[] =>
  execFileSync("git", ["-C", ROOT, "ls-files", "-zco", "--exclude-standard"], { encoding: "utf8" })
    .split(String.fromCharCode(0))
    .filter(Boolean)
    .filter((rel) => lstatSync(join(ROOT, rel), { throwIfNoEntry: false })?.isFile() === true);

describe("no source file smuggles a raw NUL byte", () => {
  it("every file git would carry is NUL-free, except the ones that are binary by design", () => {
    const files = candidateFiles();
    // A guard that scanned nothing would pass loudest of all — and a loose floor is not enough on
    // its own, because the `isFile` filter drops silently. Name the two sites this ticket is about,
    // so no future narrowing of the scan can leave them unwatched while the count stays plausible.
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
    // An allowlisted path that no longer holds a NUL is an exemption sitting open over a file that
    // does not need it — and it would silently absolve the next real offender written there.
    for (const rel of BINARY_BY_DESIGN) {
      const path = join(ROOT, rel);
      expect(lstatSync(path, { throwIfNoEntry: false })?.isFile(), `${rel} is gone`).toBe(true);
      expect(nulCount(path), `${rel} is NUL-free — drop it from BINARY_BY_DESIGN`).toBeGreaterThan(
        0,
      );
    }
  });
});
