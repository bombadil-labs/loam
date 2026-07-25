// The one-time OPEN SCRUB, under contention (ticket T49) — the inherited-freelist VACUUM in the
// sqlite constructor must never wedge the store closed, and must reach the MAIN FILE.
//
// The scrub is §11 work done at open: `secure_delete` is connection-level, so a store that erased
// before it shipped keeps that plaintext in freed pages forever and only a VACUUM clears it
// (test/store/erasure-at-rest.test.ts owns the uncontended case — that the scrub HAPPENS). Doing
// that work in a CONSTRUCTOR carries two hazards this file owns:
//
//   - VACUUM takes an exclusive write lock and a constructor is not async. A second handle mid-append
//     (`append` runs BEGIN IMMEDIATE) turns `new SqliteBackend(path)` into a SYNCHRONOUS SQLITE_BUSY —
//     out of a call the seam has no rejected promise for, and which five bare constructions in
//     src/cli/cli.ts cannot catch. Before the scrub shipped, opening a store took no lock at all, so
//     a scrub that cannot run must cost an operator nothing but a line in the log.
//   - In WAL mode the rebuilt pages land in the `-wal` sidecar and the main file keeps its legible
//     freelist until a checkpoint folds them in. A store killed before `close()` is then at rest in
//     §11 violation while the code believes it healed — and `wal_checkpoint` does not throw on
//     contention, it RETURNS `busy`, so a discarded result is H7 verbatim.
//
// The rails therefore assert at both levels: what the FILE holds (bytes) and what the OPEN STORE
// does (it serves reads, and it names the deferral to its caller).
//
// Real contention, not an intercepted pragma: the wedge is a locking fact, and a stubbed lock proves
// nothing about locking. That costs each contended rail one `busy_timeout` (5s) by design.
//
// Deliberately NOT asserted here, and why:
//   - Byte-presence through `holds` after a deferred scrub. The inherited freelist belongs to
//     erasures no surviving id names, so the only fail-closed answer is "every id is unprovable",
//     which would make one contended open refuse every erasure for the life of the process. That
//     changes what the store promises rather than repairing it (Myk's call); the deferral is
//     REPORTED instead, and the next open scrubs. The rail that would close it: `holds` answers true
//     for an arbitrary id while `scrubDeferred` is set.
//   - The CLI's wiring of the report to `io.err` (test/cli owns that surface). The rail that would
//     close it: `loam store …` over an inherited-freelist store under a held write lock, asserting
//     the deferral reaches stderr.

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed, claimsToJson, signClaims, type Delta } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";

const SEED = "0e".repeat(32);
const AUTHOR = authorForSeed(SEED);

const MARKER = "OPEN-SCRUB-CANARY-7d20be"; // the erased row: its bytes must not survive the scrub
const SURVIVOR = "OPEN-SCRUB-BYSTANDER-118a4c"; // a live row: its bytes must survive it
const FILLER = "OPEN-SCRUB-FILLER-2c9d31"; // a row appended AFTER the erasure, consuming freed pages

// PADDED so the row spills into overflow pages. SQLite frees a page only when it empties, and a
// handful of short rows share one page that never frees — an unpadded fixture leaves
// `freelist_count` at 0, so the constructor skips the scrub and the rail proves nothing. `reps`
// sizes the payload in pages, which is how the one-page fixture below hits its boundary.
const canary = (mark: string, timestamp: number, reps = 400): Delta =>
  signClaims(
    {
      timestamp,
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

// A store as an older Loam left it: built by the CURRENT driver — so its tables and statements are
// already in place and the constructor under test needs no write lock of its own — then a row
// deleted through a handle with `secure_delete` OFF, which is exactly what this driver did before
// the pragma shipped. The precondition is asserted, not assumed: an unfreed fixture would make
// every rail below vacuously green.
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

  expect(freed).toBeGreaterThan(0); // the store really does owe a scrub...
  expect(hasBytes(file, MARKER)).toBe(true); // ...and the plaintext really is in the main file
  return { file, deleted, kept };
}

// The same store at the BOUNDARY: a freelist of EXACTLY ONE page. A legacy store does not sit at its
// high-water mark — it erased once and kept appending, and each append takes freed pages back, so a
// single leftover page is the ordinary end state of that history. The trigger for the scrub is
// therefore `> 0` and never `> 1`: one page of plaintext is plaintext. The refill is written through
// the LEGACY handle because appending through the current driver would scrub the fixture away before
// it existed.
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

  expect(freed).toBe(1); // EXACTLY one — the boundary this fixture exists to sit on
  expect(hasBytes(file, MARKER)).toBe(true); // and that one page is still legible
  return { file, kept, filler };
}

describe("the open scrub is best-effort and reported (ticket T49)", () => {
  it("a VACUUM refused by a concurrent writer still OPENS the store, says so, and is retried next open", async () => {
    const { file, kept } = await inheritedFreelist();

    // The ordinary two-handle case: another handle in the middle of an append, holding the write
    // lock past `busy_timeout`. Nothing exotic — this is what `append` does.
    const writer = new Database(file);
    writer.pragma("journal_mode = WAL");
    writer.exec("BEGIN IMMEDIATE");

    const reported: string[] = [];
    const store = new SqliteBackend(file, { onScrubDeferred: (why) => reported.push(why) });

    // OBJECT LEVEL — the store is open and serving. A scrub that cannot run must not cost the
    // operator the store; before the scrub existed, opening took no exclusive lock at all.
    const read = await store.deltasSince(new Set());
    expect(read.map((d) => d.id)).toEqual([kept.id]);

    // ...and it does not pretend the scrub happened. A bare `catch {}` here would be H7 with the
    // ink still wet — the fix for one silent outcome introducing another.
    expect(reported).toHaveLength(1);
    expect(reported[0] ?? "").toMatch(/scrub/i);
    expect(store.scrubDeferred).toBeDefined();

    // BYTE LEVEL — and the report is TRUE: the plaintext is still legible, which is the whole
    // reason there is something to report.
    expect(hasBytes(file, MARKER)).toBe(true);

    // The REPORTER is not allowed to wedge the open either: a closed stderr raises EPIPE, and a
    // deferral that throws on its way to the log would restore the exact defect through the door
    // built to report it. The field is the surface that cannot fail.
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

    // The debt needs no ledger: `freelist_count` IS the durable record, so the next open — with
    // the other handle idle — finishes the work it deferred.
    const reopened = new SqliteBackend(file);
    expect(reopened.scrubDeferred).toBeUndefined();
    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true); // two-sided: a file-nuking "scrub" fails here
    await reopened.close();
  }, 30_000);

  it("the scrub reaches the MAIN FILE with no close in sight", async () => {
    const { file, deleted } = await inheritedFreelist();

    const reported: string[] = [];
    const store = new SqliteBackend(file, { onScrubDeferred: (why) => reported.push(why) });

    // NO close(). In WAL mode the rebuilt pages land in the sidecar, so a store whose process ends
    // here — kill -9, a container reaped, a backup taken mid-run — must ALREADY be clean at rest.
    // Reading the main file alone is the point: `close()` would fold the WAL in and satisfy this
    // assertion without the fix.
    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);

    // A scrub that completed reports nothing and owes nothing — the complement of the rails above,
    // so a "fix" that simply always defers cannot pass.
    expect(reported).toEqual([]);
    expect(store.scrubDeferred).toBeUndefined();
    expect(await store.holds(deleted.id)).toBe(false);

    await store.close();
  });

  it("a freelist of EXACTLY ONE page is scrubbed too — the boundary is zero, not one", async () => {
    const { file, kept, filler } = await freelistOfExactlyOnePage();

    const store = new SqliteBackend(file);
    expect(store.scrubDeferred).toBeUndefined();

    // BYTE LEVEL — one page of inherited plaintext is inherited plaintext. A trigger that waited for
    // a second page would leave this store legible forever while reporting nothing at all.
    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);
    expect(hasBytes(file, FILLER)).toBe(true);

    // OBJECT LEVEL — and the store still reads as itself: the two live rows, the erased one gone.
    const read = (await store.deltasSince(new Set())).map((d) => d.id).sort();
    expect(read).toEqual([kept.id, filler.id].sort());

    await store.close();
  });

  it("a checkpoint refused by a concurrent reader is REPORTED, never counted as a scrub", async () => {
    const { file, kept } = await inheritedFreelist();

    // A reader's snapshot does not block the VACUUM — it blocks the TRUNCATE that folds the
    // rebuilt pages into the main file. This is the half-landed scrub: the store's own
    // `freelist_count` reads 0 while the plaintext is still at rest.
    const reader = new Database(file);
    reader.pragma("journal_mode = WAL");
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) FROM deltas").get();

    const reported: string[] = [];
    const store = new SqliteBackend(file, { onScrubDeferred: (why) => reported.push(why) });

    expect(reported).toHaveLength(1);
    expect(reported[0] ?? "").toMatch(/scrub/i);
    expect(store.scrubDeferred).toBeDefined();
    // The rebuild happened, so the handle's own view is spotless — and the FILE is not. Asserting
    // only the pragma is how this leak stayed invisible.
    expect(hasBytes(file, MARKER)).toBe(true);
    expect((await store.deltasSince(new Set())).map((d) => d.id)).toEqual([kept.id]);

    // The reader idles; the fold lands and the bytes finally go.
    reader.exec("ROLLBACK");
    reader.close();
    await store.close();
    expect(hasBytes(file, MARKER)).toBe(false);
    expect(hasBytes(file, SURVIVOR)).toBe(true);
  }, 30_000);
});
