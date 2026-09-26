// T32 — the sweep confesses its blind spots (criteria 15, 22). Because the mint makes containers
// enumerable AT REST while erase fans out over the ATTACHED set, the honest rule ships with it:
// erase refuses to report completeness while the resolved table names a WALL-posture container — untrusted OR
// curated, since bytes follow posture — that is neither attached nor covered by a surviving
// detach record. An unreachable wall is a named fault, never a silent gap.

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
import { containerClaims, detachClaims } from "../../src/gateway/container.js";
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

// Greenfield (refactor/README.md): no migration and no backward compatibility. A store written
// before rhizomatic 0.11 carries claims without `validFrom`, and this build reads none of it. Boot
// refuses such a store rather than planting a genesis beside it. The second case is the
// bystander: a store with one unreadable row among readable ones still opens (§25). Deliberately
// not refused: `Gateway.open` alone, because a pool may hold only unreadable rows.
describe("a previous-format store is refused, not booted empty", () => {
  it("boot refuses the pre-0.11 fixture, and plants nothing beside it", async () => {
    const golden = join("test", "fixtures", "pre-t32");
    const expected = JSON.parse(readFileSync(join(golden, "expected.json"), "utf8")) as {
      ids: string[];
    };
    const path = join(tmp, "pre-mint.db");
    copyFileSync(join(golden, "store.db"), path); // never write beside the checked-in artifact
    await expect(Gateway.boot(new SqliteBackend(path), genesis())).rejects.toThrow(
      /8 rows and none of them is readable.*before rhizomatic 0\.11/s,
    );

    const backend = new SqliteBackend(path);
    expect(await backend.deltasSince(new Set())).toEqual([]);
    const rows = (await backend.quarantine()).map((r) => r.key).sort();
    expect(rows).toEqual(expected.ids); // the old rows, and no genesis planted beside them
    await backend.close();
  });

  it("a store with one unreadable row among readable ones still opens", async () => {
    const path = join(tmp, "one-bad-row.db");
    const first = await Gateway.boot(new SqliteBackend(path), genesis());
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await first.append([fact]);
    await first.close();
    const raw = new Database(path);
    raw.prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)").run("1e20bad", "{", null);
    raw.close();

    const backend = new SqliteBackend(path);
    const gw = await Gateway.open(backend, { seed: OP_SEED });
    expect(gw.reactor.get(fact.id)).toBeDefined();
    expect((await backend.quarantine()).map((r) => r.key)).toEqual(["1e20bad"]);
    await gw.close();
  });
});

describe("T32 criteria 15 & 22 — an unreachable wall is a named fault", () => {
  const unreachableWall = async (trust: "untrusted" | "curated"): Promise<void> => {
    const primaryPath = join(tmp, `primary-${trust}.db`);
    const wallPath = join(tmp, `wall-${trust}.db`);
    const name = `container:${trust}-away`;

    // Session one: declare the wall, attach it (the bytes copy in), detach NOTHING, close.
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
    // detach() is deliberately NOT called: closing both handles with no record is the crash /
    // restart shape §24.8's premortem named — the at-rest record exists only if asked for.
    await gw1.close();
    await c.gateway!.close(); // release the wall's file handle; its bytes stay where they are

    // Session two: the table names the wall; nothing attached it. The wall's store holds the
    // fact's bytes, OUTSIDE this sweep — so erase must refuse completeness, naming the container.
    const gw2 = await Gateway.open(new SqliteBackend(primaryPath), { seed: OP_SEED });
    await expect(gw2.erase(fact.id)).rejects.toThrow(new RegExp(name));

    // A detach record covers it: the operator has said, on the record, where the debt lives.
    // The same erase now completes, the container listed as deliberately kept.
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
    // The preserved-behavior leg: today's nameless openQuarantine leaves no at-rest trace, so a
    // fresh session's erase owes it nothing. Without this, the guard could "pass" its rails by
    // faulting every store that ever opened a pool.
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([fact]);
    const pool = await gw.openQuarantine();
    await pool.detach(); // recordless, stated by the spec rather than discovered
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id, kept: [] });
    await gw.close();
  });
});
