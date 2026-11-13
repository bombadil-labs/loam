import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed, claimsToJson, signClaims, type Delta } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";

const SEED = "0e".repeat(32);
const AUTHOR = authorForSeed(SEED);

const MARKER = "OPEN-SCRUB-CANARY-7d20be";
const SURVIVOR = "OPEN-SCRUB-BYSTANDER-118a4c";
const FILLER = "OPEN-SCRUB-FILLER-2c9d31";

const canary = (mark: string, timestamp: number, reps = 400): Delta =>
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
        { role: "value", target: { kind: "primitive", value: mark.repeat(reps) } },
      ],
    },
    SEED,
  );

const hasBytes = (file: string, needle: string): boolean =>
  readFileSync(file).includes(Buffer.from(needle));

async function inheritedFreelist(): Promise<{
  readonly file: string;
  readonly deleted: Delta;
  readonly kept: Delta;
}> {
  const file = join(mkdtempSync(join(tmpdir(), "loam-open-scrub-")), "store.db");
  const seed = new SqliteBackend(file);
  const deleted = canary(MARKER, 1000);
  const kept = canary(SURVIVOR, 2000);
  await seed.append([deleted, kept]);
  await seed.close();

  const legacy = new Database(file);
  legacy.pragma("secure_delete = OFF");
  legacy.prepare("DELETE FROM deltas WHERE id = ?").run(deleted.id);
  const freed = legacy.pragma("freelist_count", { simple: true }) as number;
  legacy.close();

  expect(freed).toBeGreaterThan(0);
  expect(hasBytes(file, MARKER)).toBe(true);
  return { file, deleted, kept };
}

async function freelistOfExactlyOnePage(): Promise<{
  readonly file: string;
  readonly kept: Delta;
  readonly filler: Delta;
}> {
  const file = join(mkdtempSync(join(tmpdir(), "loam-open-scrub-one-")), "store.db");
  const seed = new SqliteBackend(file);
  const deleted = canary(MARKER, 1000, 200);
  const kept = canary(SURVIVOR, 2000);
  await seed.append([deleted, kept]);
  await seed.close();

  const legacy = new Database(file);
  legacy.pragma("secure_delete = OFF");
  legacy.prepare("DELETE FROM deltas WHERE id = ?").run(deleted.id);
  const filler = canary(FILLER, 3000, 100);
  legacy
    .prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)")
    .run(filler.id, JSON.stringify(claimsToJson(filler.claims)), filler.sig ?? null);
  const freed = legacy.pragma("freelist_count", { simple: true }) as number;
  legacy.close();

  expect(freed).toBe(1);
  expect(hasBytes(file, MARKER)).toBe(true);
  return { file, kept, filler };
}

describe("the open scrub is best-effort and reported (ticket T49)", () => {
  it("a VACUUM refused by a concurrent writer still OPENS the store, says so, and is retried next open", async () => {
    const { file, kept } = await inheritedFreelist();

    const writer = new Database(file);
    writer.pragma("journal_mode = WAL");
    writer.exec("BEGIN IMMEDIATE");

    const reported: string[] = [];
    const store = new SqliteBackend(file, { onScrubDeferred: (why) => reported.push(why) });

    const read = await store.deltasSince(new Set());
    expect(read.map((d) => d.id)).toEqual([kept.id]);

    expect(reported).toHaveLength(1);
    expect(reported[0] ?? "").toMatch(/scrub/i);
    expect(store.scrubDeferred).toBeDefined();

    expect(hasBytes(file, MARKER)).toBe(true);

    const brittle = new SqliteBackend(file, {
      onScrubDeferred: () => {
        throw new Error("EPIPE");
      },
    });
    expect(brittle.scrubDeferred).toBeDefined();
    await brittle.close();

    writer.exec("ROLLBACK");
    writer.close();
    await store.close();

    const reopened = new SqliteBackend(file);
    expect(reopened.scrubDeferred).toBeUndefined();
    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);
    await reopened.close();
  }, 30_000);

  it("the scrub reaches the MAIN FILE with no close in sight", async () => {
    const { file, deleted } = await inheritedFreelist();

    const reported: string[] = [];
    const store = new SqliteBackend(file, { onScrubDeferred: (why) => reported.push(why) });

    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);

    expect(reported).toEqual([]);
    expect(store.scrubDeferred).toBeUndefined();
    expect(await store.holds(deleted.id)).toBe(false);

    await store.close();
  });

  it("a freelist of EXACTLY ONE page is scrubbed too — the boundary is zero, not one", async () => {
    const { file, kept, filler } = await freelistOfExactlyOnePage();

    const store = new SqliteBackend(file);
    expect(store.scrubDeferred).toBeUndefined();

    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);
    expect(hasBytes(file, FILLER)).toBe(true);

    const read = (await store.deltasSince(new Set())).map((d) => d.id).sort();
    expect(read).toEqual([kept.id, filler.id].sort());

    await store.close();
  });

  it("a checkpoint refused by a concurrent reader is REPORTED, never counted as a scrub", async () => {
    const { file, kept } = await inheritedFreelist();

    const reader = new Database(file);
    reader.pragma("journal_mode = WAL");
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) FROM deltas").get();

    const reported: string[] = [];
    const store = new SqliteBackend(file, { onScrubDeferred: (why) => reported.push(why) });

    expect(reported).toHaveLength(1);
    expect(reported[0] ?? "").toMatch(/scrub/i);
    expect(store.scrubDeferred).toBeDefined();
    expect(hasBytes(file, MARKER)).toBe(true);
    expect((await store.deltasSince(new Set())).map((d) => d.id)).toEqual([kept.id]);

    reader.exec("ROLLBACK");
    reader.close();
    await store.close();
    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);
  }, 30_000);
});
