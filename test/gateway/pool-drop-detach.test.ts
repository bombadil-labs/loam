import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { overlay } from "../helpers/faultable-backend.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims } from "../../src/gateway/container-law.js";
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
    expect(pool.gateway.reactor.has(secret.id)).toBe(true);

    await pool.drop();

    const reopened = new SqliteBackend(path);
    expect(await reopened.holds(secret.id)).toBe(false);
    expect(await reopened.deltasSince(new Set())).toEqual([]);
    await reopened.close();
    expect(readFileSync(path).includes(Buffer.from(MARKER))).toBe(false);
    await gw.close();
  });

  it("a pool holding exactly ONE delta is still purged — the boundary is zero, not one", async () => {
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
    expect(await reopened.holds(secret.id)).toBe(false);
    await reopened.close();
    await gw.close();
  });

  it("a store retaining exactly ONE byte still refuses — the verdict's boundary is zero too", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const inner = new MemoryBackend();
    const keepOne = overlay(inner, {
      purge: async (ids) => inner.purge([...ids].filter((id) => id !== secret.id)),
    });
    const pool = await gw.openQuarantine({ backend: keepOne });

    await expect(pool.drop()).rejects.toThrow(/still holds 1 of/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a drop that cannot PROVE discard refuses and leaves the pool ATTACHED (fail-safe)", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const inner = new MemoryBackend();
    const lying = overlay(inner, { purge: (ids) => Promise.resolve([...ids].length) });
    const pool = await gw.openQuarantine({ backend: lying });

    await expect(pool.drop()).rejects.toThrow(/still holds/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a BATCH probe that returns survivors refuses through the batch branch too", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const inner = new MemoryBackend();
    const keepOneBatch = overlay(inner, {
      purge: async (ids) => inner.purge([...ids].filter((id) => id !== secret.id)),
      holds: () => Promise.reject(new Error("per-id must not be consulted")),
      heldAmong: async (ids) => {
        const held = new Set<string>();
        for (const id of ids) if (await inner.holds(id)) held.add(id);
        return held;
      },
    });
    const pool = await gw.openQuarantine({ backend: keepOneBatch });

    await expect(pool.drop()).rejects.toThrow(/still holds 1 of/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a probe that cannot ANSWER refuses the same way — unproven is not discarded (H9)", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const inner = new MemoryBackend();
    const mute = overlay(inner, {
      holds: () => Promise.reject(new Error("pool store offline")),
      heldAmong: () => Promise.reject(new Error("pool store offline")),
    });
    const pool = await gw.openQuarantine({ backend: mute });

    await expect(pool.drop()).rejects.toThrow(/could not be proven clean/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });
});

describe("T72: drop names MORE than the readable surface", () => {
  it("a store whose READ is blind still refuses — the session reactor remembers what deltasSince cannot", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const inner = new MemoryBackend();
    const blindRead = overlay(inner, {
      deltasSince: () => Promise.resolve([]),
      purge: () => Promise.resolve(0),
    });
    const pool = await gw.openQuarantine({ backend: blindRead });
    expect(await inner.holds(secret.id)).toBe(true);

    await expect(pool.drop()).rejects.toThrow(/still holds/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await gw.close();
  });

  it("a §25-quarantined row — legible bytes a read SET ASIDE — is swept by drop, not skipped", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const path = join(tmp, "pen-pool.db");
    const pool = await gw.openQuarantine({ backend: new SqliteBackend(path) });
    const raw = new Database(path);
    raw
      .prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)")
      .run("zz" + "0".repeat(66), `{"broken":"${MARKER}"`, null);
    raw.close();

    await pool.drop();
    const file = readFileSync(path);
    expect(file.includes(Buffer.from(MARKER))).toBe(false);
    await gw.close();
  });
});

const SUSPECT = "container:suspect";
const declareSuspect = (gw: Gateway, ts: number) =>
  gw.signer!.sign(
    containerClaims(
      { container: SUSPECT, trust: "untrusted", posture: "separate" },
      gw.operatorAuthor!,
      ts,
    ),
  );

describe("T72: detach() keeps the bytes deliberately, and reattachment restores the law's reach", () => {
  it("detach closes without purging; reattach + erase sweeps the surviving store", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const path = join(tmp, "detached-pool.db");
    await gw.append([declareSuspect(gw, 20_000)]);
    const pool = await gw.openContainer({ name: SUSPECT, backend: new SqliteBackend(path) });

    await pool.detach();
    expect(gw.quarantinePools.has(pool.gateway!)).toBe(false);

    const surviving = new SqliteBackend(path);
    expect(await surviving.holds(secret.id)).toBe(true);

    const reattached = await gw.openContainer({ name: SUSPECT, backend: surviving });
    await gw.erase(secret.id);
    expect(await surviving.holds(secret.id)).toBe(false);
    await reattached.drop();
    await gw.close();
  });

  it("an erasure issued DURING the window is settled AT reattach — before the pool's reader exists", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    const path = join(tmp, "window-pool.db");
    await gw.append([declareSuspect(gw, 20_000)]);
    const pool = await gw.openContainer({ name: SUSPECT, backend: new SqliteBackend(path) });
    await pool.detach();

    await gw.erase(secret.id);

    const surviving = new SqliteBackend(path);
    expect(await surviving.holds(secret.id)).toBe(true);
    const reattached = await gw.openContainer({ name: SUSPECT, backend: surviving });
    expect(reattached.gateway!.reactor.has(secret.id)).toBe(false);
    expect(await surviving.holds(secret.id)).toBe(false);
    await reattached.drop();
    expect(readFileSync(path).includes(Buffer.from(MARKER))).toBe(false);
    await gw.close();
  });

  it("a store that cannot be PROVEN clean of window debt refuses to attach at all (H9)", async () => {
    const gw = await boot();
    const secret = observed(FERN, "note", MARKER, 1000, OP_SEED);
    await gw.append([secret]);
    await gw.erase(secret.id);
    const inner = new MemoryBackend();
    await inner.append([secret]);
    const stuck: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: () => Promise.reject(new Error("read-only mount")),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
    };
    await expect(gw.openQuarantine({ backend: stuck })).rejects.toThrow(
      /erasure debt that could not be settled/,
    );
    await gw.close();
  });
});
