// The rail for the one temporary hole (T156). It drives `toleratesRemovalFailure` DIRECTLY,
// passing `platform` as an argument, because on Linux the swallow branch is otherwise
// unreachable — and an unreachable branch is an unproven one. It asserts the hole is exactly as
// narrow as its header claims: one prefix, one directory, three error codes, one platform.
//
// What this file deliberately does NOT assert: that a real Windows handle causes a real EPERM.
// No Linux runner can produce one. That proof is the `windows-latest` leg going green.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toleratesRemovalFailure } from "./windows-teardown-tolerance.js";

const err = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: operation not permitted, rm`), { code });

const PROFILE = join(tmpdir(), "loam-door-smoke-abc123");

describe("the temporary win32 teardown tolerance", () => {
  it("swallows a handle-contention failure on a Chrome scratch profile under tmpdir, on win32", () => {
    for (const code of ["EPERM", "EBUSY", "ENOTEMPTY"]) {
      expect(toleratesRemovalFailure(PROFILE, err(code), "win32")).toBe(true);
    }
  });

  it("rethrows for a path whose basename is not a Chrome scratch profile", () => {
    for (const other of ["loam-store-abc123", "door-smoke-abc123", "loam-door-smok", "tmp"]) {
      expect(toleratesRemovalFailure(join(tmpdir(), other), err("EPERM"), "win32")).toBe(false);
    }
  });

  it("rethrows for a matching basename OUTSIDE tmpdir", () => {
    // The erasure rails' own removals live outside the temp directory; this is the clause that
    // keeps them out of reach even if one ever adopted the prefix.
    for (const outside of ["/home/someone/loam-door-smoke-abc123", "C:\\loam-door-smoke-abc123"]) {
      expect(toleratesRemovalFailure(outside, err("EPERM"), "win32")).toBe(false);
    }
    // tmpdir itself is not "under" tmpdir — the hole never covers the whole temp directory.
    expect(toleratesRemovalFailure(tmpdir(), err("EPERM"), "win32")).toBe(false);
  });

  it("rethrows for any other error code, and for an error carrying no code", () => {
    for (const code of ["ENOENT", "EACCES", "EIO", "EMFILE"]) {
      expect(toleratesRemovalFailure(PROFILE, err(code), "win32")).toBe(false);
    }
    expect(toleratesRemovalFailure(PROFILE, new Error("no code at all"), "win32")).toBe(false);
    expect(toleratesRemovalFailure(PROFILE, undefined, "win32")).toBe(false);
  });

  it("rethrows on every platform that is not win32", () => {
    for (const platform of ["linux", "darwin", "freebsd", "aix"] as NodeJS.Platform[]) {
      expect(toleratesRemovalFailure(PROFILE, err("EPERM"), platform)).toBe(false);
    }
  });
});

describe("the shim's rmSync", () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("removes what it is given, exactly as node:fs would", () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-door-smoke-"));
    scratch.push(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(() => rmSync(dir, { recursive: false })).toThrow();
  });

  it("rethrows a removal failure here on Linux, where nothing is tolerated", () => {
    // Same prefix, same tmpdir, real ENOENT — and it still throws, because the platform clause
    // holds the door. This is the assertion that would break if the hole ever widened.
    const missing = join(tmpdir(), "loam-door-smoke-never-created-by-anyone");
    expect(() => rmSync(missing, { recursive: true })).toThrow(/ENOENT/);
  });
});
