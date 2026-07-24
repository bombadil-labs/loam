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
});
