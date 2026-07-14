// SPEC §25's contract at the gateway: boot DEGRADES, it does not abort. A store that has met a
// stray key, a devtools edit, or a torn write still opens — the bad row is quarantined by the
// read, and every readable fact resolves. The one loud exception is the constitutional core: if
// the operator marker (who governs this store) is itself unreadable, boot refuses, because a
// store that cannot know its own constitution must not pretend to.

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
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-boot-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

let n = 0;
function storePath(): string {
  return join(tmp, `boot-${n++}.sqlite`);
}

// Reach behind the seam and swap in another delta's well-formed claims — the row is valid in
// shape but no longer recomputes to its own id, exactly a torn sync or a devtools scribble.
function corruptClaims(path: string, id: string, claims: unknown): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(JSON.stringify(claims), id);
  db.close();
}

// A governed store, booted from genesis (which plants the operator marker), holding two
// operator-authored facts on the fern. Returns the path so a test can damage a row behind the seam.
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
    // Damage fact `a` behind the seam — swap in fact `b`'s claims, so `a`'s row no longer
    // recomputes to `a`'s id.
    corruptClaims(path, a.id, claimsToJson(b.claims));

    const backend = new SqliteBackend(path);
    const gateway = await Gateway.open(backend, { seed: OP_SEED }); // boots — no throw
    gateway.register(PLANT, PLANT_POLICY, [FERN]);

    // The surviving fact resolves; the quarantined row contributes to no view.
    const answer = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(answer.errors).toBeUndefined();
    expect((answer.data as { plant: { height: number } }).plant.height).toBe(34); // b survived, a is gone

    // The bad row sits in the pen, named, for `loam repair`.
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
    // offeredDeltas is the ground; the corrupt fact is simply absent from it, indistinguishable
    // from a delta that has not synced yet — the property that makes quarantine safe.
    expect(gateway.offeredDeltas().some((d) => d.id === a.id)).toBe(false);
    expect(gateway.offeredDeltas().length).toBeGreaterThan(0); // the marker, the seed's genesis, fact b
    await gateway.close();
  });

  it("the constitutional core is the loud exception: an unreadable operator marker refuses boot", async () => {
    const { path } = await plantedStore();
    const markerId = computeId(operatorMarkerClaims(OPERATOR));
    // Damage the marker itself — the row that says who governs this store.
    corruptClaims(path, markerId, claimsToJson(observed(FERN, "height", 1, 1, OP_SEED).claims));
    // open throws before it can adopt the backend, so close the handle ourselves (else the file
    // stays locked on Windows).
    const backend = new SqliteBackend(path);
    await expect(Gateway.open(backend, { seed: OP_SEED })).rejects.toThrow(
      /constitutional core unreadable/,
    );
    await backend.close();
  });
});
