// `loam user recover` (step 5, PR 3e-2; refactor/audit/user-recovery.md). Driven through the real
// CLI where it can be, and through `recoverUser` with a faulty store where a failure must be forced
// on one side or the other of the operator's atomic append. Every case reads the key files, the
// journal, and the store afterwards: what the command says must be what is there.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { recoverUser, type RecoverOptions } from "../../src/cli/user-recover.js";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { keysEverOf } from "../../src/gateway/principal.js";
import { userGroundOf, userRootAt } from "../../src/gateway/user-root.js";
import { userClaims } from "../../src/server/users.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import { FERN, observed } from "../spike/garden.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
const CHEAP: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-user-recover-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const seedKey = (name: string): string | undefined => {
  const r = readUserSeed(home, name);
  return r.kind === "present" ? authorForSeed(r.seed) : undefined;
};
const journal = (name: string) => `${userSeedPath(home, name)}.recovery`;
const archives = (name: string) =>
  readdirSync(home).filter((f) => f.startsWith(`user.${name}.seed.replaced-`));

// A short-lived Gateway over the same store (the store is single-writer; never held across run()).
async function ground<T>(fn: (gw: Gateway, operator: string) => T | Promise<T>): Promise<T> {
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
const rootOfAda = () =>
  ground((gw, op) =>
    userRootAt(gw.reactor, gw.validityNow(), op, "ada", userGroundOf(gw.reactor).erased()),
  );
const holds = (key: string, verb: "write" | "admin") =>
  ground((gw, op) => holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, key, verb, op));

async function adaAndBea(): Promise<{ k1: string; bea: string }> {
  expect(await run(["init", "--home", home], io)).toBe(0);
  expect(await run(["user", "create", "ada", "--operator", "--home", home], io, password)).toBe(0);
  expect(await run(["user", "create", "bea", "--operator", "--home", home], io, password)).toBe(0);
  return { k1: seedKey("ada")!, bea: seedKey("bea")! };
}

// A store backend whose appends fail on cue, and whose reopen can fail too.
function faulty(mode: {
  append?: "before" | "after";
  reopen?: "fail";
}): RecoverOptions["openBackend"] {
  let opens = 0;
  let appendsFailed = false;
  return (path: string): StoreBackend => {
    opens += 1;
    if (mode.reopen === "fail" && opens > 1) throw new Error("the disk is not answering");
    const real = new SqliteBackend(path);
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "append" && mode.append !== undefined && !appendsFailed) {
          return async (deltas: Iterable<Delta>) => {
            const batch = [...deltas];
            // Only the recovery's own atomic append fails; genesis writes pass.
            if (!batch.some((d) => d.claims.pointers.some((p) => p.role === "attempt"))) {
              return target.append(batch);
            }
            appendsFailed = true;
            if (mode.append === "after") await target.append(batch);
            throw new Error(`the store failed ${mode.append} writing`);
          };
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  };
}
const direct = (extra: Partial<RecoverOptions>): RecoverOptions => ({
  home,
  name: "ada",
  replaceSeed: true,
  storePath: storePath(home),
  io,
  openBackend: (p) => new SqliteBackend(p),
  ...extra,
});

describe("E1: a recovery moves the user to a new key, and the old key holds nothing", () => {
  it("K2 is the root and holds admin; K1 holds nothing; K1's writes are K2's own; bea is untouched", async () => {
    const { k1, bea } = await adaAndBea();
    // A literal grant naming K1, which the recovery strikes for the record (the fence already
    // refuses K1 whatever it names).
    const literal = await ground(async (gw, op) => {
      const g = signClaims(
        grantClaims(STORE_ENTITY, k1, "write", op, gw.stamp(op).timestamp),
        readSeed(home),
      );
      await gw.append([g]);
      return g.id;
    });
    const k1RootClaims = await ground((gw) =>
      [...gw.reactor.byTarget("user:ada")].filter((id) =>
        gw.reactor
          .get(id)!
          .claims.pointers.some(
            (p) => p.role === "root" && p.target.kind === "primitive" && p.target.value === k1,
          ),
      ),
    );
    expect(k1RootClaims.length).toBeGreaterThan(0);
    expect(await run(["user", "recover", "ada", "--replace-seed", "--home", home], io)).toBe(0);
    // delta: K1's literal grant and K1's root claims are struck in the host
    await ground((gw) => {
      for (const id of [literal, ...k1RootClaims]) {
        expect(gw.reactor.negationsOf(id).length).toBeGreaterThan(0);
      }
    });
    const k2 = seedKey("ada")!;
    expect(k2).not.toBe(k1);
    // files: the old seed archived, not deleted; no journal left
    expect(archives("ada")).toHaveLength(1);
    expect(authorForSeed(readFileSync(join(home, archives("ada")[0]!), "utf8").trim())).toBe(k1);
    expect(existsSync(journal("ada"))).toBe(false);
    // the store and the door
    expect(await rootOfAda()).toBe(k2);
    expect(await holds(k2, "admin")).toBe(true);
    expect(await holds(k1, "admin")).toBe(false);
    expect(await holds(k1, "write")).toBe(false);
    expect(await holds(bea, "admin")).toBe(true);
    expect(
      await ground((gw, op) =>
        [...keysEverOf(gw.reactor, gw.validityNow(), { root: k2 }, op)].sort(),
      ),
    ).toEqual([k1, k2].sort());
    expect(out.join("\n")).toMatch(/connections do not carry over/);
  });
});

describe("E7: refusals write nothing", () => {
  it("a present key file without --replace-seed", async () => {
    const { k1 } = await adaAndBea();
    const size = await ground((gw) => gw.reactor.size);
    expect(await run(["user", "recover", "ada", "--home", home], io)).toBe(2);
    expect(err.join("\n")).toMatch(/--replace-seed/);
    expect(seedKey("ada")).toBe(k1);
    expect(existsSync(journal("ada"))).toBe(false);
    expect(await ground((gw) => gw.reactor.size)).toBe(size);
  });

  it("a user with no standing grant by name", async () => {
    expect(await run(["init", "--home", home], io)).toBe(0);
    expect(await run(["user", "create", "cy", "--home", home], io, password)).toBe(0);
    const size = await ground((gw) => gw.reactor.size);
    expect(await run(["user", "recover", "cy", "--home", home], io)).toBe(2);
    expect(err.join("\n")).toMatch(/no write or admin grant by name/);
    expect(existsSync(journal("cy"))).toBe(false);
    expect(await ground((gw) => gw.reactor.size)).toBe(size);
  });
});

describe("E8: the journal, the key files, and the append that may or may not have landed", () => {
  it("a failure BEFORE the append commits restores the old key file and leaves no journal", async () => {
    const { k1 } = await adaAndBea();
    expect(await recoverUser(direct({ openBackend: faulty({ append: "before" }) }))).toBe(1);
    expect(err.join("\n")).toMatch(/did not land/);
    expect(seedKey("ada")).toBe(k1);
    expect(archives("ada")).toEqual([]);
    expect(existsSync(journal("ada"))).toBe(false);
    expect(await rootOfAda()).toBe(k1);
  });

  it("a failure AFTER the append commits is read back and finished", async () => {
    const { k1 } = await adaAndBea();
    expect(await recoverUser(direct({ openBackend: faulty({ append: "after" }) }))).toBe(0);
    const k2 = seedKey("ada")!;
    expect(k2).not.toBe(k1);
    expect(await rootOfAda()).toBe(k2);
    expect(existsSync(journal("ada"))).toBe(false);
  });

  it("a read that cannot tell leaves everything and says PENDING; a rerun decides", async () => {
    const { k1 } = await adaAndBea();
    expect(
      await recoverUser(direct({ openBackend: faulty({ append: "before", reopen: "fail" }) })),
    ).toBe(1);
    expect(err.join("\n")).toMatch(/PENDING/);
    expect(existsSync(journal("ada"))).toBe(true);
    expect(archives("ada")).toHaveLength(1);
    expect(seedKey("ada")).not.toBe(k1);
    // The rerun reads the store, finds the attempt never landed, and rolls it back.
    err.length = 0;
    expect(await recoverUser(direct({}))).toBe(1);
    expect(err.join("\n")).toMatch(/rolled back/);
    expect(seedKey("ada")).toBe(k1);
    expect(existsSync(journal("ada"))).toBe(false);
    expect(await rootOfAda()).toBe(k1);
  });

  it("a crash after the journal and before any key file moves is rolled back by the rerun", async () => {
    const { k1 } = await adaAndBea();
    await expect(
      recoverUser(
        direct({
          afterJournal: () => {
            throw new Error("crash");
          },
        }),
      ),
    ).rejects.toThrow(/crash/);
    expect(existsSync(journal("ada"))).toBe(true);
    expect(seedKey("ada")).toBe(k1);
    expect(await recoverUser(direct({}))).toBe(1);
    expect(seedKey("ada")).toBe(k1);
    expect(existsSync(journal("ada"))).toBe(false);
    // and then a clean run recovers
    expect(await recoverUser(direct({}))).toBe(0);
    expect(await rootOfAda()).toBe(seedKey("ada"));
  });
});

describe("E6 and E9: inboxes", () => {
  const CONN_SEED = "c7".repeat(32);
  const CONN = authorForSeed(CONN_SEED);
  async function bindAdasConnection(): Promise<string> {
    const seed = readSeed(home);
    const op = authorForSeed(seed);
    const adaSeed = readUserSeed(home, "ada");
    if (adaSeed.kind !== "present") throw new Error("ada has a key file");
    const gw = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
      { channelBackend: channelBackendFor(home, io) },
    );
    try {
      await gw.append([
        signClaims(
          containerClaims(
            {
              container: "home:ada",
              trust: "curated",
              posture: "shared",
              membership: {
                op: "select",
                pred: { match: { field: "author", cmp: "eq", const: authorForSeed(adaSeed.seed) } },
                in: "input",
              },
            },
            op,
            gw.stamp(op).timestamp,
          ),
          seed,
        ),
      ]);
      const inbox = await gw.bindConnection({
        container: "home:ada",
        connectionKey: CONN,
        ownerSeed: adaSeed.seed,
        ownerName: "ada",
      });
      return inbox.entity!;
    } finally {
      await gw.close();
    }
  }
  const connWrites = (pool: string) =>
    ground(async (gw) => {
      const g = gw.connectionInboxes.get(pool)!.gateway!;
      try {
        await g.append([observed(FERN, "height", 1, g.stamp(CONN).timestamp, CONN_SEED)]);
        return true;
      } catch {
        return false;
      }
    });

  it("K1's connection is refused after recovery; K1's delegation in the inbox is struck; K2 re-binds", async () => {
    await adaAndBea();
    const pool = await bindAdasConnection();
    expect(await connWrites(pool)).toBe(true);
    expect(await run(["user", "recover", "ada", "--replace-seed", "--home", home], io)).toBe(0);
    expect(await connWrites(pool)).toBe(false);
    // delta: the old root's delegation to CONN in the inbox is struck
    await ground((gw) => {
      const g = gw.connectionInboxes.get(pool)!.gateway!;
      const delegations = [...g.reactor.snapshot()].filter((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "kind" && p.target.kind === "primitive" && p.target.value === "delegation",
        ),
      );
      expect(delegations.length).toBeGreaterThan(0);
      for (const d of delegations) expect(g.reactor.negationsOf(d.id).length).toBeGreaterThan(0);
    });
    const k2Seed = readUserSeed(home, "ada");
    if (k2Seed.kind !== "present") throw new Error("the new key file");
    await ground(async (gw) => {
      await gw.bindConnection({
        container: "home:ada",
        connectionKey: CONN,
        ownerSeed: k2Seed.seed,
        ownerName: "ada",
      });
    });
    expect(await connWrites(pool)).toBe(true);
  });

  it("an inbox not attached leaves the recovery PENDING; a rerun with it attached completes", async () => {
    await adaAndBea();
    const pool = await bindAdasConnection();
    // No pool backend: the declared inbox cannot be attached.
    expect(await recoverUser(direct({}))).toBe(1);
    expect(err.join("\n")).toMatch(
      new RegExp(`PENDING: ${pool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(not attached\\)`),
    );
    expect(existsSync(journal("ada"))).toBe(true);
    // The fence already refuses K1 there, pending or not.
    expect(await connWrites(pool)).toBe(false);
    err.length = 0;
    expect(await recoverUser(direct({ channelBackend: channelBackendFor(home, io) }))).toBe(0);
    expect(existsSync(journal("ada"))).toBe(false);
  });
});

describe("E10: a user with no root gets one, and no binding", () => {
  it("recovers into a first root", async () => {
    expect(await run(["init", "--home", home], io)).toBe(0);
    const seed = readSeed(home);
    const op = authorForSeed(seed);
    await ground(async (gw) => {
      await gw.append([
        signClaims(userClaims("dee", op, gw.stamp(op).timestamp), seed),
        signClaims(
          grantClaims(STORE_ENTITY, "user:dee", "write", op, gw.stamp(op).timestamp),
          seed,
        ),
      ]);
    });
    expect(await recoverUser({ ...direct({}), name: "dee" })).toBe(0);
    const k = seedKey("dee")!;
    expect(await ground((gw, o) => userRootAt(gw.reactor, gw.validityNow(), o, "dee"))).toBe(k);
    expect(await holds(k, "write")).toBe(true);
    expect(out.join("\n")).not.toMatch(/is retired/);
  });
});
