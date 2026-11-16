import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed, claimsToJson, makeDelta, type Delta } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";

const AUTHOR = authorForSeed("3c".repeat(32));
const ROWS = 6000;
const KEPT = 0.45;

const share = (i: number): number => ((Math.imul(i + 17, 2654435761) >>> 0) % 1000) / 1000;
const isBystander = (i: number): boolean => share(i) < KEPT && i % 2 === 0;
const isTarget = (i: number): boolean => share(i) < KEPT && i % 2 === 1;

const rows = (): Delta[] => {
  let s = 12345;
  const rand = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: ROWS }, (_, i) =>
    makeDelta({
      timestamp: 1000 + i,
      validFrom: 1000 + i,
      author: AUTHOR,
      pointers: [
        {
          role: "value",
          target: {
            kind: "primitive",
            value: `ROW-${i}-${"x".repeat(40 + Math.floor(rand() * 260))}`,
          },
        },
      ],
    }),
  );
};

const legible = (dir: string, pattern: RegExp): Set<string> => {
  const found = new Set<string>();
  for (const name of readdirSync(dir)) {
    for (const m of readFileSync(join(dir, name)).toString("latin1").matchAll(pattern)) {
      found.add(m[1] as string);
    }
  }
  return found;
};

const residue = (dir: string, survives: (i: number) => boolean): number[] =>
  [...legible(dir, /ROW-(\d+)-/g)].map(Number).filter((i) => !survives(i));

const bytesOf = (d: Delta): string => JSON.stringify([d.id, claimsToJson(d.claims), d.sig ?? null]);

type Handle = {
  pragma: (s: string, o?: unknown) => unknown;
  exec: (s: string) => unknown;
};
const handleOf = (store: SqliteBackend): Handle => (store as unknown as { db: Handle }).db;
const impatient = (store: SqliteBackend): void => {
  handleOf(store).pragma("busy_timeout = 50");
};

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

async function churned(): Promise<{
  dir: string;
  file: string;
  store: SqliteBackend;
  targets: string[];
  bystanders: Delta[];
}> {
  const dir = mkdtempSync(join(tmpdir(), "loam-rebuild-"));
  const file = join(dir, "store.db");
  const store = new SqliteBackend(file);
  const all = rows();
  await store.append(all);
  await store.purge(all.filter((_, i) => share(i) >= KEPT).map((d) => d.id));
  return {
    dir,
    file,
    store,
    targets: all.filter((_, i) => isTarget(i)).map((d) => d.id),
    bystanders: all.filter((_, i) => isBystander(i)),
  };
}

async function expectOnlyBystanders(
  dir: string,
  store: SqliteBackend,
  bystanders: readonly Delta[],
): Promise<void> {
  expect(residue(dir, isBystander)).toEqual([]);
  expect((await store.deltasSince(new Set())).map(bytesOf)).toEqual(bystanders.map(bytesOf));
  expect(await store.ids()).toEqual(new Set(bystanders.map((d) => d.id)));
}

describe("§11 at rest — a purge rebuilds the pages before it reports", () => {
  it("R1: after churn that rebalances the pages, no purged row is legible in any file and every bystander reads back byte for byte", async () => {
    const { dir, store, targets, bystanders } = await churned();
    expect(residue(dir, (i) => !isTarget(i)).length).toBeGreaterThan(0);

    expect(await store.purge(targets)).toBe(targets.length);

    await expectOnlyBystanders(dir, store, bystanders);
    await store.close();
    expect(residue(dir, isBystander)).toEqual([]);
  }, 30_000);

  it("R2: a rebuild that commits while a reader holds the log reports INCOMPLETE, the debt outlives a close and a reopen, and a retry clears it", async () => {
    const { dir, file, store, targets, bystanders } = await churned();
    const reader = new Database(file);
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) FROM deltas").get();
    impatient(store);

    const refused = await failureOf(store.purge(targets));
    expect(refused.message).toMatch(/INCOMPLETE/);
    expect(await store.holds(targets[0] as string)).toBe(true);
    await store.close();

    const reopened = new SqliteBackend(file);
    impatient(reopened);
    expect(await reopened.holds(targets[0] as string)).toBe(true);
    expect((await reopened.ids()).has(targets[0] as string)).toBe(true);

    reader.exec("ROLLBACK");
    reader.close();
    expect(await reopened.purge(targets)).toBe(0);
    expect(await reopened.holds(targets[0] as string)).toBe(false);
    await expectOnlyBystanders(dir, reopened, bystanders);
    await reopened.close();
    expect(refused.message).toMatch(/pages were rebuilt, but the write-ahead log/);
  }, 30_000);

  it("R2b: a refused rebuild (VACUUM) reports INCOMPLETE, the debt outlives a close and a reopen, and a retry clears it", async () => {
    const { dir, file, store, targets, bystanders } = await churned();
    const db = handleOf(store);
    const real = db.exec.bind(db);
    db.exec = (sql: string) => {
      if (sql === "VACUUM") throw new Error("database or disk is full");
      return real(sql);
    };

    const refused = await failureOf(store.purge(targets));
    expect(refused.message).toMatch(
      /page rebuild \(VACUUM\) was refused: database or disk is full/,
    );
    expect(refused.message).toMatch(/INCOMPLETE/);
    expect(await store.holds(targets[0] as string)).toBe(true);
    await store.close();

    const reopened = new SqliteBackend(file);
    expect(await reopened.holds(targets[0] as string)).toBe(true);
    expect(await reopened.purge(targets)).toBe(0);
    expect(await reopened.holds(targets[0] as string)).toBe(false);
    await expectOnlyBystanders(dir, reopened, bystanders);
    await reopened.close();
  }, 30_000);

  it("R3: a store that erased before the rebuild existed is clean after one open, and its bystanders read back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-rebuild-legacy-"));
    const file = join(dir, "store.db");
    const all = rows();
    const raw = new Database(file);
    raw.pragma("journal_mode = WAL");
    raw.pragma("secure_delete = ON");
    raw.exec(
      "CREATE TABLE deltas (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, claims TEXT NOT NULL, sig TEXT)",
    );
    const insert = raw.prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)");
    const remove = raw.prepare("DELETE FROM deltas WHERE id = ?");
    const write = (d: Delta): unknown =>
      insert.run(d.id, JSON.stringify(claimsToJson(d.claims)), d.sig ?? null);
    raw.transaction(() => all.forEach(write))();
    raw.transaction(() =>
      all.filter((_, i) => share(i) >= KEPT).forEach((d) => remove.run(d.id)),
    )();
    raw.transaction(() => all.filter((_, i) => isTarget(i)).forEach((d) => remove.run(d.id)))();
    const filler: Delta[] = [];
    for (let k = 0; (raw.pragma("freelist_count", { simple: true }) as number) > 0; k += 1) {
      const d = makeDelta({
        timestamp: 900_000 + k,
        validFrom: 900_000 + k,
        author: AUTHOR,
        pointers: [
          { role: "value", target: { kind: "primitive", value: `FILL-${k}-${"f".repeat(200)}` } },
        ],
      });
      write(d);
      filler.push(d);
    }
    raw.pragma("wal_checkpoint(TRUNCATE)");
    raw.close();
    expect(residue(dir, (i) => !isTarget(i)).length).toBeGreaterThan(0);

    const store = new SqliteBackend(file);
    expect(store.scrubDeferred).toBeUndefined();
    await expectOnlyBystanders(dir, store, [...all.filter((_, i) => isBystander(i)), ...filler]);
    await store.close();
    expect(residue(dir, isBystander)).toEqual([]);

    const check = new Database(file);
    expect(check.prepare("SELECT value FROM meta WHERE key = 'pages-rebuilt'").get()).toEqual({
      value: "1",
    });
    check.close();
  }, 30_000);

  it("R3b: a new store is born with the rebuild marker, so its first open rebuilds nothing", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "loam-rebuild-new-")), "store.db");
    await new SqliteBackend(file).close();
    const check = new Database(file);
    expect(check.prepare("SELECT value FROM meta WHERE key = 'pages-rebuilt'").get()).toEqual({
      value: "1",
    });
    check.close();
  });
});

describe("§11 at rest — the journal tables rebuild their pages too", () => {
  it("R4: a rebase that deletes one peer's frames among other peers leaves none of them legible, and the kept peer's frames read back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-rebuild-journal-"));
    const backend = new SqliteBackend(join(dir, "store.db"));
    const store = backend.journalStore();
    const heads: Record<string, string> = { A: "", B: "", C: "" };
    const kept: Uint8Array[] = [];
    for (const peer of ["A", "B", "C"]) await store.compareAndAppend(peer, null, "", null, []);
    let s = 12345;
    const rand = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < ROWS; k += 1) {
      const r = rand();
      const peer = r < 0.55 ? "A" : r < 0.8 ? "B" : "C";
      const frame = Buffer.from(`FRAME-${peer}${k}-${"y".repeat(40 + Math.floor(rand() * 260))}`);
      if (peer === "C") kept.push(new Uint8Array(frame));
      await store.compareAndAppend(peer, heads[peer] as string, `${peer}${k}`, frame, []);
      heads[peer] = `${peer}${k}`;
    }

    expect(
      (await store.compareAndRebase!("A", heads.A as string, "A-rebased", Buffer.from("IMAGE-A")))
        .status,
    ).toBe("durable");
    expect(
      (await store.compareAndRebase!("B", heads.B as string, "B-rebased", Buffer.from("IMAGE-B")))
        .status,
    ).toBe("durable");

    const left = [...legible(dir, /FRAME-([ABC]\d+)-/g)].filter((f) => !f.startsWith("C"));
    expect(left).toEqual([]);
    expect(await store.readJournal("B")).toEqual({
      status: "journal",
      head: "B-rebased",
      frames: [],
      checkpoint: new Uint8Array(Buffer.from("IMAGE-B")),
    });
    expect(await store.readJournal("C")).toEqual({
      status: "journal",
      head: heads.C,
      frames: kept,
    });
    await backend.close();
  }, 30_000);

  it("R4b: a journal discard whose rebuild is refused says so, and a second discard completes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-rebuild-discard-"));
    const backend = new SqliteBackend(join(dir, "store.db"));
    const bystander = makeDelta({
      timestamp: 1,
      validFrom: 1,
      author: AUTHOR,
      pointers: [{ role: "value", target: { kind: "primitive", value: "ROW-0-kept" } }],
    });
    await backend.append([bystander]);
    const store = backend.journalStore();
    await store.compareAndAppend("A", null, "", null, []);
    let head = "";
    for (let k = 0; k < 200; k += 1) {
      await store.compareAndAppend(
        "A",
        head,
        `A${k}`,
        Buffer.from(`FRAME-A${k}-${"y".repeat(200)}`),
        [],
      );
      head = `A${k}`;
    }
    const db = handleOf(backend);
    const real = db.exec.bind(db);
    db.exec = (sql: string) => {
      if (sql === "VACUUM") throw new Error("database is locked");
      return real(sql);
    };

    const refused = await failureOf(backend.discardJournals());
    expect(refused.message).toMatch(/page rebuild \(VACUUM\) was refused: database is locked/);

    db.exec = real;
    await backend.discardJournals();
    expect([...legible(dir, /FRAME-(A\d+)-/g)]).toEqual([]);
    expect(await backend.journalPeers()).toEqual([]);
    expect((await backend.deltasSince(new Set())).map(bytesOf)).toEqual([bytesOf(bystander)]);
    await backend.close();
  });
});

describe("§11 at rest — a quarantine discard rebuilds its pages", () => {
  it("R5: a discard whose rebuild is refused reports INCOMPLETE and still owes the row, and a retry leaves no byte of it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-rebuild-pen-"));
    const file = join(dir, "store.db");
    const all = rows().slice(0, 40);
    const store = new SqliteBackend(file);
    await store.append(all);
    const broken = all[1] as Delta;
    const raw = new Database(file);
    raw.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(`{ROW-1-broken`, broken.id);
    raw.close();
    await store.deltasSince(new Set());
    expect((await store.quarantine()).map((r) => r.key)).toEqual([broken.id]);

    const db = handleOf(store);
    const real = db.exec.bind(db);
    db.exec = (sql: string) => {
      if (sql === "VACUUM") throw new Error("database or disk is full");
      return real(sql);
    };
    const refused = await failureOf(store.discardRow(broken.id));
    expect(refused.message).toMatch(/page rebuild \(VACUUM\) was refused.*INCOMPLETE/s);
    expect(await store.holds(broken.id)).toBe(true);

    db.exec = real;
    expect(await store.purge([broken.id])).toBe(0);
    expect(await store.holds(broken.id)).toBe(false);
    expect(residue(dir, (i) => i !== 1)).toEqual([]);
    expect((await store.deltasSince(new Set())).map(bytesOf)).toEqual(
      all.filter((d) => d.id !== broken.id).map(bytesOf),
    );
    await store.close();
  });
});
