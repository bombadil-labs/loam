import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { ArchiveBackend } from "../../src/store/archive.js";

const SEED = "0e".repeat(32);
const AUTHOR = authorForSeed(SEED);

const MARKER = "SUBJECT-ERASURE-CANARY-9f3a7c";
const SURVIVOR = "BYSTANDER-CANARY-4b1e02";
const canary = (mark: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      validFrom: timestamp,
      author: AUTHOR,
      pointers: [
        {
          role: "observed",
          target: { kind: "entity", entity: { id: "plant:fern", context: "secret" } },
        },
        { role: "value", target: { kind: "primitive", value: mark } },
      ],
    },
    SEED,
  );

const scratch = (): string => mkdtempSync(join(tmpdir(), "loam-erasure-"));

const anyFileContains = (root: string, needle: string): string | undefined => {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (readFileSync(full).includes(Buffer.from(needle))) return full;
    }
  }
  return undefined;
};

describe("§11 at rest — sqlite", () => {
  it("a purged delta leaves no plaintext in the database file", async () => {
    const dir = scratch();
    const file = join(dir, "store.db");
    const store = new SqliteBackend(file);

    const target = canary(MARKER, 1000);
    const keep: Delta[] = [];
    for (let i = 0; i < 50; i += 1) keep.push(canary(SURVIVOR, 2000 + i));
    await store.append([target, ...keep]);

    expect(anyFileContains(dir, MARKER)).toBeDefined();

    expect(await store.purge([target.id])).toBe(1);

    expect(anyFileContains(dir, MARKER)).toBeUndefined();
    expect(anyFileContains(dir, SURVIVOR)).toBeDefined();

    await store.close();
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
  });

  it("a RETRY whose DELETE finds nothing still truncates the WAL (ticket T67)", async () => {
    const dir = scratch();
    const file = join(dir, "store.db");
    const store = new SqliteBackend(file);
    const target = canary(MARKER, 1000);
    await store.append([target]);

    const db = (store as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const realPragma = db.pragma.bind(db);
    db.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : realPragma(sql, opts);
    await expect(store.purge([target.id])).rejects.toThrow(/write-ahead log|INCOMPLETE/i);
    expect(anyFileContains(dir, MARKER)).toBeDefined();

    db.pragma = realPragma;
    expect(await store.purge([target.id])).toBe(0);
    expect(anyFileContains(dir, MARKER)).toBeUndefined();

    await store.close();
  });

  it("the truncation debt SURVIVES A CRASH: a reopened handle still knows, and still refuses to lie (ticket T67)", async () => {
    const dir = scratch();
    const file = join(dir, "store.db");
    const first = new SqliteBackend(file);
    const target = canary(MARKER, 1000);
    await first.append([target]);

    const db1 = (first as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const real1 = db1.pragma.bind(db1);
    db1.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : real1(sql, opts);
    await expect(first.purge([target.id])).rejects.toThrow(/INCOMPLETE/);

    const reopened = new SqliteBackend(file);
    expect(await reopened.holds(target.id)).toBe(true);
    expect(await reopened.purge([target.id])).toBe(0);
    expect(await reopened.holds(target.id)).toBe(false);
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
    await reopened.close();
  });

  it("a latched debt belongs to ITS ids: an unrelated purge under the same busy WAL is untouched", async () => {
    const dir = scratch();
    const store = new SqliteBackend(join(dir, "store.db"));
    const owed = canary(MARKER, 1000);
    await store.append([owed]);
    const db = (store as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const realPragma = db.pragma.bind(db);
    db.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : realPragma(sql, opts);
    await expect(store.purge([owed.id])).rejects.toThrow(/INCOMPLETE/);

    await expect(store.purge([canary(SURVIVOR, 2000).id])).resolves.toBe(0);
    expect(await store.holds(owed.id)).toBe(true);
    expect(await store.holds(canary(SURVIVOR, 2000).id)).toBe(false);

    db.pragma = realPragma;
    await store.close();
  });

  it("a GRACEFUL close settles the debt it discharges: no phantom on reopen", async () => {
    const dir = scratch();
    const file = join(dir, "store.db");
    const first = new SqliteBackend(file);
    const target = canary(MARKER, 1000);
    await first.append([target]);
    const db1 = (first as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const real1 = db1.pragma.bind(db1);
    db1.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : real1(sql, opts);
    await expect(first.purge([target.id])).rejects.toThrow(/INCOMPLETE/);
    db1.pragma = real1;
    await first.close();

    const reopened = new SqliteBackend(file);
    expect(await reopened.holds(target.id)).toBe(false);
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
    await reopened.close();
  });

  it("an UNREADABLE debt row owes for everyone, and a landed checkpoint negates it", async () => {
    const dir = scratch();
    const file = join(dir, "store.db");
    const setup = new SqliteBackend(file);
    await setup.append([canary(SURVIVOR, 1000)]);
    await setup.close();
    const raw = new Database(file);
    raw
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('truncation-outstanding', ?)")
      .run("{corrupt");
    raw.close();

    const reopened = new SqliteBackend(file);
    expect(await reopened.holds(canary(MARKER, 9999).id)).toBe(true);
    await reopened.purge([canary(MARKER, 9999).id]);
    expect(await reopened.holds(canary(MARKER, 9999).id)).toBe(false);
    await reopened.close();

    const raw2 = new Database(file);
    raw2
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('truncation-outstanding', ?)")
      .run("5");
    raw2.close();
    const again = new SqliteBackend(file);
    expect(await again.holds(canary(MARKER, 9999).id)).toBe(true);
    await again.purge([canary(MARKER, 9999).id]);
    expect(await again.holds(canary(MARKER, 9999).id)).toBe(false);
    await again.close();
  });

  it("a purge that matched NOTHING does not fail on a busy checkpoint (ticket T67)", async () => {
    const dir = scratch();
    const store = new SqliteBackend(join(dir, "store.db"));
    await store.append([canary(SURVIVOR, 1000)]);

    const db = (store as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const realPragma = db.pragma.bind(db);
    db.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : realPragma(sql, opts);

    await expect(store.purge([canary(MARKER, 9999).id])).resolves.toBe(0);

    db.pragma = realPragma;
    await store.close();
  });

  it("purging EVERY delta leaves no plaintext anywhere in the database directory", async () => {
    const dir = scratch();
    const file = join(dir, "store.db");
    const store = new SqliteBackend(file);

    const all: Delta[] = [];
    for (let i = 0; i < 40; i += 1) all.push(canary(MARKER, 1000 + i));
    await store.append(all);
    expect(anyFileContains(dir, MARKER)).toBeDefined();

    expect(await store.purge(all.map((d) => d.id))).toBe(all.length);
    await store.close();

    expect(anyFileContains(dir, MARKER)).toBeUndefined();
  });
});

describe("§11 at rest — archive", () => {
  it("a purge collects a crashed append's .tmp straggler", async () => {
    const dir = scratch();
    const store = new ArchiveBackend(dir);

    const d = canary(MARKER, 1000);
    await store.append([d]);

    const fans = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isDirectory());
    expect(fans.length).toBeGreaterThan(0);
    const fan = (fans[0] as { name: string }).name;
    const straggler = join(dir, fan, `${d.id}.json.99999.tmp`);
    writeFileSync(straggler, `${JSON.stringify({ id: d.id, claims: d.claims, sig: MARKER })}\n`);

    expect(await store.purge([d.id])).toBe(1);
    await store.close();

    expect(anyFileContains(dir, MARKER)).toBeUndefined();
  });
});

describe("§11 through heal — the cold tier", () => {
  it("heal purges a straggler the mirror's reads cannot see", async () => {
    const dir = scratch();
    const vault = join(dir, "vault");
    const primary = new MemoryBackend();
    const mirror = new ArchiveBackend(vault);
    const pair = new MirrorBackend(primary, mirror);

    const target = canary(MARKER, 1000);
    const bystander = canary(SURVIVOR, 2000);
    await pair.append([target, bystander]);
    await pair.heal();

    const fan = readdirSync(vault, { withFileTypes: true }).filter((f) => f.isDirectory())[0]!.name;
    const targetJson = readdirSync(join(vault, fan)).find((n) => n.startsWith(target.id))!;
    const bytes = readFileSync(join(vault, fan, targetJson));
    writeFileSync(join(vault, fan, `${target.id}.json.31337.tmp`), bytes);
    rmSync(join(vault, fan, targetJson));

    expect(anyFileContains(vault, MARKER)).toBeDefined();
    expect((await mirror.deltasSince(new Set())).some((d) => d.id === target.id)).toBe(false);

    await pair.heal(new Set([target.id]));

    expect(anyFileContains(vault, MARKER)).toBeUndefined();
    expect(anyFileContains(vault, SURVIVOR)).toBeDefined();
    await pair.close();
  });

  it("heal reports what it forgot, not just what it copied", async () => {
    const dir = scratch();
    const vault = join(dir, "vault");
    const pair = new MirrorBackend(new MemoryBackend(), new ArchiveBackend(vault));
    const target = canary(MARKER, 1000);
    await pair.append([target]);
    await pair.heal();

    const report = await pair.heal(new Set([target.id]));
    expect(report.purgedPrimary).toBeGreaterThanOrEqual(0);
    expect(report.purgedMirror).toBeGreaterThanOrEqual(1);
    await pair.close();
  });
});

describe("§11 at rest — inherited freelist (ticket T71)", () => {
  it("opening a store that erased before secure_delete shipped scrubs the legible freelist", () => {
    const dir = scratch();
    const file = join(dir, "store.db");

    const legacy = new Database(file);
    legacy.pragma("secure_delete = OFF");
    legacy.exec(
      "CREATE TABLE IF NOT EXISTS deltas (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, claims TEXT NOT NULL, sig TEXT)",
    );
    const ins = legacy.prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)");
    ins.run("deleted", MARKER.repeat(8000), null);
    ins.run("kept", SURVIVOR.repeat(8000), null);
    legacy.prepare("DELETE FROM deltas WHERE id = ?").run("deleted");
    const freed = legacy.pragma("freelist_count", { simple: true }) as number;
    legacy.close();

    expect(freed).toBeGreaterThan(0);
    expect(anyFileContains(dir, MARKER)).toBeDefined();

    const scrubbed = new SqliteBackend(file);

    const owed = (
      scrubbed as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }
    ).db.pragma("freelist_count", { simple: true });
    expect(owed).toBe(0);

    return scrubbed.close().then(() => {
      expect(anyFileContains(dir, MARKER)).toBeUndefined();
      expect(anyFileContains(dir, SURVIVOR)).toBeDefined();
    });
  });
});
