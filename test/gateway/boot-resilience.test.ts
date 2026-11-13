import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, claimsToJson, computeId } from "@bombadil/rhizomatic";
import { assembleGenesis, operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-boot-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

let n = 0;
function storePath(): string {
  return join(tmp, `boot-${n++}.sqlite`);
}

function corruptClaims(path: string, id: string, claims: unknown): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(JSON.stringify(claims), id);
  db.close();
}

async function plantedStore(): Promise<{
  path: string;
  a: ReturnType<typeof observed>;
  b: ReturnType<typeof observed>;
}> {
  const path = storePath();
  const gateway = await Gateway.boot(
    new SqliteBackend(path),
    assembleGenesis({ operatorSeed: OP_SEED }),
  );
  const a = observed(FERN, "height", 30, 1000, OP_SEED);
  const b = observed(FERN, "height", 34, 2000, OP_SEED);
  await gateway.append([a, b]);
  await gateway.flush();
  await gateway.close();
  return { path, a, b };
}

describe("boot degrades, it does not abort (SPEC §25)", () => {
  it("a store with a corrupt fact row still boots, and every good fact resolves", async () => {
    const { path, a, b } = await plantedStore();
    corruptClaims(path, a.id, claimsToJson(b.claims));

    const backend = new SqliteBackend(path);
    const gateway = await Gateway.open(backend, { seed: OP_SEED });
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    const answer = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(answer.errors).toBeUndefined();
    expect((answer.data as { plant: { height: number } }).plant.height).toBe(34);

    const pen = await backend.quarantine();
    expect(pen.map((r) => r.reason)).toContain("id-mismatch");
    expect(pen.some((r) => r.key === a.id)).toBe(true);
    await gateway.close();
  });

  it("a partial store is a legal store: the quarantined delta reads as not-yet-synced", async () => {
    const { path, a } = await plantedStore();
    corruptClaims(path, a.id, claimsToJson(observed(FERN, "height", 99, 9000, OP_SEED).claims));
    const backend = new SqliteBackend(path);
    const gateway = await Gateway.open(backend, { seed: OP_SEED });
    expect(gateway.offeredDeltas().some((d) => d.id === a.id)).toBe(false);
    expect(gateway.offeredDeltas().length).toBeGreaterThan(0);
    await gateway.close();
  });

  it("the constitutional core is the loud exception: an unreadable operator marker refuses boot", async () => {
    const { path } = await plantedStore();
    const markerId = computeId(operatorMarkerClaims(OPERATOR));
    corruptClaims(path, markerId, claimsToJson(observed(FERN, "height", 1, 1, OP_SEED).claims));
    const backend = new SqliteBackend(path);
    await expect(Gateway.open(backend, { seed: OP_SEED })).rejects.toThrow(
      /constitutional core unreadable/,
    );
    await backend.close();
  });
});
