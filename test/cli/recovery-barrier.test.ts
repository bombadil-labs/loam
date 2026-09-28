// The recovery barrier as `loam user recover` runs it (refactor/audit/recovery-history.md, H3-H5,
// H8; H6 is in user-recover.test.ts). Each case reads both levels: the cut and outcome records each
// store holds, and what the door and the pause make of them.

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { recoverUser, type RecoverOptions } from "../../src/cli/user-recover.js";
import { containerClaims } from "../../src/gateway/container.js";
import { refusedIds } from "../../src/gateway/erase.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { cutsHere, hasOutcome, pausedKeys } from "../../src/gateway/recovery-cut.js";
import { userGroundOf, userRootAt } from "../../src/gateway/user-root.js";
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
function cutsOf(g: Gateway, op: string, key: string) {
  const erased = refusedIds(g.reactor, op);
  return cutsHere(g.reactor, op, erased)
    .filter((c) => c.key === key)
    .map((c) => ({
      state: c.state,
      outcome: hasOutcome(g.reactor, op, c.delta.id, erased),
    }));
}
const pool = (gw: Gateway, name: string): Gateway => gw.connectionInboxes.get(name)!.gateway!;
const paused = (g: Gateway, op: string) => pausedKeys(g.reactor, op, refusedIds(g.reactor, op));

describe("the recovery barrier", () => {
  it("a completed recovery leaves a committed cut with its outcome in the host and every pool", async () => {
    const { k1, pool: p } = await world();
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw, op) => {
      for (const g of [gw, pool(gw, p)]) {
        expect(cutsOf(g, op, k1)).toEqual([{ state: "committed", outcome: true }]);
        expect(paused(g, op).has(k1)).toBe(false);
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
    await ground((gw, op) => {
      expect(cutsOf(pool(gw, p), op, k1)).toEqual([{ state: "prepared", outcome: false }]);
      expect(paused(pool(gw, p), op).has(k1)).toBe(true);
      expect(cutsOf(gw, op, k1)).toEqual([]); // the host cut rides in the commit, which never ran
    });
    expect(await recoverUser(direct())).toBe(1);
    expect(err.join("\n")).toMatch(/did not land/);
    expect(existsSync(journal())).toBe(false);
    expect(seedKey()).toBe(k1);
    await ground((gw, op) => {
      expect(
        userRootAt(gw.reactor, gw.validityNow(), op, "ada", userGroundOf(gw.reactor).erased()),
      ).toBe(k1);
      expect(cutsOf(pool(gw, p), op, k1)).toEqual([{ state: "aborted", outcome: true }]);
      expect(paused(pool(gw, p), op).has(k1)).toBe(false);
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
    await ground((gw, op) => {
      expect(cutsOf(pool(gw, p), op, k1)).toEqual([{ state: "committed", outcome: false }]);
      expect(paused(pool(gw, p), op).has(k1)).toBe(false);
      expect(cutsOf(gw, op, k1)).toEqual([{ state: "committed", outcome: true }]);
    });
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw, op) => {
      expect(cutsOf(pool(gw, p), op, k1)).toEqual([{ state: "committed", outcome: true }]);
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
    expect(err.join("\n")).toMatch(/other inbox pools/);
    expect(existsSync(journal())).toBe(false);
    expect(seedKey()).toBe(k1);
    await ground((gw, op) => {
      expect(cutsOf(pool(gw, p), op, k1)).toEqual([{ state: "aborted", outcome: true }]);
      expect(paused(pool(gw, p), op).has(k1)).toBe(false);
    });
    err.length = 0;
    expect(await recoverUser(direct())).toBe(0);
    await ground((gw, op) => {
      for (const g of [gw, pool(gw, p), pool(gw, late)]) {
        expect(cutsOf(g, op, k1).filter((c) => c.state === "committed")).toEqual([
          { state: "committed", outcome: true },
        ]);
      }
    });
  });

  it("H8: after a restart, arrival order, cuts, outcomes and pauses read the same", async () => {
    const { k1, pool: p } = await world();
    expect(await recoverUser(direct())).toBe(0);
    const read = () =>
      ground((gw, op) =>
        [gw, pool(gw, p)].map((g) => ({
          log: g.reactor.arrivalLog().map((d: Delta) => d.id),
          cuts: cutsHere(g.reactor, op, refusedIds(g.reactor, op)).map((c) => ({
            id: c.delta.id,
            index: c.index,
            state: c.state,
          })),
          paused: [...paused(g, op)],
          k1: k1,
        })),
      );
    const first = await read();
    expect(first.every((s) => s.cuts.length === 1)).toBe(true);
    expect(await read()).toEqual(first);
  });
});
