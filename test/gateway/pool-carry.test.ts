// The carry of an existing pool (step 6, option (a)). The substrate binds the bytes; these rails
// prove Loam's derivation is COMPLETE: every binding refusal, every owed byte, and nothing dropped.
// Two-sided throughout: an erased target is refused and gone, and a named bystander is carried.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { containerClaims } from "../../src/gateway/container.js";
import { eraseClaims, refusedIds } from "../../src/gateway/erase.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { buildPoolCarry } from "../../src/gateway/pool-carry.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { StoreBackend } from "../../src/store/backend.js";

const SEED = "7e".repeat(32);
const OP = authorForSeed(SEED);
const note = (n: number): Delta =>
  signClaims(
    {
      timestamp: 20_000 + n,
      validFrom: 20_000 + n,
      author: OP,
      pointers: [{ role: "n", target: { kind: "primitive", value: n } }],
    },
    SEED,
  );

async function hostAndPool(poolStore: StoreBackend = new MemoryBackend()) {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:old", trust: "untrusted", posture: "separate" },
        OP,
        12_000,
      ),
      SEED,
    ),
  ]);
  const c = await gw.openContainer({ name: "container:old", backend: poolStore });
  return { gw, pool: c.gateway! };
}

describe("an existing pool's carry is complete", () => {
  it("carries every binding refusal with its signer, and the holdings without the erased target", async () => {
    const { gw, pool } = await hostAndPool();
    const target = note(1);
    const bystander = note(2);
    await gw.append([target, bystander]);
    await pool.federate([target, bystander], { admit: () => true });
    await gw.erase(target.id); // fans out into the pool and purges it there
    const result = await buildPoolCarry(pool);
    expect(result.status).toBe("carry");
    if (result.status !== "carry") return;
    const { carry } = result;
    // delta level: the refusal events are exactly the pool's refused set, each order qualified
    expect(carry.refusals.map((r) => r.targetId)).toEqual([...refusedIds(pool.reactor, OP)]);
    expect(carry.refusals[0]!.orders.every((o) => o.signer === OP)).toBe(true);
    // holdings: the erased target is gone; the bystander is carried
    expect(carry.holdings.some((d) => d.id === target.id)).toBe(false);
    expect(carry.holdings.some((d) => d.id === bystander.id)).toBe(true);
    expect(carry.obligations).toEqual([]); // the purge completed
    await gw.close();
  });

  it("carries bytes still held under a binding erasure as owed", async () => {
    const { gw, pool } = await hostAndPool();
    const target = note(3);
    await pool.federate([target], { admit: () => true });
    // the order lands in the pool, and nothing has purged the bytes yet
    await pool.append([signClaims(eraseClaims(target.id, OP, OP, 30_000), SEED)]);
    const result = await buildPoolCarry(pool);
    expect(result.status === "carry" && result.carry.obligations).toEqual([
      { targetId: target.id, surface: "rows" },
    ]);
    // a refused id is never an admitted holding, even while its bytes remain
    expect(result.status === "carry" && result.carry.holdings.some((d) => d.id === target.id)).toBe(
      false,
    );
    await gw.close();
  });

  it("does not carry a pool with a row it cannot read: the row is named", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "loam-carry-")), "pool.sqlite");
    const seedStore = new SqliteBackend(path);
    const d = note(4);
    await seedStore.append([d]);
    await seedStore.close();
    const db = new Database(path);
    db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run('{"not":"claims"}', d.id);
    db.close();
    const { gw, pool } = await hostAndPool(new SqliteBackend(path));
    const result = await buildPoolCarry(pool);
    expect(result).toMatchObject({ status: "undisposed", rows: [d.id] });
    await gw.close();
  });

  it("carries named sidecar debt as an obligation, and refuses debt it cannot name", async () => {
    class Debtor extends MemoryBackend {
      constructor(private readonly debt: { ids: string[]; unknown: boolean }) {
        super();
      }
      truncationDebt() {
        return this.debt;
      }
    }
    const named = await hostAndPool(new Debtor({ ids: ["1e20aa"], unknown: false }));
    const ok = await buildPoolCarry(named.pool);
    expect(ok.status === "carry" && ok.carry.obligations).toEqual([
      { targetId: "1e20aa", surface: "sidecar" },
    ]);
    await named.gw.close();
    const unnamed = await hostAndPool(new Debtor({ ids: [], unknown: true }));
    expect((await buildPoolCarry(unnamed.pool)).status).toBe("undisposed");
    await unnamed.gw.close();
  });

  it("the fence drains writes begun before it, and holds writes after it until release", async () => {
    // A store whose append takes real time, so a carry that did not drain would miss the row.
    class Slow extends MemoryBackend {
      override async append(deltas: Iterable<Delta>): Promise<number> {
        const batch = [...deltas];
        await new Promise((r) => setTimeout(r, 30));
        return super.append(batch);
      }
    }
    const { gw, pool } = await hostAndPool(new Slow());
    const early = note(5);
    pool.reactor.ingest(early); // a raw emission, its write still queued
    const result = await buildPoolCarry(pool);
    if (result.status !== "carry") throw new Error(result.reason);
    expect(result.carry.holdings.some((d) => d.id === early.id)).toBe(true); // drained, carried
    const late = note(6);
    pool.reactor.ingest(late); // after the fence: held, not written
    await pool.flush();
    expect(await pool.backend.holds(late.id)).toBe(false);
    await expect(pool.append([note(7)])).rejects.toThrow(/fenced/);
    await expect(pool.federate([note(8)], { admit: () => true })).rejects.toThrow(/fenced/);
    await expect(pool.reseat()).rejects.toThrow(/fenced/);
    const held = await result.release(); // abort: the old surface writes what it held
    expect(held.map((d) => d.id)).toEqual([late.id]);
    expect(await pool.backend.holds(late.id)).toBe(true);
    await gw.close();
  });

  it("does not carry a mirrored pool whose shadow tier holds a row the primary lacks", async () => {
    const archive = new MemoryBackend();
    const lost = note(9);
    await archive.append([lost]); // only the archive holds it: the primary was replaced
    const { gw, pool } = await hostAndPool(new MirrorBackend(new MemoryBackend(), archive));
    expect(await buildPoolCarry(pool)).toMatchObject({ status: "undisposed", rows: [lost.id] });
    expect(pool.fence).toBeUndefined(); // an undisposed carry lifts its fence
    await gw.close();
  });

  it("a purge already under way settles before the carry reads, so no captured byte vanishes", async () => {
    let entered!: () => void;
    const inPurge = new Promise<void>((r) => (entered = r));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    // A store whose purge pauses after it starts: an erasure worker caught mid-mutation.
    class Gated extends MemoryBackend {
      override async purge(ids: Iterable<string>): Promise<number> {
        const batch = [...ids];
        entered();
        await gate;
        return super.purge(batch);
      }
    }
    const { gw, pool } = await hostAndPool(new Gated());
    const target = note(10);
    const bystander = note(11);
    await gw.append([target, bystander]);
    await pool.federate([target, bystander], { admit: () => true });
    const erasing = gw.erase(target.id).catch(() => undefined);
    await inPurge; // the pool's purge has started and is paused
    const carrying = buildPoolCarry(pool);
    setTimeout(open, 30);
    const result = await carrying;
    await erasing;
    if (result.status !== "carry") throw new Error(result.reason);
    // the carry read after the purge settled: the target is neither a holding nor owed
    expect(result.carry.holdings.some((d) => d.id === target.id)).toBe(false);
    expect(result.carry.obligations).toEqual([]);
    // and every byte it captured is still held
    for (const d of result.carry.holdings) expect(await pool.backend.holds(d.id)).toBe(true);
    expect(result.carry.holdings.some((d) => d.id === bystander.id)).toBe(true);
    await result.release();
    await gw.close();
  });

  it("a deleted row whose -wal truncation is owed is a sidecar obligation, not a row", async () => {
    const target = note(12);
    // Like the sqlite driver: `holds` answers true while a truncation is owed for the id.
    class Owing extends MemoryBackend {
      private owed = new Set<string>();
      owe(id: string): void {
        this.owed.add(id);
      }
      override async holds(id: string): Promise<boolean> {
        return this.owed.has(id) || (await super.holds(id));
      }
      truncationDebt() {
        return { ids: [...this.owed], unknown: false };
      }
    }
    const store = new Owing();
    const { gw, pool } = await hostAndPool(store);
    await pool.federate([target], { admit: () => true });
    await pool.append([signClaims(eraseClaims(target.id, OP, OP, 31_000), SEED)]);
    await store.purge([target.id]); // the row is gone...
    store.owe(target.id); // ...and its page images may linger in the sidecar
    const result = await buildPoolCarry(pool);
    expect(result.status === "carry" && result.carry.obligations).toEqual([
      { targetId: target.id, surface: "sidecar" },
    ]);
    if (result.status === "carry") await result.release();
    await gw.close();
  });
});
