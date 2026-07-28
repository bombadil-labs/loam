// §36 phase 1 (T122): credentials.json as a pure library. No door and no CLI read this file yet, so
// every rail here calls src/server/credentials.ts directly — a login door's own rails arrive in a
// later phase.
//
// NAMED GAPS, both of them, because an honest-looking comment over a weaker test is how this class
// survives review (CLAUDE.md, SUBSTRATE-HAZARDS H10):
//   - The mode assertions run on POSIX only. Windows reports 0666 for an ordinary file whatever
//     `chmod` asked for, so a Windows run proves nothing about who may read a credential.
//   - `fsync` is asserted by nothing below. Both fsync calls in `writeCredentials` are deletable
//     with every rail here still green. An ESM named import of `node:fs` offers no spy point to
//     intercept the call, so the honest move is to say so rather than fake a check that cannot fail.

import { scryptSync } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialsUnreadable,
  DEFAULT_SCRYPT,
  checkEntry,
  credentialsPath,
  entryFor,
  hashPassword,
  readCredentials,
  verifyPassword,
  writeCredentials,
  type CredentialsFile,
  type ScryptParams,
} from "../../src/server/credentials.js";

const TEST_SCRYPT: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse battery staple";
// 32 hex chars = 16 bytes, at the shipped salt length, so a DAMAGE fixture that isn't testing the
// salt itself does not also trip the minimum-salt-length check by accident.
const LONG_SALT = "ab".repeat(16);

let home: string;
const path = (): string => credentialsPath(home);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-credentials-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Criterion 1: the salt reaches the derivation. A round trip through hashPassword/verifyPassword is
// green even if `derive` ignores its salt argument, because both halves would ignore it together —
// so the crossed-salt assertion is the one that actually pins this down.
describe("the salt reaches the derivation", () => {
  it("two hashes of the same password differ, and each verifies only against its own salt", async () => {
    const first = await hashPassword(PASSWORD, TEST_SCRYPT);
    const second = await hashPassword(PASSWORD, TEST_SCRYPT);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyPassword(first, PASSWORD)).toBe(true);
    expect(await verifyPassword(second, PASSWORD)).toBe(true);
    expect(await verifyPassword({ ...first, salt: second.salt }, PASSWORD)).toBe(false);
  });
});

// Criterion 2: the stored bytes equal an independent scryptSync call, computed here rather than by
// re-calling the function under test — an assertion against the pair under test would pass even if
// hashPassword and verifyPassword shared the same wrong derivation.
describe("the stored bytes are scrypt over the entry's own salt and params", () => {
  it("matches an independent scryptSync call", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    const expected = scryptSync(PASSWORD, Buffer.from(entry.salt, "hex"), TEST_SCRYPT.keylen, {
      N: TEST_SCRYPT.N,
      r: TEST_SCRYPT.r,
      p: TEST_SCRYPT.p,
    }).toString("hex");
    expect(entry.hash).toBe(expected);
  });
});

// Criterion 3: an entry records the parameters it was created with, pinned against a hand-written
// literal rather than read back from the entry itself.
describe("an entry records its own creation parameters", () => {
  it("pins against the literal TEST_SCRYPT, not against the entry's own answer", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    expect(entry.params).toEqual({ N: 1024, r: 8, p: 1, keylen: 32 });
    writeCredentials(home, { version: 1, users: { myk: entry } });
    const reread = entryFor(readCredentials(home), "myk");
    expect(reread?.params).toEqual({ N: 1024, r: 8, p: 1, keylen: 32 });
  });
});

// Criterion 4 + 9: every shape of damage refuses by throwing CredentialsUnreadable, never by
// resolving to a match. "Cannot determine" is a distinct outcome from "no such user" (criterion 9's
// ENOENT-as-empty case), which the last two entries below pin.
describe("every shape of damage refuses, by name", () => {
  const DAMAGE: readonly (readonly [string, string])[] = [
    ["truncated mid-object", '{"version":1,"users":{"myk":'],
    ["not JSON at all", "operator seed goes here, right?"],
    ["an empty file", ""],
    ["an unknown version", '{"version":99,"users":{}}'],
    [
      "an empty hash",
      `{"version":1,"users":{"myk":{"kind":"scrypt","salt":"${LONG_SALT}","hash":"","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
    ],
    [
      "an empty salt",
      '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"","hash":"ab12","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}',
    ],
    [
      "a non-hex hash",
      `{"version":1,"users":{"myk":{"kind":"scrypt","salt":"${LONG_SALT}","hash":"zz","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
    ],
    [
      "a non-hex salt",
      '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"not-hex!","hash":"cd34","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}',
    ],
    [
      "a hash length that disagrees with its own keylen",
      `{"version":1,"users":{"myk":{"kind":"scrypt","salt":"${LONG_SALT}","hash":"cd34","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
    ],
    [
      "an entry with no parameters",
      '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"ab12","hash":"cd34"}}}',
    ],
    [
      "an unknown credential kind",
      '{"version":1,"users":{"myk":{"kind":"telepathy","salt":"ab12","hash":"cd34"}}}',
    ],
  ];

  it.each(DAMAGE)(
    "%s throws CredentialsUnreadable rather than resolving to a match",
    (_label, contents) => {
      writeFileSync(path(), contents);
      expect(() => readCredentials(home)).toThrow(CredentialsUnreadable);
    },
  );

  it("a repaired file reads again — the refusal was the file's, not the door's", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    writeCredentials(home, { version: 1, users: { myk: entry } });
    const good = readFileSync(path(), "utf8");
    writeFileSync(path(), "{");
    expect(() => readCredentials(home)).toThrow(CredentialsUnreadable);
    writeFileSync(path(), good);
    expect(entryFor(readCredentials(home), "myk")).toEqual(entry);
  });

  it("a damaged neighbour fails the whole file — the file is the unit, not the entry", async () => {
    const myk = await hashPassword(PASSWORD, TEST_SCRYPT);
    writeCredentials(home, { version: 1, users: { myk } });
    const raw = JSON.parse(readFileSync(path(), "utf8")) as CredentialsFile;
    (raw.users as Record<string, unknown>)["wren"] = { kind: "scrypt", salt: "ab12", hash: "" };
    writeFileSync(path(), JSON.stringify(raw));
    expect(() => readCredentials(home)).toThrow(CredentialsUnreadable);
  });

  // Criterion 9's positive half: an absent file is a fresh home, not damage.
  it("a missing file reads as empty — an absent file is not damage", () => {
    expect(readCredentials(home)).toEqual({ version: 1, users: {} });
  });

  // Criterion 9's negative half, and the positive control for it: only ENOENT means "empty". A file
  // that exists but names a directory (a distinct, non-ENOENT read fault) still refuses, so the
  // empty-file path cannot be satisfied by any read failure whatsoever.
  it("a read fault that is not ENOENT still refuses, rather than reading as empty", () => {
    // credentials.json is itself a directory: readFileSync fails EISDIR, not ENOENT — a distinct,
    // real fault that the empty-file fallback must not swallow.
    mkdirSync(path());
    expect(() => readCredentials(home)).toThrow(CredentialsUnreadable);
  });

  it("checkEntry bounds scrypt parameters against a DoS-sized N, r or p", async () => {
    // A genuinely valid entry as the baseline, so only `params` varies — a fixed too-short salt or
    // hash here would let the wrong check fail and hide whether the bound itself works.
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    const withParams = (params: ScryptParams): unknown => ({ ...base, params });
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, N: 2 ** 24 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, r: 128 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, p: 128 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, keylen: 4 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    // A large `p` alone must not buy back the CPU time the memory bound denied it. N=131072, r=1
    // costs 16 MiB (well under the 64 MiB memory bound) but, at p=16, its CPU cost (N*r*p =
    // 2,097,152) is double the 1,048,576 ceiling — so the memory bound passing must not be read as
    // the CPU bound passing too.
    expect(() => checkEntry(withParams({ N: 2 ** 17, r: 1, p: 16, keylen: 32 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams(TEST_SCRYPT), "test")).not.toThrow();
  });

  it("checkEntry refuses a hash whose length disagrees with its own keylen", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    expect(() => checkEntry({ ...base, hash: `${base.hash}00` }, "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  it("checkEntry refuses a salt shorter than the 16-byte floor", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    expect(() => checkEntry({ ...base, salt: "ab12" }, "test")).toThrow(CredentialsUnreadable);
  });

  it("readCredentials builds `users` with no prototype: `__proto__` is an ordinary key", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    // Written as raw text, never through a JS object literal — `{ __proto__: entry }` as a literal
    // sets the prototype rather than an own property, which would silently drop the key before
    // JSON.stringify ever saw it and prove nothing.
    const entryJson = JSON.stringify(entry);
    writeFileSync(path(), `{"version":1,"users":{"__proto__":${entryJson},"myk":${entryJson}}}`);
    const file = readCredentials(home);
    expect(Object.getPrototypeOf(file.users)).toBeNull();
    expect(entryFor(file, "__proto__")).toEqual(entry);
    expect(entryFor(file, "myk")).toEqual(entry);
    // and the real Object.prototype is untouched
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("writing credentials.json", () => {
  // POSIX only: the whole subject is a mode transition, and Windows reports 0666 for an ordinary
  // file whatever chmod asked for.
  it.skipIf(process.platform === "win32")(
    "lands at 0600 even when the path already sat at 0644",
    async () => {
      const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
      writeCredentials(home, { version: 1, users: { myk: entry } });
      chmodSync(path(), 0o644);
      expect(statSync(path()).mode & 0o777).toBe(0o644);
      writeCredentials(home, { version: 1, users: { myk: entry, wren: entry } });
      expect(statSync(path()).mode & 0o777).toBe(0o600);
      expect(Object.keys(readCredentials(home).users).sort()).toEqual(["myk", "wren"]);
    },
  );

  it("writes through a rename, not in place: the inode changes", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    writeCredentials(home, { version: 1, users: { myk: entry } });
    const before = statSync(path()).ino;
    writeCredentials(home, readCredentials(home));
    expect(statSync(path()).ino).not.toBe(before);
  });

  it("leaves no residue behind, and a stale temp file does not poison the write", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    writeCredentials(home, { version: 1, users: { myk: entry } });
    writeFileSync(join(home, "credentials.json.tmp"), "garbage from a crashed write");
    const before = readCredentials(home);
    writeCredentials(home, { version: 1, users: { ...before.users, wren: before.users["myk"]! } });
    const after = readCredentials(home);
    expect(Object.keys(after.users).sort()).toEqual(["myk", "wren"]);
    // no temp of THIS writer's making is left behind; the stranger's own leftover is untouched
    expect(
      readdirSync(home).filter((n) => n.endsWith(".tmp") && n !== "credentials.json.tmp"),
    ).toEqual([]);
    expect(readdirSync(home)).toContain("credentials.json.tmp");
  });

  it("a completed write leaves parseable JSON with the same users", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    writeCredentials(home, { version: 1, users: { myk: entry } });
    for (let round = 0; round < 20; round += 1) {
      writeCredentials(home, readCredentials(home));
      const seen = readFileSync(path(), "utf8");
      expect(seen.length).toBeGreaterThan(0);
      expect(() => JSON.parse(seen) as unknown).not.toThrow();
    }
    expect(Object.keys(readCredentials(home).users)).toEqual(["myk"]);
  });
});

describe("the shipped scrypt parameters", () => {
  it("hash and verify each other, and reject a wrong password", async () => {
    expect(DEFAULT_SCRYPT.N & (DEFAULT_SCRYPT.N - 1)).toBe(0); // a power of two, as scrypt demands
    expect(DEFAULT_SCRYPT.N).toBeGreaterThanOrEqual(16384);
    expect(DEFAULT_SCRYPT.keylen).toBeGreaterThanOrEqual(32);
    const entry = await hashPassword(PASSWORD);
    expect(entry.params).toEqual(DEFAULT_SCRYPT);
    expect(entry.hash.length).toBe(DEFAULT_SCRYPT.keylen * 2);
    expect(await verifyPassword(entry, PASSWORD)).toBe(true);
    expect(await verifyPassword(entry, `${PASSWORD} `)).toBe(false);
  });
});
