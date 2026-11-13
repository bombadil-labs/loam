import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, claimsToJson, makeDelta, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { DELTA_ID, DELTA_ID_LENGTH, type RepairableBackend } from "../../src/store/quarantine.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { assertPreservesSuppression, retraction } from "../gateway/narrowing.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 20000 });

const OP_SEED = "3d".repeat(32);
const OP = authorForSeed(OP_SEED);

const height = observed(FERN, "height", 30, 1000, OP_SEED);
const bystander = observed(FERN, "tag", "shade", 1500, OP_SEED);
const strike = retraction(height.id, OP, OP_SEED, 2000);

const GENESIS = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });

const tmp = mkdtempSync(join(tmpdir(), "loam-t66-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let n = 0;
const freshDir = (): string => join(tmp, `w-${n++}`);

interface Row {
  readonly claims: string;
  readonly sig: string | null;
}

function rowOf(path: string, id: string): Row | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT claims, sig FROM deltas WHERE id = ?").get(id) as Row | undefined;
  } finally {
    db.close();
  }
}

function corruptSig(path: string, id: string): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), id);
  db.close();
}

function corruptClaims(path: string, id: string): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run("{not json at all", id);
  db.close();
}

async function plantedPair(): Promise<{ path: string; vault: string }> {
  const dir = freshDir();
  const path = join(dir, "store.sqlite");
  const vault = join(dir, "archive");
  const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
  const gw = await Gateway.boot(store, GENESIS());
  await gw.append([height, bystander, strike]);
  await gw.close();
  return { path, vault };
}

function healRowOutOfBand(path: string, d: Delta): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ?, sig = ? WHERE id = ?").run(
    JSON.stringify(claimsToJson(d.claims)),
    d.sig ?? null,
    d.id,
  );
  db.close();
}

const healthySource = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(new MemoryBackend(), GENESIS());
  await gw.append([height, bystander, strike]);
  return gw;
};

describe("T66: heal replaces a corrupt row from the mirror's healthy copy", () => {
  it("the squatted negation is REPLACED, the strike is restored, and the bystander is untouched", async () => {
    const { path, vault } = await plantedPair();
    const before = rowOf(path, bystander.id);
    corruptSig(path, strike.id);
    expect(rowOf(path, strike.id)?.sig).not.toBe(strike.sig);

    const before2 = await Gateway.boot(new SqliteBackend(path), GENESIS());
    const sick = await before2.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((sick.data?.plant as { height: unknown }).height).toBe(30);
    await before2.close();

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    expect(store.lastRestore).toBeUndefined();
    await store.heal();
    await store.close();

    expect(store.lastRestore).toEqual({ restored: [strike.id], stranded: [], replantWithheld: [] });
    expect(rowOf(path, strike.id)?.sig).toBe(strike.sig);
    expect(rowOf(path, strike.id)?.claims).toBe(JSON.stringify(claimsToJson(strike.claims)));
    expect(rowOf(path, bystander.id)).toEqual(before);

    const source = await healthySource();
    const dest = await Gateway.boot(new SqliteBackend(path), GENESIS());
    assertPreservesSuppression({
      what: "heal replanting a healthy negation over a corrupt row",
      source,
      destination: dest,
      struckClaim: height.id,
    });
    const view = await dest.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect(view.errors).toBeUndefined();
    const plant = view.data?.plant as { height: unknown; tag: unknown };
    expect(plant.height).toBeNull();
    expect(plant.tag).toEqual(["shade"]);
    await dest.close();
    await source.close();
  });

  it("an UNPARSEABLE row is a squatter too — the pen reason that cannot name its own strike", async () => {
    const { path, vault } = await plantedPair();
    const before = rowOf(path, bystander.id);
    corruptClaims(path, strike.id);

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    await store.heal();
    await store.close();

    expect(store.lastRestore).toEqual({ restored: [strike.id], stranded: [], replantWithheld: [] });
    expect(rowOf(path, strike.id)?.claims).toBe(JSON.stringify(claimsToJson(strike.claims)));
    expect(rowOf(path, bystander.id)).toEqual(before);

    const source = await healthySource();
    const dest = await Gateway.boot(new SqliteBackend(path), GENESIS());
    assertPreservesSuppression({
      what: "heal replacing an UNPARSEABLE row from the archive",
      source,
      destination: dest,
      struckClaim: height.id,
    });
    const view = await dest.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((view.data?.plant as { height: unknown }).height).toBeNull();
    expect((view.data?.plant as { tag: unknown }).tag).toEqual(["shade"]);
    await dest.close();
    await source.close();
  });

  it("a genuinely-new archive delta is planted in the SAME heal that repairs a corrupt row, and the journal does not serve it", async () => {
    const { path, vault } = await plantedPair();
    const arrival = observed(FERN, "tag", "fronds", 1600, OP_SEED);
    const cold = new ArchiveBackend(vault);
    await cold.append([arrival]);
    await cold.close();
    corruptSig(path, strike.id);

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    const report = await store.heal();
    await store.close();

    expect(store.lastRestore).toEqual({ restored: [strike.id], stranded: [], replantWithheld: [] });
    expect(report.toPrimary).toBe(1);
    expect(rowOf(path, arrival.id)?.sig).toBe(arrival.sig);

    const dest = await Gateway.boot(new SqliteBackend(path), GENESIS());
    const view = await dest.query(`{ plant(entity: "${FERN}") { height tag } }`);
    const plant = view.data?.plant as { height: unknown; tag: unknown };
    expect(plant.tag).toEqual(["shade"]);
    expect(dest.rowsOutsideJournal).toBe(1);
    expect(plant.height).toBeNull();
    await dest.close();
  });

  it("a healthy pair heals SILENTLY and stays idempotent — the mechanism never fires on its own", async () => {
    const { path, vault } = await plantedPair();
    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    await store.heal();
    expect(store.lastRestore).toEqual({ restored: [], stranded: [], replantWithheld: [] });
    const second = await store.heal();
    expect(store.lastRestore).toEqual({ restored: [], stranded: [], replantWithheld: [] });
    expect(second.toPrimary).toBe(0);
    await store.close();
  });
});

describe("T66: the fixed-width id assumption heal's candidate match rests on", () => {
  it("DELTA_ID_LENGTH is a real delta id's length, and DELTA_ID accepts it", () => {
    for (const d of [height, bystander, strike]) {
      expect(d.id).toHaveLength(DELTA_ID_LENGTH);
      expect(DELTA_ID.test(d.id)).toBe(true);
      expect(d.id.slice(-DELTA_ID_LENGTH)).toBe(d.id);
      expect(`loam:garden:${d.id}`.slice(-DELTA_ID_LENGTH)).toBe(d.id);
    }
  });
});

describe("T66: an ADMITTED row is never replaced, and damage is never laundered inward", () => {
  it("an UNSIGNED twin of a healthy signed row is refused — a repair is not a signature downgrade", async () => {
    const dir = freshDir();
    const path = join(dir, "store.sqlite");
    const store = new SqliteBackend(path);
    await store.append([height, bystander]);
    const unsigned = makeDelta(height.claims);
    expect(unsigned.id).toBe(height.id);
    expect(unsigned.sig).toBeUndefined();

    expect(await store.restoreQuarantined([unsigned])).toEqual([]);
    await store.close();
    expect(rowOf(path, height.id)?.sig).toBe(height.sig);
    expect(rowOf(path, bystander.id)?.sig).toBe(bystander.sig);
  });

  it("an incoming delta that does not itself ADMIT never overwrites the corrupt row it names", async () => {
    const dir = freshDir();
    const path = join(dir, "store.sqlite");
    const store = new SqliteBackend(path);
    await store.append([height, bystander, strike]);
    await store.close();
    corruptSig(path, strike.id);
    const corrupt = rowOf(path, strike.id);

    const reopened = new SqliteBackend(path);
    const forged: Delta = { ...strike, claims: bystander.claims };
    const badSig: Delta = { ...strike, sig: "cd".repeat(64) };
    expect(await reopened.restoreQuarantined([forged, badSig])).toEqual([]);
    await reopened.close();

    expect(rowOf(path, strike.id)).toEqual(corrupt);
    expect(rowOf(path, bystander.id)?.sig).toBe(bystander.sig);
  });

  it("judges the existing row from the TABLE, not from its own pen — the stale-pen window", async () => {
    const dir = freshDir();
    const path = join(dir, "store.sqlite");
    const seeded = new SqliteBackend(path);
    await seeded.append([height, bystander, strike]);
    await seeded.close();
    corruptSig(path, strike.id);

    const store = new SqliteBackend(path);
    await store.deltasSince(new Set());
    expect((await store.quarantine()).map((r) => r.key)).toEqual([strike.id]);
    healRowOutOfBand(path, strike);
    const unsigned = makeDelta(strike.claims);

    expect(await store.restoreQuarantined([unsigned])).toEqual([]);
    await store.close();
    expect(rowOf(path, strike.id)?.sig).toBe(strike.sig);
    expect(rowOf(path, bystander.id)?.sig).toBe(bystander.sig);
  });

  it("a row that is not there is not INSERTED — restore replaces, it never plants", async () => {
    const dir = freshDir();
    const store = new SqliteBackend(join(dir, "store.sqlite"));
    await store.append([height]);
    expect(await store.restoreQuarantined([strike])).toEqual([]);
    expect(await store.holds(strike.id)).toBe(false);
    await store.close();
  });
});

describe("T66: heal REPORTS a restore it could not make, rather than reporting success", () => {
  const pennedPrimary = (
    inner: StoreBackend,
    pennedId: string,
    restore?: (deltas: Iterable<Delta>) => Promise<readonly string[]>,
  ): RepairableBackend => ({
    append: (d) => inner.append(d),
    deltasSince: async (k) => (await inner.deltasSince(k)).filter((d) => d.id !== pennedId),
    purge: (ids) => inner.purge(ids),
    holds: (id) => inner.holds(id),
    close: () => inner.close(),
    quarantine: () =>
      Promise.resolve([{ key: pennedId, reason: "invalid-signature" as const, preview: "…" }]),
    discardRow: () => Promise.resolve(false),
    ...(restore === undefined ? {} : { restoreQuarantined: restore }),
  });

  const withMirror = async (primary: RepairableBackend): Promise<MirrorBackend> => {
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    return new MirrorBackend(primary, vault);
  };

  it("a driver with NO restore capability is named, not silently skipped", async () => {
    const inner = new MemoryBackend();
    await inner.append([height, bystander]);
    const store = await withMirror(pennedPrimary(inner, strike.id));

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    await store.close();
  });

  it("a driver that CLAIMS a restore the pen contradicts is refused — the return value is not the verdict", async () => {
    const inner = new MemoryBackend();
    await inner.append([height, bystander]);
    const store = await withMirror(
      pennedPrimary(inner, strike.id, () => Promise.resolve([strike.id])),
    );

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    await store.close();
  });

  it("a driver that repairs ONE id and mis-reports another is SPLIT across the two lists", async () => {
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const penned = new Set([height.id, strike.id]);
    const repaired = new Set<string>();
    const primary: RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: async (k) =>
        (await inner.deltasSince(k)).filter((d) => !penned.has(d.id) || repaired.has(d.id)),
      purge: (ids) => inner.purge(ids),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
      quarantine: () =>
        Promise.resolve(
          [...penned]
            .filter((id) => !repaired.has(id))
            .map((id) => ({ key: id, reason: "invalid-signature" as const, preview: "…" })),
        ),
      discardRow: () => Promise.resolve(false),
      restoreQuarantined: async (deltas) => {
        await inner.append([...deltas].filter((d) => d.id === height.id));
        repaired.add(height.id);
        return [height.id, strike.id];
      },
    };
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([height.id]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    await store.close();
  });
});
