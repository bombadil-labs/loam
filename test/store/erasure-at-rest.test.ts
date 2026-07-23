// §11 at the BYTE level (ticket T40) — a purge must remove the bytes, not merely the row.
//
// §11 promises a purged store retains "zero bytes of its content," and that purge "must reach every
// tier: the sqlite row, the mirror, the archive's fan file." Audit 3 found both tiers leaking, and
// the reason the leak survived this long is that every existing erasure rail asserts at the API
// level — `get(id)` returns undefined, the delta is gone from the snapshot — which stays true while
// the plaintext sits in the file.
//
// So these rails read the FILE. That is the whole point: an API-level assertion cannot see this
// class of failure, and writing one would have produced a green bar over a leak (again).

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

// A delta whose content is unmistakable in a hex dump — if any byte of this survives, we see it.
const MARKER = "SUBJECT-ERASURE-CANARY-9f3a7c";
// A second marker for deltas that must SURVIVE a partial purge — so a rail can assert the target is
// gone AND the neighbours remain, which is what stops a file-nuking "fix" from passing.
const SURVIVOR = "BYSTANDER-CANARY-4b1e02";
const canary = (mark: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
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

// Does ANY file under `root` still contain the marker? Read as bytes, not text — a partially
// overwritten page still counts as retention.
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

    // ERASE ONE SUBJECT, KEEP THE REST — the case §11 actually describes, and the one an
    // all-of-them purge cannot express (it collapses into "the store is empty and clean", which the
    // next test already asserts). Two markers, so the assertion can be two-sided.
    const target = canary(MARKER, 1000);
    const keep: Delta[] = [];
    for (let i = 0; i < 50; i += 1) keep.push(canary(SURVIVOR, 2000 + i));
    await store.append([target, ...keep]);

    // Look across the DIRECTORY, not just `store.db`: in WAL mode a fresh append lives in the
    // `-wal` sidecar until a checkpoint folds it in. Scoping the precondition to the main file
    // would have made this rail pass for the wrong reason (it did, once).
    expect(anyFileContains(dir, MARKER)).toBeDefined();

    expect(await store.purge([target.id])).toBe(1);

    // SCAN BEFORE CLOSE. The last connection's close runs its own checkpoint and unlinks the
    // `-wal`, so a scan after close is satisfied by the CLOSE rather than by the fix — reverting
    // `wal_checkpoint(TRUNCATE)` left the old version of this rail green. Scanning a LIVE store is
    // also the honest threat model: a backup or snapshot taken while the process runs.
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
    // ...and the neighbours are untouched. Without this clause a "fix" that nuked the file passes.
    expect(anyFileContains(dir, SURVIVOR)).toBeDefined();

    await store.close();
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
  });

  it("a RETRY whose DELETE finds nothing still truncates the WAL (ticket T67)", async () => {
    // The documented partial-erasure path: the first attempt deletes the rows and then fails to
    // truncate the WAL, so the caller holds "a partial erasure to retry, not a failed one to redo."
    // `purge` used to gate its `wal_checkpoint(TRUNCATE)` on `removed > 0` — and on that very retry
    // the rows are already gone, so `removed` is 0, so the checkpoint the retry EXISTS to perform
    // was skipped in silence. The plaintext stayed in the sidecar and every caller reported
    // success. The work outstanding on a retry is the truncation, not the DELETE.
    const dir = scratch();
    const file = join(dir, "store.db");
    const store = new SqliteBackend(file);
    const target = canary(MARKER, 1000);
    await store.append([target]);

    // Attempt 1, with the truncation sabotaged mid-purge: rows deleted, WAL left holding their
    // pre-delete page images. A second live handle is what does this in the wild; here the pragma
    // is intercepted so the rail is deterministic rather than a race.
    const db = (store as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const realPragma = db.pragma.bind(db);
    db.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : realPragma(sql, opts);
    await expect(store.purge([target.id])).rejects.toThrow(/write-ahead log|INCOMPLETE/i);
    expect(anyFileContains(dir, MARKER)).toBeDefined(); // still at rest, as the error says

    // The operator idles the other handle and re-runs, exactly as the error instructs. The DELETE
    // now finds nothing — and the checkpoint must still happen.
    db.pragma = realPragma;
    expect(await store.purge([target.id])).toBe(0); // no rows left to remove...
    expect(anyFileContains(dir, MARKER)).toBeUndefined(); // ...and the bytes are finally gone

    await store.close();
  });

  it("the truncation debt SURVIVES A CRASH: a reopened handle still knows, and still refuses to lie (ticket T67)", async () => {
    // The same partial erasure, ended by a process death instead of a retry. A latch that lived
    // only in handle memory made the reopened store look clean — rows gone, holds false — while
    // the sidecar still carried the plaintext, and the operator's retry was refused as `nothing
    // to erase`: the stranding class this ticket exists to delete, moved across a process
    // boundary. The debt is durable now, and this rail spans the boundary to prove it.
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
    // NO close() — close would checkpoint and settle the debt gracefully, which is exactly the
    // path a crash does not take. The handle is simply abandoned.

    const reopened = new SqliteBackend(file);
    // The reopened store owes a truncation it cannot prove is done, so byte-presence for the
    // purged id is UNPROVABLE — and unprovable answers true, never false (H9). This is what lets
    // the gateway's retry through instead of refusing it as `nothing to erase`.
    expect(await reopened.holds(target.id)).toBe(true);
    // The retry's own purge drives the checkpoint, clears the debt, and only THEN does the store
    // report the bytes gone.
    expect(await reopened.purge([target.id])).toBe(0);
    expect(await reopened.holds(target.id)).toBe(false);
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
    await reopened.close();
  });

  it("a purge that matched NOTHING does not fail on a busy checkpoint (ticket T67)", async () => {
    // The other side of ungating the checkpoint. `purge` is called on every attached quarantine
    // pool and on every boot `heal` sweep carrying the whole accumulated tombstone set, and those
    // overwhelmingly match nothing. If a busy checkpoint failed those calls, a concurrent reader on
    // an unrelated replica would fail an erasure that had already completed on every tier that held
    // the record — and point the operator at a store that never had it. Attempt always; refuse only
    // when truncation is actually owed.
    const dir = scratch();
    const store = new SqliteBackend(join(dir, "store.db"));
    await store.append([canary(SURVIVOR, 1000)]);

    const db = (store as unknown as { db: { pragma: (s: string, o?: unknown) => unknown } }).db;
    const realPragma = db.pragma.bind(db);
    db.pragma = (sql: string, opts?: unknown) =>
      sql.startsWith("wal_checkpoint") ? [{ busy: 1 }] : realPragma(sql, opts);

    // An id this store never held, with the checkpoint refusing: nothing was owed, so nothing fails.
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

    // Simulate the crash window `append` documents: written and fsynced under `<target>.<pid>.tmp`,
    // then the process died before `renameSync`. The bytes are on disk under a name reads ignore —
    // and which purge, today, never matches.
    const fans = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isDirectory());
    expect(fans.length).toBeGreaterThan(0);
    const fan = (fans[0] as { name: string }).name;
    const straggler = join(dir, fan, `${d.id}.json.99999.tmp`);
    writeFileSync(straggler, `${JSON.stringify({ id: d.id, claims: d.claims, sig: MARKER })}\n`);

    expect(await store.purge([d.id])).toBe(1);
    await store.close();

    // "Reads ignore it" is the right bound for correctness and the WRONG bound for erasure: the
    // promise is that the byte is removed, not that it is unread. A .tmp file is a plain file any
    // backup, rsync, or tar sweeps up.
    expect(anyFileContains(dir, MARKER)).toBeUndefined();
  });
});

// §11 reaching the COLD tier through heal (ticket T55).
//
// `heal` is documented as the operation that "finishes the forgetting on whatever tier the purge
// originally missed". It can only do that if it actually calls `purge` — and `purge` is the one
// operation that sees what reads cannot: a crash-left `<id>.json.<pid>.tmp` straggler, which
// `deltasSince` skips by design. So a rail here MUST read the directory. An API-level assertion is
// green across this entire leak.
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

    // The crash `append` is written to survive: fsync landed, the RENAME did not. So the mirror holds
    // a complete delta under a name `deltasSince` skips, and holds NO `.json` for it — which is what
    // makes the straggler invisible to every read. Reproduced by removing the `.json` and leaving a
    // `.tmp` behind, because a fixture that keeps both still satisfies heal's guard and proves
    // nothing.
    const fan = readdirSync(vault, { withFileTypes: true }).filter((f) => f.isDirectory())[0]!.name;
    const targetJson = readdirSync(join(vault, fan)).find((n) => n.startsWith(target.id))!;
    const bytes = readFileSync(join(vault, fan, targetJson));
    writeFileSync(join(vault, fan, `${target.id}.json.31337.tmp`), bytes);
    rmSync(join(vault, fan, targetJson));

    expect(anyFileContains(vault, MARKER)).toBeDefined(); // the bytes really are still there
    expect((await mirror.deltasSince(new Set())).some((d) => d.id === target.id)).toBe(false);

    // The gateway hands heal the tombstoned ids. This is where the forgetting must finish.
    await pair.heal(new Set([target.id]));

    // BYTE LEVEL — no file under the vault may still carry the erased content.
    expect(anyFileContains(vault, MARKER)).toBeUndefined();
    // ...and the bystander survives, so a vault-nuking "fix" cannot pass.
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

    // A report that says only what it COPIED lets a caller believe the forgetting happened when it
    // did not — the operator reads the healed line and concludes §11 reached the cold tier.
    const report = await pair.heal(new Set([target.id]));
    expect(report.purgedPrimary).toBeGreaterThanOrEqual(0);
    expect(report.purgedMirror).toBeGreaterThanOrEqual(1);
    await pair.close();
  });
});
