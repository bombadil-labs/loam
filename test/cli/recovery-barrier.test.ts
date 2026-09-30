// The recovery barrier as `loam user recover` runs it (refactor/audit/recovery-history.md, H3-H5,
// H8; H6 is in user-recover.test.ts). Each case reads both levels: the cut and outcome records each
// store holds, and what the door and the pause make of them.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { appendWithHostCut } from "../helpers/recovery-cut.js";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { recoverUser, type RecoverOptions } from "../../src/cli/user-recover.js";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { FERN, observed } from "../spike/garden.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { refusedIds } from "../../src/gateway/erase.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { cutsHere, outcomeClaims, outcomesOf, pausedKeys } from "../../src/gateway/recovery-cut.js";
import {
  lineageClaims,
  recoveryClaims,
  userGroundOf,
  userRootAt,
} from "../../src/gateway/user-root.js";
import { rootClaims } from "../../src/server/users.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { ScryptParams } from "../../src/server/credentials.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
const CHEAP: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP };
const CONN = authorForSeed("c7".repeat(32));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-recovery-barrier-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const journal = () => `${userSeedPath(home, "ada")}.recovery`;
const seedKey = (): string | undefined => {
  const r = readUserSeed(home, "ada");
  return r.kind === "present" ? authorForSeed(r.seed) : undefined;
};

async function ground<T>(fn: (gw: Gateway, op: string) => T | Promise<T>): Promise<T> {
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
    { channelBackend: channelBackendFor(home, io) },
  );
  try {
    return await fn(gw, authorForSeed(seed));
  } finally {
    await gw.close();
  }
}

// ada with a key file and one connection inbox under home:ada. Returns K1 and the pool's name.
async function world(): Promise<{ k1: string; pool: string }> {
  expect(await run(["init", "--home", home], io)).toBe(0);
  expect(await run(["user", "create", "ada", "--operator", "--home", home], io, password)).toBe(0);
  const adaSeed = readUserSeed(home, "ada");
  if (adaSeed.kind !== "present") throw new Error("ada has a key file");
  const k1 = authorForSeed(adaSeed.seed);
  const pool = await ground(async (gw, op) => {
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: k1 } },
              in: "input",
            },
          },
          op,
          gw.stamp(op).timestamp,
        ),
        readSeed(home),
      ),
    ]);
    const inbox = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: adaSeed.seed,
      ownerName: "ada",
    });
    return inbox.entity!;
  });
  return { k1, pool };
}

const direct = (extra: Partial<RecoverOptions> = {}): RecoverOptions => ({
  home,
  name: "ada",
  replaceSeed: true,
  storePath: storePath(home),
  io,
  openBackend: (path) => new SqliteBackend(path),
  channelBackend: channelBackendFor(home, io),
  ...extra,
});

// What one store says about the cuts for `key`: each cut's state and whether it has an outcome.
// Each store reads its own law, signed by its own governing key.
function cutsOf(g: Gateway, key: string) {
  const op = g.operatorAuthor!;
  const erased = refusedIds(g.reactor, op);
  return cutsHere(g.reactor, op, erased)
    .filter((c) => c.key === key)
    .map((c) => ({
      state: c.state,
      outcome: [...outcomesOf(g.reactor, op, c.delta.id, erased)].sort().join(",") || "none",
    }));
}
const pool = (gw: Gateway, name: string): Gateway => gw.connectionInboxes.get(name)!.gateway!;
const paused = (g: Gateway) => {
  const op = g.operatorAuthor!;
  return pausedKeys(g.reactor, op, refusedIds(g.reactor, op));
};

describe("the recovery barrier", () => {
  it("a completed recovery leaves a committed cut with its outcome in the host and every pool", async () => {
    const { k1, pool: p } = await world();
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw) => {
      for (const g of [gw, pool(gw, p)]) {
        expect(cutsOf(g, k1)).toEqual([{ state: "committed", outcome: "committed" }]);
        expect(paused(g).has(k1)).toBe(false);
      }
    });
  });

  it("H3: a crash after the cuts and before the commit pauses the pool; the rerun aborts and rolls back", async () => {
    const { k1, pool: p } = await world();
    await expect(
      recoverUser(
        direct({
          afterCuts: () => {
            throw new Error("the machine stopped");
          },
        }),
      ),
    ).rejects.toThrow(/machine stopped/);
    expect(existsSync(journal())).toBe(true);
    await ground((gw) => {
      expect(cutsOf(pool(gw, p), k1)).toEqual([{ state: "prepared", outcome: "none" }]);
      expect(paused(pool(gw, p)).has(k1)).toBe(true);
      expect(cutsOf(gw, k1)).toEqual([]); // the host cut rides in the commit, which never ran
    });
    expect(await recoverUser(direct())).toBe(1);
    expect(err.join("\n")).toMatch(/did not land/);
    expect(existsSync(journal())).toBe(false);
    expect(seedKey()).toBe(k1);
    await ground((gw, op) => {
      expect(
        userRootAt(gw.reactor, gw.validityNow(), op, "ada", userGroundOf(gw.reactor).erased()),
      ).toBe(k1);
      expect(cutsOf(pool(gw, p), k1)).toEqual([{ state: "aborted", outcome: "aborted" }]);
      expect(paused(pool(gw, p)).has(k1)).toBe(false);
    });
  });

  it("H4: a crash after the commit and before the outcomes: the pool reads its cut committed, and the rerun writes the outcome", async () => {
    const { k1, pool: p } = await world();
    // The pool attaches for the recovery and not for its own resume: the outcome cannot land.
    const real = channelBackendFor(home, io);
    let opens = 0;
    const once = (name: string): StoreBackend =>
      (opens++ === 0 ? real(name) : undefined) as unknown as StoreBackend;
    expect(await recoverUser(direct({ channelBackend: once }))).toBe(1);
    expect(err.join("\n")).toMatch(/PENDING/);
    await ground((gw) => {
      expect(cutsOf(pool(gw, p), k1)).toEqual([{ state: "committed", outcome: "none" }]);
      expect(paused(pool(gw, p)).has(k1)).toBe(false);
      expect(cutsOf(gw, k1)).toEqual([{ state: "committed", outcome: "committed" }]);
    });
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw) => {
      expect(cutsOf(pool(gw, p), k1)).toEqual([{ state: "committed", outcome: "committed" }]);
    });
  });

  it("H5: a pool declared between the cuts and the commit: the host refuses the record, the cuts abort, the rerun covers both", async () => {
    const { k1, pool: p } = await world();
    const late = `${p}:late`;
    const declare = async (gw: Gateway) => {
      const op = gw.operator!;
      await gw.append([
        signClaims(
          containerClaims(
            { container: late, trust: "curated", posture: "separate", inboxOf: "home:ada" },
            op,
            gw.stamp(op).timestamp,
          ),
          readSeed(home),
        ),
      ]);
    };
    expect(await recoverUser(direct({ afterCuts: declare }))).toBe(1);
    expect(err.join("\n")).toMatch(
      /holds no live cut for it in its manifest \(or is not attached\)/,
    );
    expect(existsSync(journal())).toBe(false);
    expect(seedKey()).toBe(k1);
    await ground((gw) => {
      expect(cutsOf(pool(gw, p), k1)).toEqual([{ state: "aborted", outcome: "aborted" }]);
      expect(paused(pool(gw, p)).has(k1)).toBe(false);
    });
    err.length = 0;
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw) => {
      for (const g of [gw, pool(gw, p), pool(gw, late)]) {
        expect(cutsOf(g, k1).filter((c) => c.state === "committed")).toEqual([
          { state: "committed", outcome: "committed" },
        ]);
      }
    });
  });

  it("H8: after a restart, arrival order, cuts, outcomes and pauses read the same", async () => {
    const { k1, pool: p } = await world();
    expect(await recoverUser(direct())).toBe(0);
    const read = () =>
      ground((gw) =>
        [gw, pool(gw, p)].map((g) => ({
          log: g.reactor.arrivalLog().map((d: Delta) => d.id),
          cuts: cutsHere(g.reactor, g.operatorAuthor, refusedIds(g.reactor, g.operatorAuthor)).map(
            (c) => ({
              id: c.delta.id,
              index: c.index,
              state: c.state,
            }),
          ),
          paused: [...paused(g)],
          k1: k1,
        })),
      );
    const first = await read();
    expect(first.every((s) => s.cuts.length === 1)).toBe(true);
    expect(await read()).toEqual(first);
  });

  it("the host door refuses a retiring record whose pools hold no cut, even with the host's own", async () => {
    const { k1, pool: p } = await world();
    const seed = readSeed(home);
    await ground(async (gw, op) => {
      const k2 = authorForSeed("d2".repeat(32));
      const t = gw.stamp(op).timestamp;
      const record = signClaims(
        recoveryClaims({ name: "ada", attempt: "x", previous: k1, root: k2, retired: [k1] }, op, t),
        seed,
      );
      const commit = [
        record,
        signClaims(
          lineageClaims({ name: "ada", recovery: record.id, root: k2, retired: [k1] }, op, t),
          seed,
        ),
        signClaims(rootClaims("ada", k2, op, t), seed),
      ];
      await expect(appendWithHostCut(gw, seed, commit)).rejects.toThrow(
        new RegExp(
          `${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} holds no live cut for it in its manifest`,
        ),
      );
      expect(gw.reactor.get(record.id)).toBeUndefined();
      expect(
        userRootAt(gw.reactor, gw.validityNow(), op, "ada", userGroundOf(gw.reactor).erased()),
      ).toBe(k1);
    });
  });

  it("a contrary outcome is a conflict: the rerun reports it, keeps the journal, and claims nothing", async () => {
    const { k1, pool: p } = await world();
    const real = channelBackendFor(home, io);
    let opens = 0;
    const once = (name: string): StoreBackend =>
      (opens++ === 0 ? real(name) : undefined) as unknown as StoreBackend;
    expect(await recoverUser(direct({ channelBackend: once }))).toBe(1); // the pool's outcome waits
    await ground(async (gw) => {
      const g = pool(gw, p);
      const op = g.operatorAuthor!;
      const [cut] = cutsHere(g.reactor, op, refusedIds(g.reactor, op)).filter((c) => c.key === k1);
      await g.append([
        g.signer!.sign(outcomeClaims(cut!.delta.id, "aborted", op, g.stamp(op).timestamp)),
      ]);
    });
    out.length = 0;
    err.length = 0;
    expect(await recoverUser(direct())).toBe(1);
    expect(err.join("\n")).toMatch(/a conflict in .*reads aborted, not committed/);
    expect(out.join("\n")).toMatch(/now signs with/); // the landing is reported, never completion
    expect(existsSync(journal())).toBe(true);
    await ground((gw) => {
      expect(cutsOf(pool(gw, p), k1)).toEqual([{ state: "aborted", outcome: "aborted" }]);
    });
  });
});

describe("other writers during a recovery", () => {
  const recoverCli = () => run(["user", "recover", "ada", "--replace-seed", "--home", home], io);
  const serving = (pid: number) =>
    writeFileSync(
      join(home, "serving.json"),
      `${JSON.stringify({ pid, url: "http://127.0.0.1:1", store: storePath(home) })}\n`,
    );
  const deadPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid;

  it("recover refuses while a live server serves the store, and writes nothing", async () => {
    const { k1 } = await world();
    serving(process.pid);
    expect(await recoverCli()).toBe(2);
    expect(err.join("\n")).toMatch(/is serving this store right now.*accepting the old key/);
    expect(existsSync(journal())).toBe(false);
    expect(seedKey()).toBe(k1);
  });

  it("a crashed server's record does not block recover", async () => {
    const { k1 } = await world();
    serving(deadPid());
    expect(await recoverCli()).toBe(0);
    expect(seedKey()).not.toBe(k1);
  });

  it("a second writer that booted before the recovery: the old key's later write is refused and never history", async () => {
    const { k1 } = await world();
    const k1Seed = readUserSeed(home, "ada");
    if (k1Seed.kind !== "present") throw new Error("ada has a key file");
    const seed = readSeed(home);
    // Booted before the recovery, this handle still reads k1 as ada's root.
    const stale = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
      { channelBackend: channelBackendFor(home, io) },
    );
    let before: Delta, after: Delta;
    try {
      before = observed(FERN, "height", 1, stale.stamp(k1).timestamp, k1Seed.seed);
      await stale.append([before]);
      expect(await recoverUser(direct())).toBe(0);
      after = observed(FERN, "height", 2, stale.stamp(k1).timestamp, k1Seed.seed);
      // The stale handle's journal head moved, so it takes in the recovery before it admits, and
      // the old key's write is refused.
      await expect(stale.append([after])).rejects.toThrow(/not permitted/);
    } finally {
      await stale.close();
    }
    await ground((gw) => {
      const m = new Set(gw.select(writtenByUser("ada", "home:ada")).map((d) => d.id));
      expect([m.has(before.id), m.has(after.id)]).toEqual([true, false]);
    });
  });

  it("a pool another writer declares during the recovery: the host catches up, refuses the record, and a rerun cuts it", async () => {
    const { k1, pool: p } = await world();
    const late = `${p}:late`;
    const seed = readSeed(home);
    const declareElsewhere = async () => {
      const other = await Gateway.boot(
        new SqliteBackend(storePath(home)),
        assembleGenesis({ operatorSeed: seed }),
      );
      try {
        const op = other.operator!;
        await other.append([
          signClaims(
            containerClaims(
              { container: late, trust: "curated", posture: "separate", inboxOf: "home:ada" },
              op,
              other.stamp(op).timestamp,
            ),
            seed,
          ),
        ]);
      } finally {
        await other.close();
      }
    };
    // The host journal moved under the command, so it takes in the new pool before it admits.
    // The door then sees a pool with no cut and refuses the record; nothing lands.
    expect(await recoverUser(direct({ afterCuts: declareElsewhere }))).toBe(1);
    expect(err.join("\n")).toMatch(new RegExp(`${late}.*holds no live cut`));
    expect(seedKey()).toBe(k1);
    // A rerun cuts every pool, the late one included, and lands.
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw) => {
      expect(cutsOf(pool(gw, late), k1)).toEqual([{ state: "committed", outcome: "committed" }]);
      // The refused attempt's cut in the first pool is aborted; the rerun's is committed.
      expect(cutsOf(pool(gw, p), k1).sort((a, b) => a.state.localeCompare(b.state))).toEqual([
        { state: "aborted", outcome: "aborted" },
        { state: "committed", outcome: "committed" },
      ]);
    });
  });
});
