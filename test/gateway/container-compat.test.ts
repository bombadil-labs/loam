// T32 — nothing at rest changed meaning, and the sweep confesses its blind spots (criteria 11,
// 15, 22). The mint is new vocabulary ONLY: a store written entirely by the previous release
// opens under the lifted code with identical delta ids and identical resolved views — no §20
// step, proven rather than promised. And because the mint makes containers enumerable AT REST
// while erase fans out over the ATTACHED set, the honest rule ships with it: erase refuses to
// report completeness while the resolved table names a WALL-posture container — untrusted OR
// curated, since bytes follow posture — that is neither attached nor covered by a surviving
// detach record. An unreachable wall is a named fault, never a silent gap.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("T32 criterion 11 — no §20 step needed, proven", () => {
  it("the previous release's actual bytes open with identical ids and identical resolved views", async () => {
    // The golden store at test/fixtures/pre-t32/ was WRITTEN BY MAIN'S OWN CODE (a probe
    // worktree at the pre-T32 revision ran the generator; expected.json captured that build's
    // ids and resolved view). This is the byte-for-byte previous-release fixture the criterion
    // demands — a store both sessions of the LIFTED build wrote would prove only
    // reopen-idempotence, and would stay green through exactly the regression class a §20 step
    // exists for. Regenerate deliberately, from a pre-T32 revision, never from this branch.
    const golden = join("test", "fixtures", "pre-t32");
    const expected = JSON.parse(readFileSync(join(golden, "expected.json"), "utf8")) as {
      ids: string[];
      view: unknown;
    };
    const path = join(tmp, "pre-mint.db");
    copyFileSync(join(golden, "store.db"), path); // never write beside the checked-in artifact

    const after = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
    after.replayRegistrations();
    await after.preloadResolvers();
    expect([...after.reactor.snapshot()].map((d) => d.id).sort()).toEqual(expected.ids);
    const viewAfter = await after.query(`{ Plant(entity: "${FERN}") { height tag } }`);
    expect(viewAfter).toEqual(expected.view);
    const table = after.containers();
    expect(table.containers.size).toBe(0);
    expect(table.defects).toEqual([]);
    await after.close();
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
      signClaims(containerClaims({ container: name, trust, posture: "wall" }, OP, 28_000), OP_SEED),
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
