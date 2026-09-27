// A bound connection writes by DELEGATION (README ruling 6): the owner's root signs a sealed
// delegation to the connection key, scoped to the inbox pool's own name, in the pool's own ground.
// Each case asks two levels: the delta (what record the pool holds, and what strikes it) and the door
// (a write signed by the key is admitted or refused). Every revoke case keeps a bystander connection
// that still writes, so a revoke that reached too far is seen.
//
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims, inboxName } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { connectionGrantState } from "../../src/server/admin-federation.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const CONN_SEED = "d7".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const OTHER_SEED = "d8".repeat(32);
const OTHER = authorForSeed(OTHER_SEED);
const STRANGER_SEED = "d9".repeat(32);

const genesis = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });

/** Backends that outlive a gateway: in memory by default; `onDisk` for a case that restarts. */
function disk(): { root: StoreBackend; channelBackend: (name: string) => StoreBackend } {
  return { root: new MemoryBackend(), channelBackend: () => new MemoryBackend() };
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** SQLite files in this test's own temp dir: a root store and one file per pool. */
function onDisk() {
  const dir = mkdtempSync(join(tmpdir(), "loam-conn-delegation-"));
  temps.push(dir);
  const file = (name: string) => join(dir, `${createHash("sha256").update(name).digest("hex")}.db`);
  return {
    rootPath: join(dir, "root.db"),
    channelBackend: (name: string): StoreBackend => new SqliteBackend(file(name)),
  };
}

async function home(on = disk()): Promise<Gateway> {
  const gw = await Gateway.boot(on.root, genesis(), { channelBackend: on.channelBackend });
  await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500), OP_SEED)]);
  for (const [container, t] of [
    ["home:ada", 600],
    ["home:bea", 601],
  ] as const) {
    await gw.append([
      signClaims(
        containerClaims(
          {
            container,
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
              in: "input",
            },
          },
          OP,
          t,
        ),
        OP_SEED,
      ),
    ]);
  }
  return gw;
}

const bind = async (gw: Gateway, seed: string, container = "home:ada") => {
  const inbox = (
    await gw.bindConnection({
      container,
      connectionKey: authorForSeed(seed),
      ownerSeed: GARDENER_SEED,
    })
  ).entity!;
  return gw.connectionInboxes.get(inbox)!;
};

async function door(ground: Gateway, d: Delta): Promise<"admitted" | "refused"> {
  try {
    await ground.append([d]);
    return "admitted";
  } catch {
    return "refused";
  }
}

const prim = (d: Delta, role: string) => {
  const t = d.claims.pointers.find((p) => p.role === role)?.target;
  return t?.kind === "primitive" ? t.value : undefined;
};

const delegationsOf = (ground: Gateway, key: string): Delta[] =>
  [...ground.reactor.snapshot()].filter(
    (d) => prim(d, "kind") === "delegation" && prim(d, "key") === key,
  );

describe("binding a connection signs one sealed delegation, scoped to its inbox", () => {
  it("the pool holds the owner's delegation; the key writes there; an unbound key does not", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    const [d, ...more] = delegationsOf(pool, CONN);
    expect(more).toEqual([]);
    expect(d!.claims.author).toBe(GARDENER);
    expect(prim(d!, "scope")).toBe(inboxName("home:ada", CONN));
    expect(prim(d!, "delegable")).toBe(false);
    expect(await door(pool, observed(FERN, "height", 1, 1000, CONN_SEED))).toBe("admitted");
    expect(await door(pool, observed(FERN, "height", 2, 1001, STRANGER_SEED))).toBe("refused");
    expect(connectionGrantState(pool.reactor, pool.validityNow(), OP, CONN)).toBe("active");
    await gw.close();
  });

  it("a second bind of the same connection signs nothing new", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    await bind(gw, CONN_SEED);
    expect(delegationsOf(conn.gateway!, CONN)).toHaveLength(1);
    await gw.close();
  });
});

describe("the delegation grants nothing outside its own inbox", () => {
  it("copied into the root store, it does not admit the key there", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const [d] = delegationsOf(conn.gateway!, CONN);
    expect(await door(gw, d!)).toBe("admitted"); // the owner's record lands: it is only a claim
    expect(await door(gw, observed(FERN, "height", 3, 1002, CONN_SEED))).toBe("refused");
    await gw.close();
  });

  it("copied into the same owner's other inbox, it does not admit the key there", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED, "home:ada");
    const other = await bind(gw, OTHER_SEED, "home:bea");
    const [d] = delegationsOf(conn.gateway!, CONN);
    const bea = other.gateway!;
    expect(await door(bea, d!)).toBe("admitted");
    expect(await door(bea, observed(FERN, "height", 4, 1003, CONN_SEED))).toBe("refused");
    expect(await door(bea, observed(FERN, "height", 5, 1004, OTHER_SEED))).toBe("admitted");
    await gw.close();
  });
});

describe("revoking a connection negates its delegation", () => {
  it("the owner's revoke strikes the delegation; the key is refused; a bystander still writes", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const other = await bind(gw, OTHER_SEED);
    const pool = conn.gateway!;
    const [d] = delegationsOf(pool, CONN);
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: GARDENER_SEED });
    expect(pool.reactor.negationsOf(d!.id)).toHaveLength(1);
    expect(await door(pool, observed(FERN, "height", 6, 1005, CONN_SEED))).toBe("refused");
    expect(connectionGrantState(pool.reactor, pool.validityNow(), OP, CONN)).toBe("revoked");
    expect(await door(other.gateway!, observed(FERN, "tag", "shade", 1006, OTHER_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });

  it("the operator's revoke binds too", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: OP_SEED });
    expect(await door(conn.gateway!, observed(FERN, "height", 7, 1007, CONN_SEED))).toBe("refused");
    await gw.close();
  });

  it("a stranger's revoke is refused at the door, and the connection still writes", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: STRANGER_SEED }),
    ).rejects.toThrow(/append rejected/);
    expect(await door(conn.gateway!, observed(FERN, "height", 8, 1008, CONN_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });

  it("a pool writer who neither signed the delegation nor runs the store is told it did not bind", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    // OTHER may write here, so its strike lands; the suppression rule does not honor it.
    await pool.append([
      signClaims(grantClaims(STORE_ENTITY, OTHER, "write", GARDENER, 1015), GARDENER_SEED),
    ]);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: OTHER_SEED }),
    ).rejects.toThrow(/still writes here/);
    expect(await door(pool, observed(FERN, "height", 14, 1016, CONN_SEED))).toBe("admitted");
    await gw.close();
  });

  it("a pool bound before delegations, holding a write grant, still revokes", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    await pool.append([
      signClaims(grantClaims(STORE_ENTITY, OTHER, "write", GARDENER, 1009), GARDENER_SEED),
    ]);
    expect(await door(pool, observed(FERN, "height", 9, 1010, OTHER_SEED))).toBe("admitted");
    await gw.revokeConnection({ inbox: conn, connectionKey: OTHER, ownerSeed: GARDENER_SEED });
    expect(await door(pool, observed(FERN, "height", 10, 1011, OTHER_SEED))).toBe("refused");
    expect(await door(pool, observed(FERN, "height", 11, 1012, CONN_SEED))).toBe("admitted");
    await gw.close();
  });
});

describe("the pool keeps its scope when its reactor is replaced", () => {
  it("after a reseat, the key still writes and an unbound key still does not", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    await pool.reseat();
    expect(await door(pool, observed(FERN, "height", 12, 1013, CONN_SEED))).toBe("admitted");
    expect(await door(pool, observed(FERN, "height", 13, 1014, STRANGER_SEED))).toBe("refused");
    await gw.close();
  });
});

describe("a restart keeps the delegation honored", () => {
  it("a pool re-attached at boot admits the key and refuses an unbound one", async () => {
    const on = onDisk();
    const gw = await home({
      root: new SqliteBackend(on.rootPath),
      channelBackend: on.channelBackend,
    });
    await bind(gw, CONN_SEED);
    await gw.close();
    const again = await Gateway.boot(new SqliteBackend(on.rootPath), genesis(), {
      channelBackend: on.channelBackend,
    });
    const pool = again.connectionInboxes.get(inboxName("home:ada", CONN))!.gateway!;
    expect(await door(pool, observed(FERN, "height", 15, 1017, CONN_SEED))).toBe("admitted");
    expect(await door(pool, observed(FERN, "height", 16, 1018, STRANGER_SEED))).toBe("refused");
    await again.close();
  });
});
