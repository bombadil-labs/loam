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
const LONG_SALT = "ab".repeat(16);

let home: string;
const path = (): string => credentialsPath(home);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-credentials-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

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

describe("an entry records its own creation parameters", () => {
  it("pins against the literal TEST_SCRYPT, not against the entry's own answer", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    expect(entry.params).toEqual({ N: 1024, r: 8, p: 1, keylen: 32 });
    writeCredentials(home, { version: 1, users: { myk: entry } });
    const reread = entryFor(readCredentials(home), "myk");
    expect(reread?.params).toEqual({ N: 1024, r: 8, p: 1, keylen: 32 });
  });
});

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
      `{"version":1,"users":{"myk":{"kind":"scrypt","salt":"${LONG_SALT}","hash":"${"zz".repeat(64)}","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
    ],
    [
      "a non-hex salt",
      `{"version":1,"users":{"myk":{"kind":"scrypt","salt":"${"zz".repeat(8)}","hash":"cd34","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
    ],
    [
      "a hash length that disagrees with its own keylen",
      `{"version":1,"users":{"myk":{"kind":"scrypt","salt":"${LONG_SALT}","hash":"cd34","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
    ],
    [
      "an entry with no parameters",
      '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"ab12","hash":"cd34"}}}',
    ],
    ["an entry that is a string, not an object", '{"version":1,"users":{"myk":"just-a-string"}}'],
    [
      "an unknown credential kind",
      `{"version":1,"users":{"myk":{"kind":"telepathy","salt":"${LONG_SALT}","hash":"${"cd".repeat(64)}","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}`,
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

  it("a missing file reads as empty — an absent file is not damage", () => {
    expect(readCredentials(home)).toEqual({ version: 1, users: {} });
  });

  it("a read fault that is not ENOENT still refuses, rather than reading as empty", () => {
    mkdirSync(path());
    expect(() => readCredentials(home)).toThrow(CredentialsUnreadable);
  });

  it("checkEntry bounds scrypt parameters against a DoS-sized N, r or p", async () => {
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
    expect(() => checkEntry(withParams({ N: 2 ** 17, r: 1, p: 16, keylen: 32 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams(TEST_SCRYPT), "test")).not.toThrow();
  });

  it("checkEntry pins the CPU bound precisely: 8x the default cost is refused, not 9x", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    const withParams = (params: ScryptParams): unknown => ({ ...base, params });
    expect(() => checkEntry(withParams({ N: 8192, r: 9, p: 16, keylen: 32 }), "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  it("checkEntry admits the memory bound's own exact edge, and refuses one N-step past it", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    const withParams = (params: ScryptParams): unknown => ({ ...base, params });
    expect(() =>
      checkEntry(withParams({ N: 32768, r: 16, p: 1, keylen: 32 }), "test"),
    ).not.toThrow();
    expect(() => checkEntry(withParams({ N: 65536, r: 16, p: 1, keylen: 32 }), "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  it("checkEntry's N floor is exactly 2, and N must be an integer to count as a power of two", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    const withParams = (params: ScryptParams): unknown => ({ ...base, params });
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, N: 2 }), "test")).not.toThrow();
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, N: 1 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, N: 1024.5 }), "test")).toThrow(
      CredentialsUnreadable,
    );
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, N: 1000 }), "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  it("checkEntry refuses a non-integer r within its numeric range", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    const withParams = (params: ScryptParams): unknown => ({ ...base, params });
    expect(() => checkEntry(withParams({ ...TEST_SCRYPT, r: 2.5 }), "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  const fakeEntry = (params: ScryptParams): unknown => ({
    kind: "scrypt",
    salt: LONG_SALT,
    hash: "ab".repeat(Math.max(0, Math.floor(params.keylen))),
    params,
  });

  it("checkEntry's keylen floor sits exactly at 16 bytes", () => {
    expect(() => checkEntry(fakeEntry({ ...TEST_SCRYPT, keylen: 16 }), "test")).not.toThrow();
    expect(() => checkEntry(fakeEntry({ ...TEST_SCRYPT, keylen: 15 }), "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  it("checkEntry's salt-length floor sits exactly at 16 hex characters", async () => {
    const base = await hashPassword(PASSWORD, TEST_SCRYPT);
    expect(() => checkEntry({ ...base, salt: LONG_SALT.slice(0, 16) }, "test")).not.toThrow();
    expect(() => checkEntry({ ...base, salt: LONG_SALT.slice(0, 14) }, "test")).toThrow(
      CredentialsUnreadable,
    );
  });

  it("checkEntry refuses a raw entry that is a primitive, not an object", () => {
    expect(() => checkEntry("just-a-string", "test")).toThrow(CredentialsUnreadable);
  });

  it('checkEntry refuses a raw entry that is null — typeof null is "object"', () => {
    expect(() => checkEntry(null, "test")).toThrow(CredentialsUnreadable);
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
    const entryJson = JSON.stringify(entry);
    writeFileSync(path(), `{"version":1,"users":{"__proto__":${entryJson},"myk":${entryJson}}}`);
    const file = readCredentials(home);
    expect(Object.getPrototypeOf(file.users)).toBeNull();
    expect(entryFor(file, "__proto__")).toEqual(entry);
    expect(entryFor(file, "myk")).toEqual(entry);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("writing credentials.json", () => {
  it.skipIf(process.platform === "win32")(
    "lands at 0600 even when the path already sat at 0644",
    async () => {
      const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
      writeCredentials(home, { version: 1, users: { myk: entry } });
      expect(statSync(path()).mode & 0o777).toBe(0o600);
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
    expect(
      readdirSync(home).filter((n) => n.endsWith(".tmp") && n !== "credentials.json.tmp"),
    ).toEqual([]);
    expect(readdirSync(home)).toContain("credentials.json.tmp");
  });

  it("a failed rename leaves no temp file behind — a fault mid-write does not leak", async () => {
    const entry = await hashPassword(PASSWORD, TEST_SCRYPT);
    writeCredentials(home, { version: 1, users: { myk: entry } });
    rmSync(path(), { force: true });
    mkdirSync(path());
    expect(() => writeCredentials(home, { version: 1, users: { myk: entry } })).toThrow();
    expect(readdirSync(home).filter((n) => n.endsWith(".tmp"))).toEqual([]);
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
    expect(DEFAULT_SCRYPT.N & (DEFAULT_SCRYPT.N - 1)).toBe(0);
    expect(DEFAULT_SCRYPT.N).toBeGreaterThanOrEqual(16384);
    expect(DEFAULT_SCRYPT.keylen).toBeGreaterThanOrEqual(32);
    const entry = await hashPassword(PASSWORD);
    expect(entry.params).toEqual(DEFAULT_SCRYPT);
    expect(entry.hash.length).toBe(DEFAULT_SCRYPT.keylen * 2);
    expect(await verifyPassword(entry, PASSWORD)).toBe(true);
    expect(await verifyPassword(entry, `${PASSWORD} `)).toBe(false);
  });
});
