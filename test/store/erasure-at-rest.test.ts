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
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";
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
