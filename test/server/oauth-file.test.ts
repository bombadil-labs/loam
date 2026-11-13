import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import * as esbuild from "esbuild";
import {
  EMPTY_OAUTH,
  LOCK_STALE_MS,
  MAX_CLIENT_NAME,
  OAuthFileBusy,
  OAuthFileUnlockable,
  OAuthFileUnreadable,
  clientNameDefect,
  idTextDefect,
  oauthLockPath,
  oauthPath,
  readOAuthFile,
  uriTextDefect,
  withOAuthFile,
  writeOAuthFile,
  type OAuthClient,
  type OAuthFile,
} from "../../src/server/oauth-file.js";

vi.setConfig({ testTimeout: 30000 });

const lockFsControl = vi.hoisted(() => ({
  failLinkWith: undefined as string | undefined,
  failFsyncOnce: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const linkSync: typeof actual.linkSync = (existing, next) => {
    if (lockFsControl.failLinkWith !== undefined) {
      const err = new Error("link not supported") as NodeJS.ErrnoException;
      err.code = lockFsControl.failLinkWith;
      throw err;
    }
    return actual.linkSync(existing, next);
  };
  const fsyncSync: typeof actual.fsyncSync = (fd) => {
    if (lockFsControl.failFsyncOnce) {
      lockFsControl.failFsyncOnce = false;
      throw new Error("simulated ENOSPC");
    }
    return actual.fsyncSync(fd);
  };
  const asRecord = actual as unknown as Record<string, unknown>;
  return {
    ...actual,
    linkSync,
    fsyncSync,
    default: { ...(asRecord["default"] as object), linkSync, fsyncSync },
  };
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-oauth-file-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const SEED = "11".repeat(32);
const SEED_AUTHOR = authorForSeed(SEED);

const soundFile = (): OAuthFile => ({
  version: 1,
  clients: [
    {
      clientId: "c1",
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
      registeredAt: 1,
      generation: 1,
    },
  ],
  grants: [{ clientId: "c1", actorSeed: SEED, actor: SEED_AUTHOR, grantedAt: 1, standing: true }],
  tokens: [{ digest: "22".repeat(32), clientId: "c1", issuedAt: 1 }],
});

describe("(a) an absent file is an empty one", () => {
  it("a home with no oauth.json is not damaged", () => {
    expect(readOAuthFile(home)).toEqual(EMPTY_OAUTH);
  });
});

describe("(b)+(c) a file this reader cannot read", () => {
  const corruptions: { label: string; bytes: string }[] = [
    { label: "truncated mid-object", bytes: '{"version":1,"clients":[{"clientId":"a' },
    { label: "empty", bytes: "" },
    { label: "not JSON at all", bytes: "this is not json" },
    { label: "a JSON array", bytes: "[]" },
    { label: "JSON null", bytes: "null" },
    { label: "the wrong version", bytes: '{"version":2,"clients":[],"grants":[],"tokens":[]}' },
    { label: "clients not an array", bytes: '{"version":1,"clients":{},"grants":[],"tokens":[]}' },
    {
      label: "a client with no id",
      bytes:
        '{"version":1,"clients":[{"clientName":"x","redirectUris":[],"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "a grant whose seed is not hex",
      bytes:
        '{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"zz","actor":"b","grantedAt":1,"standing":true}],"tokens":[]}',
    },
    {
      label: "a grant whose actor disagrees with its seed",
      bytes:
        `{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"${SEED}",` +
        `"actor":"not-the-author-of-that-seed","grantedAt":1,"standing":true}],"tokens":[]}`,
    },
    {
      label: "a grant that does not say whether it stands",
      bytes:
        `{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"${SEED}",` +
        `"actor":"${SEED_AUTHOR}","grantedAt":1}],"tokens":[]}`,
    },
    {
      label: "a client with no generation",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[],' +
        '"registeredAt":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "a client whose generation is zero",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[],' +
        '"registeredAt":1,"generation":0}],"grants":[],"tokens":[]}',
    },
    {
      label: "a client whose name carries a newline",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x\\n    client   forged",' +
        '"redirectUris":[],"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "a client whose redirect uri carries a tab",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":["https://x/\\tcb"],' +
        '"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "a client whose id carries a control character",
      bytes:
        '{"version":1,"clients":[{"clientId":"a\\u0007","clientName":"x","redirectUris":[],' +
        '"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "tokens not an array",
      bytes: '{"version":1,"clients":[],"grants":[],"tokens":{}}',
    },
    {
      label: "a token with no digest",
      bytes: '{"version":1,"clients":[],"grants":[],"tokens":[{"clientId":"a","issuedAt":1}]}',
    },
    {
      label: "a token whose digest is not 64 hex",
      bytes:
        '{"version":1,"clients":[],"grants":[],"tokens":[{"digest":"zz","clientId":"a","issuedAt":1}]}',
    },
    {
      label: "a token with no clientId",
      bytes: `{"version":1,"clients":[],"grants":[],"tokens":[{"digest":"${"33".repeat(32)}","issuedAt":1}]}`,
    },
    {
      label: "a token with no issuedAt",
      bytes: `{"version":1,"clients":[],"grants":[],"tokens":[{"digest":"${"33".repeat(32)}","clientId":"a"}]}`,
    },
    {
      label: "a client entry that is not an object",
      bytes: '{"version":1,"clients":["not-an-object"],"grants":[],"tokens":[]}',
    },
    {
      label: "a client with an empty-string redirect uri",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[""],' +
        '"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
    },
  ];

  it("refuses to parse, with a named error rather than an empty file", () => {
    for (const { label, bytes } of corruptions) {
      writeFileSync(oauthPath(home), bytes);
      let thrown: unknown;
      try {
        readOAuthFile(home);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${label} parsed`).toBeInstanceOf(OAuthFileUnreadable);
      expect(String((thrown as Error).message), `${label} said nothing`).toContain("oauth.json");
    }
  });

  it("a sound file with none of the above defects reads back whole", () => {
    writeOAuthFile(home, soundFile());
    expect(readOAuthFile(home)).toEqual(soundFile());
  });

  it("a hex field containing a literal '0' digit is accepted — not just [1-9a-f]", () => {
    const zeroSeed = "0".repeat(64);
    const zeroAuthor = authorForSeed(zeroSeed);
    const file: OAuthFile = {
      ...EMPTY_OAUTH,
      grants: [
        { clientId: "c1", actorSeed: zeroSeed, actor: zeroAuthor, grantedAt: 1, standing: true },
      ],
    };
    writeOAuthFile(home, file);
    expect(readOAuthFile(home)).toEqual(file);
  });

  it("a non-finite numeric field refuses even though it can only arrive via an in-memory caller", () => {
    const file: OAuthFile = {
      ...soundFile(),
      clients: [{ ...soundFile().clients[0]!, registeredAt: NaN }],
    };
    expect(() => writeOAuthFile(home, file)).toThrow(OAuthFileUnreadable);
  });
});

describe("the exported text-defect helpers, directly", () => {
  it("clientNameDefect refuses empty, refuses over MAX_CLIENT_NAME, accepts the boundary", () => {
    expect(clientNameDefect("")).toMatch(/1\.\.200/);
    expect(clientNameDefect("a".repeat(MAX_CLIENT_NAME))).toBeUndefined();
    expect(clientNameDefect("a".repeat(MAX_CLIENT_NAME + 1))).toMatch(/1\.\.200/);
  });

  it("clientNameDefect refuses a control character with its own message", () => {
    expect(clientNameDefect("ok\nnot ok")).toMatch(/control character/);
  });

  it("uriTextDefect and idTextDefect refuse control characters and accept clean text", () => {
    expect(uriTextDefect("https://claude.ai/cb")).toBeUndefined();
    expect(uriTextDefect("https://claude.ai/\tcb")).toMatch(/control character/);
    expect(idTextDefect("plain-id")).toBeUndefined();
    expect(idTextDefect("id\u0007")).toMatch(/control character/);
  });
});

describe("(d)+(d2)+(e) the write is atomic, 0600 from birth, and leaves no residue", () => {
  it("a SECOND write over a 0644 file still ends at 0600", () => {
    writeOAuthFile(home, soundFile());
    chmodSync(oauthPath(home), 0o644);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o644);
    }
    writeOAuthFile(home, soundFile());
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o600);
    }
  });

  it("a FIRST write on a fresh path lands at 0600 with no prior file to inherit a mode from", () => {
    expect(existsSync(oauthPath(home))).toBe(false);
    writeOAuthFile(home, soundFile());
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o600);
    }
  });

  it("the write REPLACES the file rather than truncating it, and leaves no temp", () => {
    writeOAuthFile(home, soundFile());
    const first = statSync(oauthPath(home));
    writeOAuthFile(home, soundFile());
    const second = statSync(oauthPath(home));
    if (process.platform !== "win32") {
      expect(second.ino).not.toBe(first.ino);
    }
    for (let i = 0; i < 4; i += 1) {
      writeOAuthFile(home, soundFile());
      expect(() => readOAuthFile(home)).not.toThrow();
    }
    const leftovers = readdirSync(home).filter(
      (f) => f.startsWith("oauth.json.") && f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });

  it("(f) does not assert the fsync — nothing observable from a test distinguishes a synced write from an unsynced one without a power cut", () => {
    writeOAuthFile(home, soundFile());
    expect(readOAuthFile(home)).toEqual(soundFile());
  });

  it("ends the body with a trailing newline", () => {
    writeOAuthFile(home, soundFile());
    expect(readFileSync(oauthPath(home), "utf8").endsWith("\n")).toBe(true);
  });
});

describe("the lock primitive", () => {
  it("(g)+(n) one rail takes the lock successfully and completes a write under it", () => {
    const result = withOAuthFile(home, (file) => ({
      next: { ...file, clients: [...file.clients, soundFile().clients[0]!] },
      result: "ok" as const,
    }));
    expect(result).toBe("ok");
    expect(readOAuthFile(home).clients).toHaveLength(1);
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });

  it("a held lock blocks a second writer rather than letting it overwrite", () => {
    writeOAuthFile(home, readOAuthFile(home));
    const before = readOAuthFile(home);
    writeFileSync(oauthLockPath(home), `${process.pid}\n`);
    try {
      expect(() =>
        withOAuthFile(home, (file) => ({
          next: { ...file, clients: [] },
          result: undefined,
        })),
      ).toThrow(OAuthFileBusy);
      expect(readOAuthFile(home)).toEqual(before);
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: undefined }))).not.toThrow();
  });

  it("(l) a lock whose mtime is past LOCK_STALE_MS is reclaimed (staleness simulated by back-dating; no rail kills a real process and waits out the 30s window)", () => {
    writeFileSync(oauthLockPath(home), "1\n");
    const past = Date.now() - LOCK_STALE_MS - 5_000;
    utimesSync(oauthLockPath(home), new Date(past), new Date(past));
    const seen = withOAuthFile(home, (file) => ({ result: file.clients.length }));
    expect(seen).toBe(0);
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });

  it("(l) the acquire loop is bounded: a live lock throws OAuthFileBusy rather than spinning forever", () => {
    writeFileSync(oauthLockPath(home), "someone-else\n");
    const start = Date.now();
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: undefined }))).toThrow(
      OAuthFileBusy,
    );
    expect(Date.now() - start).toBeLessThan(10_000);
    rmSync(oauthLockPath(home), { force: true });
  });

  it("the lock is released even when the work throws", () => {
    expect(() =>
      withOAuthFile(home, () => {
        throw new Error("the work failed");
      }),
    ).toThrow("the work failed");
    expect(existsSync(oauthLockPath(home))).toBe(false);
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: 0 }))).not.toThrow();
  });

  it("a writer that did NOT create the lock never enters the callback", () => {
    writeOAuthFile(home, readOAuthFile(home));
    writeFileSync(oauthLockPath(home), "someone-else\n");
    let entered = false;
    try {
      expect(() =>
        withOAuthFile<undefined>(home, (file) => {
          entered = true;
          return { next: file, result: undefined };
        }),
      ).toThrow(OAuthFileBusy);
      expect(entered).toBe(false);
      expect(readFileSync(oauthLockPath(home), "utf8")).toBe("someone-else\n");
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
  });

  it("(g)+(i) a writer whose lock is STOLEN refuses rather than writing over the thief", () => {
    writeOAuthFile(home, readOAuthFile(home));
    const before = readOAuthFile(home);
    expect(() =>
      withOAuthFile<undefined>(home, (file) => {
        writeFileSync(oauthLockPath(home), "someone-else\n");
        return {
          next: { ...file, clients: [soundFile().clients[0]!] },
          result: undefined,
        };
      }),
    ).toThrow(OAuthFileBusy);
    expect(readOAuthFile(home)).toEqual(before);
    expect(readFileSync(oauthLockPath(home), "utf8")).toBe("someone-else\n");
    rmSync(oauthLockPath(home), { force: true });
  });

  it("(m)+(o) TWO PROCESSES contending both land their write", async () => {
    const entry = fileURLToPath(new URL("./oauth-lock-child.mts", import.meta.url));
    const bundle = join(home, "lock-child.mjs");
    await esbuild.build({
      entryPoints: [entry],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    writeOAuthFile(home, readOAuthFile(home));

    const spawned = new Promise<void>((resolve, reject) => {
      const proc = spawn(process.execPath, [bundle, home, "child-one", "400"], {
        stdio: ["ignore", "ignore", "pipe"],
        cwd: process.cwd(),
      });
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`child exited ${String(code)}: ${stderr}`)),
      );
    });

    let held = false;
    await Promise.race([
      spawned.then(() => {
        throw new Error("the child finished before the parent ever saw its lock");
      }),
      (async () => {
        const from = Date.now();
        while (Date.now() - from < 20_000) {
          if (existsSync(oauthLockPath(home))) {
            held = true;
            return;
          }
          await new Promise((r) => setTimeout(r, 2));
        }
      })(),
    ]);
    expect(held).toBe(true);

    let sawChildAlready = false;
    withOAuthFile<undefined>(home, (file) => {
      sawChildAlready = file.clients.some((c) => c.clientId === "child-one");
      return {
        next: {
          next: undefined,
          ...file,
          clients: [
            ...file.clients,
            {
              clientId: "parent-one",
              clientName: "parent-one",
              redirectUris: ["https://claude.ai/parent"],
              registeredAt: Date.now(),
              generation: 1,
            },
          ],
        },
        result: undefined,
      };
    });
    await spawned;

    expect(sawChildAlready).toBe(true);
    const ids = readOAuthFile(home).clients.map((c) => c.clientId);
    expect(ids).toContain("child-one");
    expect(ids).toContain("parent-one");
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });
});

describe("a lock the filesystem cannot take at all", () => {
  afterEach(() => {
    lockFsControl.failLinkWith = undefined;
  });

  it("takes the lock normally when the toggle is OFF — the mock's pass-through, asserted", () => {
    withOAuthFile(home, (file) => ({
      next: { ...file, clients: [soundFile().clients[0]!] },
      result: undefined,
    }));
    expect(readOAuthFile(home).clients.map((c) => c.clientId)).toEqual(["c1"]);
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });

  it("(h) refuses with a DIAGNOSABLE error rather than a raw errno, for every unsupported-filesystem code", () => {
    for (const code of ["EPERM", "EXDEV", "ENOSYS", "EOPNOTSUPP"]) {
      lockFsControl.failLinkWith = code;
      let thrown: unknown;
      try {
        withOAuthFile(home, (file) => ({ next: file, result: undefined }));
      } catch (err) {
        thrown = err;
      }
      expect(thrown, code).toBeInstanceOf(OAuthFileUnlockable);
      const message = (thrown as Error).message;
      expect(message, code).toMatch(/hard link/);
      expect(message, code).toMatch(/FAT|exFAT|network/);
      expect(message, code).toContain(code);
    }
  });

  it("(h) EEXIST is still CONTENTION, not an unsupported filesystem — the positive control", () => {
    lockFsControl.failLinkWith = "EEXIST";
    let thrown: unknown;
    try {
      withOAuthFile(home, (file) => ({ next: file, result: undefined }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeInstanceOf(OAuthFileUnlockable);
    expect(thrown).toBeInstanceOf(OAuthFileBusy);
    expect((thrown as Error).message).toMatch(/held by another process/);
  });

  it("(p) a refusal that already opened the claim temp leaves no residue behind", () => {
    lockFsControl.failLinkWith = "EPERM";
    expect(() =>
      withOAuthFile(home, (file) => ({
        next: { ...file, clients: [{ ...soundFile().clients[0]!, clientId: "should-not-land" }] },
        result: undefined,
      })),
    ).toThrow(OAuthFileUnlockable);
    lockFsControl.failLinkWith = undefined;
    expect(readOAuthFile(home).clients).toEqual([]);
    expect(readdirSync(home).filter((f) => f.includes(".claim"))).toEqual([]);
    expect(readdirSync(home).filter((f) => f === "oauth.json.lock")).toEqual([]);
  });
});

describe("(q) writeOAuthFile validates before it serializes", () => {
  it("refuses a caller-built object that fails read-time validation, and writes nothing", () => {
    writeOAuthFile(home, soundFile());
    const before = readFileSync(oauthPath(home), "utf8");
    const badActor: OAuthFile = {
      ...soundFile(),
      grants: [
        {
          clientId: "c1",
          actorSeed: SEED,
          actor: "not-the-real-author",
          grantedAt: 1,
          standing: true,
        },
      ],
    };
    expect(() => writeOAuthFile(home, badActor)).toThrow(OAuthFileUnreadable);
    expect(readFileSync(oauthPath(home), "utf8")).toBe(before);
  });

  it("refuses a control character smuggled into a client name", () => {
    const badName: OAuthFile = {
      ...EMPTY_OAUTH,
      clients: [{ ...soundFile().clients[0]!, clientName: "forged\nrow" }],
    };
    expect(() => writeOAuthFile(home, badName)).toThrow(OAuthFileUnreadable);
    expect(existsSync(oauthPath(home))).toBe(false);
  });

  it("refuses a SPARSE array — a hole must not validate as though it were not there", () => {
    const sparse: OAuthClient[] = [];
    sparse[1] = soundFile().clients[0]!;
    expect(sparse.length).toBe(2);
    const file: OAuthFile = { ...EMPTY_OAUTH, clients: sparse };
    expect(() => writeOAuthFile(home, file)).toThrow(OAuthFileUnreadable);
    expect(existsSync(oauthPath(home))).toBe(false);
  });
});

describe("(r) a repeated key across a collection is refused, on read and on write", () => {
  const secondSeed = "44".repeat(32);
  const secondAuthor = authorForSeed(secondSeed);

  it("two clients sharing a clientId refuse, on both read and write", () => {
    const duplicated: OAuthFile = {
      ...EMPTY_OAUTH,
      clients: [
        { clientId: "dup", clientName: "one", redirectUris: [], registeredAt: 1, generation: 1 },
        { clientId: "dup", clientName: "two", redirectUris: [], registeredAt: 2, generation: 1 },
      ],
    };
    expect(() => writeOAuthFile(home, duplicated)).toThrow(OAuthFileUnreadable);
    writeFileSync(oauthPath(home), `${JSON.stringify(duplicated)}\n`);
    expect(() => readOAuthFile(home)).toThrow(OAuthFileUnreadable);
  });

  it("two grants sharing a clientId refuse — one grant per client", () => {
    const duplicated: OAuthFile = {
      ...EMPTY_OAUTH,
      grants: [
        { clientId: "dup", actorSeed: SEED, actor: SEED_AUTHOR, grantedAt: 1, standing: true },
        {
          clientId: "dup",
          actorSeed: secondSeed,
          actor: secondAuthor,
          grantedAt: 2,
          standing: true,
        },
      ],
    };
    expect(() => writeOAuthFile(home, duplicated)).toThrow(OAuthFileUnreadable);
    writeFileSync(oauthPath(home), `${JSON.stringify(duplicated)}\n`);
    expect(() => readOAuthFile(home)).toThrow(OAuthFileUnreadable);
  });

  it("two tokens sharing a digest refuse — a digest names one client", () => {
    const digest = "55".repeat(32);
    const duplicated: OAuthFile = {
      ...EMPTY_OAUTH,
      tokens: [
        { digest, clientId: "a", issuedAt: 1 },
        { digest, clientId: "b", issuedAt: 2 },
      ],
    };
    expect(() => writeOAuthFile(home, duplicated)).toThrow(OAuthFileUnreadable);
    writeFileSync(oauthPath(home), `${JSON.stringify(duplicated)}\n`);
    expect(() => readOAuthFile(home)).toThrow(OAuthFileUnreadable);
  });

  it("distinct keys in each collection are unaffected — the positive control", () => {
    writeOAuthFile(home, soundFile());
    expect(readOAuthFile(home)).toEqual(soundFile());
  });
});

describe("(s) a write that fails mid-flight leaks no temp", () => {
  afterEach(() => {
    lockFsControl.failFsyncOnce = false;
  });

  it("a write that throws during its own fsync leaves no temp behind", () => {
    lockFsControl.failFsyncOnce = true;
    expect(() => writeOAuthFile(home, soundFile())).toThrow("simulated ENOSPC");
    const leftovers = readdirSync(home).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
    expect(existsSync(oauthPath(home))).toBe(false);
  });
});
