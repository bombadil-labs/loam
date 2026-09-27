// `loam user recover` (step 5, PR 3e-2; refactor/audit/user-recovery.md). Driven through the real
// CLI where it can be, and through `recoverUser` with a faulty store where a failure must be forced
// on one side or the other of the operator's atomic append. Every case reads the key files, the
// journal, and the store afterwards: what the command says must be what is there.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeDelta,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { recoverUser, type RecoverOptions } from "../../src/cli/user-recover.js";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { keysEverOf } from "../../src/gateway/principal.js";
import { recoveryClaims, userGroundOf, userRootAt } from "../../src/gateway/user-root.js";
import { withStamp } from "../../src/gateway/stamp.js";
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
  binding?: "after";
}): RecoverOptions["openBackend"] {
  let opens = 0;
  let appendsFailed = false;
  return (path: string): StoreBackend => {
    opens += 1;
    if (mode.reopen === "fail" && opens > 1) throw new Error("the disk is not answering");
    const real = new SqliteBackend(path);
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "append" && mode.binding === "after") {
          return async (deltas: Iterable<Delta>) => {
            const batch = [...deltas];
            const binds = batch.some((d) =>
              d.claims.pointers.some(
                (p) =>
                  p.role === "kind" &&
                  p.target.kind === "primitive" &&
                  p.target.value === "binding",
              ),
            );
            const n = await target.append(batch);
            if (binds) throw new Error("the store failed after writing the binding");
            return n;
          };
        }
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
    expect(err.join("\n")).toMatch(/no effective write or admin grant by name/);
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

describe("the second append, the new key file, and clocks", () => {
  const bindingsBy = (key: string) =>
    ground(
      (gw) =>
        [...gw.reactor.arrivalLog()].filter(
          (d) =>
            d.claims.author === key &&
            d.claims.pointers.some(
              (p) =>
                p.role === "kind" && p.target.kind === "primitive" && p.target.value === "binding",
            ),
        ).length,
    );

  it("a binding written and then reported failed is not signed twice on the rerun", async () => {
    const { k1 } = await adaAndBea();
    expect(await recoverUser(direct({ openBackend: faulty({ binding: "after" }) }))).toBe(1);
    expect(err.join("\n")).toMatch(/PENDING: the binding/);
    const k2 = seedKey("ada")!;
    expect(await bindingsBy(k2)).toBe(1);
    expect(await recoverUser(direct({}))).toBe(0);
    expect(await bindingsBy(k2)).toBe(1);
    expect(existsSync(journal("ada"))).toBe(false);
    expect(
      await ground((gw, op) => keysEverOf(gw.reactor, gw.validityNow(), { root: k2 }, op).has(k1)),
    ).toBe(true);
  });

  it("a lost new key file after the record landed: PENDING, then --abandon-attempt recovers again", async () => {
    await adaAndBea();
    expect(await recoverUser(direct({ openBackend: faulty({ binding: "after" }) }))).toBe(1);
    const k2 = seedKey("ada")!;
    rmSync(userSeedPath(home, "ada"));
    err.length = 0;
    expect(await recoverUser(direct({}))).toBe(1);
    expect(err.join("\n")).toMatch(/--abandon-attempt/);
    expect(await recoverUser(direct({ abandonAttempt: true }))).toBe(0);
    const k3 = seedKey("ada")!;
    expect(k3).not.toBe(k2);
    expect(await rootOfAda()).toBe(k3);
    expect(await holds(k3, "admin")).toBe(true);
    expect(await holds(k2, "admin")).toBe(false);
  });

  it("an operator ordering floor ahead of the clock does not delay the recovery's validity", async () => {
    const { k1 } = await adaAndBea();
    // An operator claim ordered an hour ahead: every later operator stamp orders after it.
    await ground(async (gw, op) => {
      const t = Date.now();
      await gw.append([
        signClaims({ ...userClaims("fut", op, t + 3_600_000), validFrom: t }, readSeed(home)),
      ]);
    });
    expect(await run(["user", "recover", "ada", "--replace-seed", "--home", home], io)).toBe(0);
    const k2 = seedKey("ada")!;
    expect(await holds(k2, "admin")).toBe(true);
    expect(await holds(k1, "admin")).toBe(false);
    await ground((gw, op) => {
      const now = Date.now();
      const ahead = [...gw.reactor.arrivalLog()].filter(
        (d) => d.claims.author === op && d.claims.timestamp > now,
      );
      expect(ahead.length).toBeGreaterThan(1);
      for (const d of ahead) expect(d.claims.validFrom).toBeLessThanOrEqual(now);
    });
  });
});

describe("the standing preflight asks what is effective now", () => {
  async function adaWithGrant(adjust: (g: Claims, t: number) => Claims) {
    expect(await run(["init", "--home", home], io)).toBe(0);
    const seed = readSeed(home);
    const op = authorForSeed(seed);
    await ground(async (gw) => {
      const t = Date.now();
      await gw.append([signClaims(userClaims("ada", op, t - 10_000), seed)]);
      await gw.append([
        signClaims(adjust(grantClaims(STORE_ENTITY, "user:ada", "admin", op, t - 5_000), t), seed),
      ]);
    });
  }
  const refusedWithNothing = async () => {
    const size = await ground((gw) => gw.reactor.size);
    expect(await recoverUser(direct({ replaceSeed: false }))).toBe(2);
    expect(err.join("\n")).toMatch(/no effective write or admin grant/);
    expect(existsSync(journal("ada"))).toBe(false);
    expect(await ground((gw) => gw.reactor.size)).toBe(size);
  };
  it("an expired grant", async () => {
    await adaWithGrant((g, t) => ({ ...g, validUntil: t - 1_000 }));
    await refusedWithNothing();
  });
  it("a grant that starts later", async () => {
    await adaWithGrant((g, t) => ({ ...g, timestamp: t, validFrom: t + 3_600_000 }));
    await refusedWithNothing();
  });
  it("a grant under a timed strike in force now", async () => {
    await adaWithGrant((g) => g);
    await ground(async (gw, op) => {
      const t = Date.now();
      const g = [...gw.reactor.arrivalLog()].find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "primitive" && p.target.value === "user:ada",
        ),
      )!;
      await gw.append([
        signClaims(
          { ...makeNegationClaims(op, t, g.id), validUntil: t + 3_600_000 },
          readSeed(home),
        ),
      ]);
    });
    await refusedWithNothing();
  });
});

describe("an unsigned strike is not a strike", () => {
  it("an unsigned operator-named strike on K1's grant does not stop the recovery from striking it", async () => {
    const { k1 } = await adaAndBea();
    const grant = await ground(async (gw, op) => {
      const g = signClaims(
        grantClaims(STORE_ENTITY, k1, "write", op, gw.stamp(op).timestamp),
        readSeed(home),
      );
      await gw.append([g]);
      // Held raw, unsigned: a door would refuse it; the store still holds it.
      await gw.backend.append([makeDelta(makeNegationClaims(op, gw.stamp(op).timestamp, g.id))]);
      return g.id;
    });
    expect(await run(["user", "recover", "ada", "--replace-seed", "--home", home], io)).toBe(0);
    await ground((gw, op) => {
      const signedInForce = gw.reactor.negationsOf(grant).some((n) => {
        const d = gw.reactor.get(n)!;
        return d.claims.author === op && d.sig !== undefined && d.claims.validFrom <= Date.now();
      });
      expect(signedInForce).toBe(true);
    });
  });
});

describe("what the recovery strikes of the old key", () => {
  it("a K1 grant filed at another entity is struck; a strike that starts later does not count as done", async () => {
    const { k1 } = await adaAndBea();
    const [elsewhere, later] = await ground(async (gw, op) => {
      const seed = readSeed(home);
      const t = Date.now();
      const a = signClaims(grantClaims("tenant:garden", k1, "write", op, t), seed);
      const b = signClaims(grantClaims(STORE_ENTITY, k1, "write", op, t + 1), seed);
      await gw.append([a, b]);
      // A strike of `b` that starts in an hour: not yet a strike.
      await gw.append([
        signClaims({ ...makeNegationClaims(op, t + 2, b.id), validFrom: t + 3_600_000 }, seed),
      ]);
      return [a.id, b.id] as const;
    });
    expect(await run(["user", "recover", "ada", "--replace-seed", "--home", home], io)).toBe(0);
    await ground((gw, op) => {
      const now = Date.now();
      const inForce = (id: string) =>
        gw.reactor.negationsOf(id).some((n) => {
          const d = gw.reactor.get(n)!;
          return d.claims.author === op && d.claims.validFrom <= now;
        });
      expect(inForce(elsewhere)).toBe(true);
      expect(inForce(later)).toBe(true);
    });
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

  const delegationsIn = (pool: string, key: string) =>
    ground((gw) => {
      const g = gw.connectionInboxes.get(pool)!.gateway!;
      return [...g.reactor.arrivalLog()]
        .filter(
          (d) =>
            d.claims.author === key &&
            d.claims.pointers.some(
              (p) =>
                p.role === "kind" &&
                p.target.kind === "primitive" &&
                p.target.value === "delegation",
            ),
        )
        .map((d) => g.reactor.negationsOf(d.id).length > 0);
    });

  it("a record erased after it landed: the rerun says so, keeps the journal, and claims nothing", async () => {
    await adaAndBea();
    await bindAdasConnection();
    expect(await recoverUser(direct({}))).toBe(1); // the inbox is not attached: PENDING
    const j = JSON.parse(readFileSync(journal("ada"), "utf8")) as { record: string };
    await ground(async (gw, op) => {
      await gw.append([
        signClaims(eraseClaims(j.record, op, op, gw.stamp(op).timestamp), readSeed(home)),
      ]);
    });
    out.length = 0;
    err.length = 0;
    expect(await recoverUser(direct({ channelBackend: channelBackendFor(home, io) }))).toBe(1);
    expect(err.join("\n")).toMatch(/landed and was then erased/);
    expect(out.join("\n")).not.toMatch(/now signs with/);
    expect(existsSync(journal("ada"))).toBe(true);
  });

  it("an abandon whose new attempt is refused keeps the old journal", async () => {
    await adaAndBea();
    await bindAdasConnection();
    expect(await recoverUser(direct({}))).toBe(1); // PENDING
    const before = readFileSync(journal("ada"), "utf8");
    rmSync(userSeedPath(home, "ada"));
    // The new attempt's preflight will refuse: ada's grant by name is struck.
    await ground(async (gw, op) => {
      const g = [...gw.reactor.arrivalLog()].find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "primitive" && p.target.value === "user:ada",
        ),
      )!;
      await gw.append([
        signClaims(makeNegationClaims(op, gw.stamp(op).timestamp, g.id), readSeed(home)),
      ]);
    });
    expect(await recoverUser(direct({ abandonAttempt: true }))).toBe(2);
    expect(readFileSync(journal("ada"), "utf8")).toBe(before);
  });

  it("an abandon finishes the predecessor's inbox cleanup as well as its own", async () => {
    const { k1 } = await adaAndBea();
    const pool = await bindAdasConnection();
    expect(await recoverUser(direct({}))).toBe(1); // the inbox not attached: K1's delegation unstruck
    expect(await delegationsIn(pool, k1)).toEqual([false]);
    rmSync(userSeedPath(home, "ada"));
    expect(
      await recoverUser(
        direct({ abandonAttempt: true, channelBackend: channelBackendFor(home, io) }),
      ),
    ).toBe(0);
    expect(await delegationsIn(pool, k1)).toEqual([true]);
    expect(existsSync(journal("ada"))).toBe(false);
  });

  it("a history broken after the attempt landed: the rerun claims nothing and keeps the journal", async () => {
    await adaAndBea();
    await bindAdasConnection();
    expect(await recoverUser(direct({}))).toBe(1); // PENDING
    // A competing first record breaks ada's chain; this attempt's record is still held and unerased.
    await ground(async (gw, op) => {
      const other = authorForSeed("e9".repeat(32));
      await gw.append([
        signClaims(
          withStamp(gw.stamp(op), (t) =>
            recoveryClaims({ name: "ada", attempt: "rival", root: other, retired: [] }, op, t),
          ),
          readSeed(home),
        ),
      ]);
    });
    out.length = 0;
    err.length = 0;
    expect(await recoverUser(direct({ channelBackend: channelBackendFor(home, io) }))).toBe(1);
    expect(err.join("\n")).toMatch(/does not now name/);
    expect(out.join("\n")).not.toMatch(/now signs with/);
    expect(existsSync(journal("ada"))).toBe(true);
  });

  it("an abandon whose new attempt fails before it commits hands the journal back to the old attempt", async () => {
    await adaAndBea();
    await bindAdasConnection();
    expect(await recoverUser(direct({}))).toBe(1); // PENDING: K2's inbox work unfinished
    const k2Journal = readFileSync(journal("ada"), "utf8");
    rmSync(userSeedPath(home, "ada"));
    expect(
      await recoverUser(
        direct({ abandonAttempt: true, openBackend: faulty({ append: "before" }) }),
      ),
    ).toBe(1);
    expect(readFileSync(journal("ada"), "utf8")).toBe(k2Journal);
    err.length = 0;
    expect(await recoverUser(direct({}))).toBe(1);
    expect(err.join("\n")).toMatch(/--abandon-attempt/);
  });

  it("an erased strike in the inbox is not a strike: recovery lands a fresh one", async () => {
    const { k1 } = await adaAndBea();
    const pool = await bindAdasConnection();
    const [delegation, erasedStrike] = await ground(async (gw, op) => {
      const g = gw.connectionInboxes.get(pool)!.gateway!;
      const seed = readSeed(home);
      const d = [...g.reactor.arrivalLog()].find(
        (x) =>
          x.claims.author === k1 &&
          x.claims.pointers.some(
            (p) => p.target.kind === "primitive" && p.target.value === "delegation",
          ),
      )!;
      const strike = signClaims(
        withStamp(g.stamp(op), (t) => makeNegationClaims(op, t, d.id)),
        seed,
      );
      await g.append([strike]);
      await g.append([
        signClaims(
          withStamp(g.stamp(op), (t) => eraseClaims(strike.id, op, op, t)),
          seed,
        ),
      ]);
      return [d.id, strike.id] as const;
    });
    expect(await recoverUser(direct({ channelBackend: channelBackendFor(home, io) }))).toBe(0);
    await ground((gw, op) => {
      const g = gw.connectionInboxes.get(pool)!.gateway!;
      const fresh = g.reactor
        .negationsOf(delegation)
        .filter((n) => n !== erasedStrike)
        .map((n) => g.reactor.get(n)!)
        .filter((n) => n.claims.author === op && n.claims.validFrom <= Date.now());
      expect(fresh.length).toBeGreaterThan(0);
    });
  });

  it("a struck root claim while the attempt is pending: the rerun claims nothing", async () => {
    await adaAndBea();
    await bindAdasConnection();
    expect(await recoverUser(direct({}))).toBe(1); // PENDING
    const k2 = seedKey("ada")!;
    await ground(async (gw, op) => {
      // The ROOT claim (context loam.root), not the lineage claim, which also names K2.
      const claim = [...gw.reactor.byTarget("user:ada")].find((id) => {
        const ptrs = gw.reactor.get(id)!.claims.pointers;
        return (
          ptrs.some((p) => p.target.kind === "entity" && p.target.entity.context === "loam.root") &&
          ptrs.some(
            (p) => p.role === "root" && p.target.kind === "primitive" && p.target.value === k2,
          )
        );
      })!;
      await gw.append([
        signClaims(
          withStamp(gw.stamp(op), (t) => makeNegationClaims(op, t, claim)),
          readSeed(home),
        ),
      ]);
    });
    out.length = 0;
    err.length = 0;
    expect(await recoverUser(direct({ channelBackend: channelBackendFor(home, io) }))).toBe(1);
    expect(err.join("\n")).toMatch(/no standing root claim names it/);
    expect(out.join("\n")).not.toMatch(/now signs with/);
    expect(existsSync(journal("ada"))).toBe(true);
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
