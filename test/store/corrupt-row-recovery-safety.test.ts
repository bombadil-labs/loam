import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import type { QuarantinedRow, RepairableBackend } from "../../src/store/quarantine.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { retraction } from "../gateway/narrowing.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 20000 });

const OP_SEED = "3d".repeat(32);
const OP = authorForSeed(OP_SEED);

const height = observed(FERN, "height", 30, 1000, OP_SEED);
const bystander = observed(FERN, "tag", "shade", 1500, OP_SEED);
const strike = retraction(height.id, OP, OP_SEED, 2000);
const arrival = observed(FERN, "tag", "fronds", 1600, OP_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-t66-safety-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let n = 0;

interface Row {
  readonly claims: string;
  readonly sig: string | null;
}

const rowOf = (path: string, id: string): Row | undefined => {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT claims, sig FROM deltas WHERE id = ?").get(id) as Row | undefined;
  } finally {
    db.close();
  }
};

const corruptSig = (path: string, id: string): void => {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), id);
  db.close();
};

async function plantedPair(): Promise<{ path: string; vault: string }> {
  const dir = join(tmp, `w-${n++}`);
  const path = join(dir, "store.sqlite");
  const vault = join(dir, "archive");
  const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
  const gw = await Gateway.boot(store, assembleGenesis({ operatorSeed: OP_SEED }));
  await gw.append([height, bystander, strike]);
  await gw.close();
  return { path, vault };
}

describe("T66/§11: the restore can never resurrect a condemned id", () => {
  it("a squatter on a TOMBSTONED id is not restored, while a live squatter beside it is", async () => {
    const { path, vault } = await plantedPair();
    corruptSig(path, height.id);
    corruptSig(path, strike.id);

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    await store.heal(new Set([height.id]));
    await store.close();

    expect(rowOf(path, height.id)).toBeUndefined();
    expect(store.lastRestore?.restored).not.toContain(height.id);
    expect(store.lastRestore?.restored).toEqual([strike.id]);
    expect(rowOf(path, strike.id)?.sig).toBe(strike.sig);
  });

  it("a condemned id is never even OFFERED to the driver — §11 re-asserted inside, not trusted", async () => {
    const asked: string[] = [];
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const penned = new Set([height.id, strike.id]);
    const primary: RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: async (k) => (await inner.deltasSince(k)).filter((d) => !penned.has(d.id)),
      purge: () => Promise.resolve(0),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
      quarantine: () =>
        Promise.resolve(
          [...penned].map((id) => ({
            key: id,
            reason: "invalid-signature" as const,
            preview: "…",
          })),
        ),
      discardRow: () => Promise.resolve(false),
      restoreQuarantined: (deltas) => {
        for (const d of deltas) asked.push(d.id);
        return Promise.resolve([]);
      },
    };
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    await store.heal(new Set([height.id]));

    expect(asked).toEqual([strike.id]);
    await store.close();
  });
});

describe("T66: heal WITHHOLDS a plant it cannot prove safe", () => {
  const stuckPrimary = (
    inner: StoreBackend,
    pen: readonly QuarantinedRow[],
  ): RepairableBackend => ({
    append: (d) => inner.append(d),
    deltasSince: async (k) =>
      (await inner.deltasSince(k)).filter((d) => !pen.some((r) => r.key === d.id)),
    purge: (ids) => inner.purge(ids),
    holds: (id) => inner.holds(id),
    close: () => inner.close(),
    quarantine: () => Promise.resolve([...pen]),
    discardRow: () => Promise.resolve(false),
  });

  it("an UNREADABLE pen row withholds the WHOLE plant — it may be an erasure nobody can read", async () => {
    const inner = new MemoryBackend();
    const primary = stuckPrimary(inner, [
      { key: strike.id, reason: "unparseable", preview: "{not json" },
    ]);
    const vault = new MemoryBackend();
    await vault.append([arrival, bystander]);
    const store = new MirrorBackend(primary, vault);

    const report = await store.heal();

    expect(report.toPrimary).toBe(0);
    expect(await inner.holds(arrival.id)).toBe(false);
    expect(store.lastRestore?.replantWithheld.length).toBe(1);
    expect(store.lastRestore?.replantWithheld[0]).toMatch(/erasure|erased/i);
    await store.close();
  });

  it("the withholding LIFTS once the row is settled — recoverable, not a permanent stop", async () => {
    const inner = new MemoryBackend();
    const pen: QuarantinedRow[] = [{ key: strike.id, reason: "unparseable", preview: "{not json" }];
    const primary = stuckPrimary(inner, pen);
    const vault = new MemoryBackend();
    await vault.append([arrival, bystander]);
    const store = new MirrorBackend(primary, vault);

    await store.heal();
    expect(await inner.holds(arrival.id)).toBe(false);

    pen.length = 0;
    const second = await store.heal();

    expect(second.toPrimary).toBe(2);
    expect(await inner.holds(arrival.id)).toBe(true);
    expect(store.lastRestore?.replantWithheld).toEqual([]);
    await store.close();
  });

  it("a target whose STRIKE is still set aside is withheld BY NAME, and its siblings still land", async () => {
    const inner = new MemoryBackend();
    const primary = stuckPrimary(inner, [
      { key: strike.id, reason: "invalid-signature", preview: "…", negates: [height.id] },
    ]);
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    const report = await store.heal();

    expect(await inner.holds(height.id)).toBe(false);
    expect(await inner.holds(bystander.id)).toBe(true);
    expect(await inner.holds(strike.id)).toBe(true);
    expect(report.toPrimary).toBe(2);
    expect(store.lastRestore?.replantWithheld.some((m) => m.includes(height.id))).toBe(true);
    await store.close();
  });

  it("a penned row the mirror has NO copy of is still named — the case heal cannot fix", async () => {
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const primary = stuckPrimary(inner, [
      { key: strike.id, reason: "invalid-signature", preview: "…", negates: [height.id] },
    ]);
    const vault = new MemoryBackend();
    await vault.append([bystander]);
    const store = new MirrorBackend(primary, vault);

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    expect(store.lastRestore?.stranded[0]).toMatch(/no healthy copy/i);
    await store.close();
  });
});

describe("T66/H9: a heal that cannot finish never speaks for the pen", () => {
  it("a REJECTED heal clears the previous heal's verdict rather than repeating it", async () => {
    const { path, vault } = await plantedPair();
    corruptSig(path, strike.id);
    const cold = new ArchiveBackend(vault);
    let broken = false;
    const flaky: StoreBackend = {
      append: (d) => (broken ? Promise.reject(new Error("archive gone")) : cold.append(d)),
      deltasSince: (k) => cold.deltasSince(k),
      purge: (ids) => cold.purge(ids),
      holds: (id) => cold.holds(id),
      close: () => cold.close(),
    };
    const store = new MirrorBackend(new SqliteBackend(path), flaky);

    await store.heal();
    expect(store.lastRestore?.restored).toEqual([strike.id]);

    broken = true;
    await expect(store.heal()).rejects.toThrow(/archive gone/);
    expect(store.lastRestore).toBeUndefined();
    await store.close();
  });

  it("a restore that REJECTS keeps the erasure refusals the sweep already collected (§11)", async () => {
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const primary: RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: async (k) => (await inner.deltasSince(k)).filter((d) => d.id !== strike.id),
      purge: () => Promise.reject(new Error("this erasure is INCOMPLETE (§11)")),
      holds: () => Promise.resolve(false),
      close: () => inner.close(),
      quarantine: () =>
        Promise.resolve([{ key: strike.id, reason: "invalid-signature" as const, preview: "…" }]),
      discardRow: () => Promise.resolve(false),
      restoreQuarantined: () => Promise.reject(new Error("database is locked")),
    };
    const vault = new MemoryBackend();
    await vault.append([bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    const report = await store.heal(new Set([height.id]));

    expect(report.purgeFailures.some((m) => m.includes("INCOMPLETE"))).toBe(true);
    expect(
      store.lastRestore?.stranded.some(
        (m) => m.includes("database is locked") && m.includes("§25"),
      ),
    ).toBe(true);
    expect(report.toPrimary).toBe(0);
    await store.close();
  });
});
