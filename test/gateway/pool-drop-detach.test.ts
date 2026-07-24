// T72 — drop() means DISCARD, detach() means KEEP, and the difference is bytes (Myk, 2026-07-24).
// The pool interface promised drop "discards its store wholesale", and that was true only of the
// default MemoryBackend: with a durable backend (the documented way to run a long-running
// quarantine) drop closed the handle and LEFT THE SEEDED COPIES ON DISK — outside every future
// erasure's reach, since erase walks only the ATTACHED pools. The erasure-evasion channel §24.8's
// fan-out exists to prevent, opened by the cleanup call itself.
//
// So: drop() now PURGES the pool's store and VERIFIES the bytes left (holds — the T70 discipline:
// a purge's return is evidence, never the verdict), refusing loudly and LEAVING THE POOL ATTACHED
// when it cannot prove discard (still in erasure reach — fail-safe). detach() is the deliberate
// keep: close without purge — Myk's "temporary quarantine" for debugging a suspect pool — and
// reattachment is just openQuarantine over the surviving store, which restores erasure reach.
// Deferred, named: the detach GROUND RECORD (who detached what) waits for T32's container
// vocabulary mint rather than minting a one-off loam.* shape it would have to migrate.

import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const MARKER = "POOL-DISCARD-CANARY-7c2f91";

const tmp = mkdtempSync(join(tmpdir(), "loam-pool-drop-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

describe("T72: drop() discards at the bytes, on every backend", () => {
  it("a durable pool's file is EMPTY after drop — reopened, scanned, and marker-free", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const path = join(tmp, "durable-pool.db");
    const pool = await gw.openQuarantine({ backend: new SqliteBackend(path) });
    expect(pool.gateway.reactor.has(secret.id)).toBe(true); // seeded through the glass

    await pool.drop();

    // The promise, verified where it lives: a FRESH handle on the same path holds nothing —
    // not the seeded secret, not anything (wholesale) — and the file carries no plaintext.
    const reopened = new SqliteBackend(path);
    expect(await reopened.holds(secret.id)).toBe(false);
    expect(await reopened.deltasSince(new Set())).toEqual([]);
    await reopened.close();
    expect(readFileSync(path).includes(Buffer.from(MARKER))).toBe(false);
    await gw.close();
  });

  it("a pool holding exactly ONE delta is still purged — the boundary is zero, not one", async () => {
    // hollow-test's off-by-one mutant: `ids.length > 0` -> `> 1` skips the purge for a
    // single-delta pool and drop reports success over retained bytes. Build that exact pool
    // (an admit filter that seeds only the secret) and hold the boundary.
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const path = join(tmp, "single-delta-pool.db");
    const pool = await gw.openQuarantine({
      backend: new SqliteBackend(path),
      admit: (d) => d.id === secret.id,
    });

    await pool.drop();
    const reopened = new SqliteBackend(path);
    expect(await reopened.holds(secret.id)).toBe(false); // the one delta is gone
    await reopened.close();
    await gw.close();
  });

  it("a store retaining exactly ONE byte still refuses — the verdict's boundary is zero too", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const inner = new MemoryBackend();
    // Purges everything EXCEPT the secret: count is honest-looking, one byte remains.
    const keepOne: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: async (ids) => inner.purge([...ids].filter((id) => id !== secret.id)),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
    };
    const pool = await gw.openQuarantine({ backend: keepOne });

    await expect(pool.drop()).rejects.toThrow(/still holds 1 of/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a drop that cannot PROVE discard refuses and leaves the pool ATTACHED (fail-safe)", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const inner = new MemoryBackend();
    // A store whose purge LIES — reports removal, deletes nothing (the shape T40/T70 hunt).
    const lying: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: (ids) => Promise.resolve([...ids].length),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
    };
    const pool = await gw.openQuarantine({ backend: lying });

    await expect(pool.drop()).rejects.toThrow(/still holds/);
    // Fail-safe: the pool it could not discard is STILL in the primary's erasure reach.
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a BATCH probe that returns survivors refuses through the batch branch too", async () => {
    // The heldAmong-preferred branch, driven to a NON-EMPTY answer (the mute test binds only its
    // throw shape): a batch-probing store that retains must refuse exactly like a per-id one.
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const inner = new MemoryBackend();
    const keepOneBatch: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: async (ids) => inner.purge([...ids].filter((id) => id !== secret.id)),
      holds: () => Promise.reject(new Error("per-id must not be consulted")), // batch answers
      heldAmong: async (ids) => {
        const held = new Set<string>();
        for (const id of ids) if (await inner.holds(id)) held.add(id);
        return held;
      },
      close: () => inner.close(),
    };
    const pool = await gw.openQuarantine({ backend: keepOneBatch });

    await expect(pool.drop()).rejects.toThrow(/still holds 1 of/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a probe that cannot ANSWER refuses the same way — unproven is not discarded (H9)", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const inner = new MemoryBackend();
    const mute: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: (ids) => inner.purge(ids),
      holds: () => Promise.reject(new Error("pool store offline")),
      heldAmong: () => Promise.reject(new Error("pool store offline")),
      close: () => inner.close(),
    };
    const pool = await gw.openQuarantine({ backend: mute });

    await expect(pool.drop()).rejects.toThrow(/could not be proven clean/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true); // attached until proven discarded
    await gw.close();
  });
});

describe("T72: drop names MORE than the readable surface", () => {
  it("a store whose READ is blind still refuses — the session reactor remembers what deltasSince cannot", async () => {
    // The retry shape the erasure lens confirmed: after a partial purge, the readable surface is
    // empty (a mirror's read is primary-only) while a tier retains everything — the old zero-ids
    // path skipped the verdict and reported success. The reactor names what the read cannot.
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const inner = new MemoryBackend();
    const blindRead: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: () => Promise.resolve([]), // the read names NOTHING...
      purge: () => Promise.resolve(0), // ...and the purge quietly does nothing
      holds: (id) => inner.holds(id), // ...while the bytes are honestly still there
      close: () => inner.close(),
    };
    const pool = await gw.openQuarantine({ backend: blindRead });
    expect(await inner.holds(secret.id)).toBe(true); // seeded: the tier holds the byte

    await expect(pool.drop()).rejects.toThrow(/still holds/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a §25-quarantined row — legible bytes a read SET ASIDE — is swept by drop, not skipped", async () => {
    // deltasSince quarantines a corrupt row and does not return it, so an id-keyed purge can
    // never reach it: without the pen sweep, drop verified clean over retained plaintext.
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const path = join(tmp, "pen-pool.db");
    const pool = await gw.openQuarantine({ backend: new SqliteBackend(path) });
    // Corrupt a row behind the seam, as a crash or foreign writer would: legible marker bytes
    // under a key whose content no longer parses as a delta.
    const raw = new Database(path);
    raw
      .prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)")
      .run("zz" + "0".repeat(66), `{"broken":"${MARKER}"`, null);
    raw.close();

    await pool.drop();
    const file = readFileSync(path);
    expect(file.includes(Buffer.from(MARKER))).toBe(false); // the pen row is GONE at the bytes
    await gw.close();
  });
});

describe("T72: detach() keeps the bytes deliberately, and reattachment restores the law's reach", () => {
  it("detach closes without purging; reattach + erase sweeps the surviving store", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const path = join(tmp, "detached-pool.db");
    const pool = await gw.openQuarantine({ backend: new SqliteBackend(path) });

    await pool.detach();
    expect(gw.quarantinePools.has(pool.gateway)).toBe(false); // out of the fan-out...

    // ...bytes deliberately KEPT: the temporary quarantine survives for debugging.
    const surviving = new SqliteBackend(path);
    expect(await surviving.holds(secret.id)).toBe(true);

    // Ruled safe (or condemned): REATTACH is just opening a pool over the surviving store —
    // and the operator's erasure reaches through it again, proving the reach was restored.
    const reattached = await gw.openQuarantine({ backend: surviving });
    await gw.erase(secret.id);
    expect(await surviving.holds(secret.id)).toBe(false); // swept through the reattached glass
    await reattached.drop();
    await gw.close();
  });

  it("an erasure issued DURING the window is settled AT reattach — before the pool's reader exists", async () => {
    // The suppression lens's finding: the seeding edge delivers a tombstone as data and executes
    // nothing, so a naive reattach boots a reader that resolves the forgotten byte LIVE while the
    // tombstone sits beside it. Settle runs before Gateway.open, so both levels come back clean.
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const path = join(tmp, "window-pool.db");
    const pool = await gw.openQuarantine({ backend: new SqliteBackend(path) });
    await pool.detach();

    await gw.erase(secret.id); // decided while the store was away — fans to NO pool

    const surviving = new SqliteBackend(path);
    expect(await surviving.holds(secret.id)).toBe(true); // premise: the byte truly survived the window
    const reattached = await gw.openQuarantine({ backend: surviving });
    // Object level: the reattached pool's reader never saw the byte...
    expect(reattached.gateway.reactor.has(secret.id)).toBe(false);
    // ...and byte level: the store was swept before the reader existed.
    expect(await surviving.holds(secret.id)).toBe(false);
    await reattached.drop();
    expect(readFileSync(path).includes(Buffer.from(MARKER))).toBe(false);
    await gw.close();
  });

  it("a store that cannot be PROVEN clean of window debt refuses to attach at all (H9)", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    await gw.erase(secret.id); // the debt exists before this pool is ever opened
    const inner = new MemoryBackend();
    await inner.append([secret]); // a store that still holds the forgotten byte...
    const stuck: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: () => Promise.reject(new Error("read-only mount")), // ...and cannot purge it
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
    };
    await expect(gw.openQuarantine({ backend: stuck })).rejects.toThrow(
      /erasure debt that could not be settled/,
    );
    await gw.close();
  });
});
