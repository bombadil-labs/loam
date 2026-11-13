import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, detachClaims } from "../../src/gateway/container-law.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "3d".repeat(32);
const OP = authorForSeed(OP_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-container-compat-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const genesis = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });

describe("a previous-format store is refused, not booted empty", () => {
  it("boot refuses the pre-0.11 fixture, and plants nothing beside it", async () => {
    const golden = join("test", "fixtures", "pre-t32");
    const expected = JSON.parse(readFileSync(join(golden, "expected.json"), "utf8")) as {
      ids: string[];
    };
    const path = join(tmp, "pre-mint.db");
    copyFileSync(join(golden, "store.db"), path);
    const refused = new SqliteBackend(path);
    await expect(Gateway.boot(refused, genesis())).rejects.toThrow(
      /holds rows but no peer journal.*earlier Loam/s,
    );
    await refused.close();

    const backend = new SqliteBackend(path);
    expect(await backend.deltasSince(new Set())).toEqual([]);
    const rows = (await backend.quarantine()).map((r) => r.key).sort();
    expect(rows).toEqual(expected.ids);
    await backend.close();
  });

  it("a store with one damaged admitted row still opens; the row is set aside, the rest served", async () => {
    const path = join(tmp, "one-bad-row.db");
    const first = await Gateway.boot(new SqliteBackend(path), genesis());
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "height", 31, 1001, OP_SEED);
    await first.append([fact, bystander]);
    await first.close();
    const raw = new Database(path);
    raw.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run("{", fact.id);
    raw.close();

    const backend = new SqliteBackend(path);
    const gw = await Gateway.open(backend, { seed: OP_SEED });
    expect(gw.reactor.get(fact.id)).toBeUndefined();
    expect(gw.reactor.get(bystander.id)).toBeDefined();
    expect((await backend.quarantine()).map((r) => r.key)).toContain(fact.id);
    await gw.close();
  });

  it("a row written around the door is outside the journal: counted, never served", async () => {
    const path = join(tmp, "around-the-door.db");
    const first = await Gateway.boot(new SqliteBackend(path), genesis());
    await first.close();
    const planted = observed(FERN, "height", 32, 1002, OP_SEED);
    const raw = new Database(path);
    raw
      .prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)")
      .run(planted.id, JSON.stringify(planted.claims), planted.sig ?? null);
    raw.close();

    const gw = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
    expect(gw.rowsOutsideJournal).toBe(1);
    expect(gw.reactor.get(planted.id)).toBeUndefined();
    await gw.close();
  });
});

describe("T32 criteria 15 & 22 — an unreachable wall is a named fault", () => {
  const unreachableWall = async (trust: "untrusted" | "curated"): Promise<void> => {
    const primaryPath = join(tmp, `primary-${trust}.db`);
    const wallPath = join(tmp, `wall-${trust}.db`);
    const name = `container:${trust}-away`;

    const gw1 = await Gateway.boot(new SqliteBackend(primaryPath), genesis());
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw1.append([fact]);
    await gw1.append([
      signClaims(
        containerClaims({ container: name, trust, posture: "separate" }, OP, 28_000),
        OP_SEED,
      ),
    ]);
    const c = await gw1.openContainer({ name, backend: new SqliteBackend(wallPath) });
    expect(c.gateway).toBeDefined();
    await gw1.close();
    await c.gateway!.close();

    const gw2 = await Gateway.open(new SqliteBackend(primaryPath), { seed: OP_SEED });
    await expect(gw2.erase(fact.id)).rejects.toThrow(new RegExp(name));

    await gw2.append([
      signClaims(detachClaims(name, `parked at ${wallPath}`, OP, 28_100), OP_SEED),
    ]);
    await expect(gw2.erase(fact.id)).resolves.toMatchObject({
      erased: fact.id,
      kept: [name],
    });
    await gw2.close();
  };

  it("an unreachable UNTRUSTED wall refuses the completeness report (criterion 15)", () =>
    unreachableWall("untrusted"));

  it("an unreachable CURATED wall refuses identically — bytes follow posture (criterion 22)", () =>
    unreachableWall("curated"));

  it("an anonymous pool never triggers the guard — it has no declaration to name", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([fact]);
    const pool = await gw.openQuarantine();
    await pool.detach();
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id, kept: [] });
    await gw.close();
  });
});
