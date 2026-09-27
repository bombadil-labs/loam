// A bound connection writes by DELEGATION (README ruling 6): the owner's root signs a sealed
// delegation to the connection key, scoped to the inbox pool's own name, in the pool's own ground.
// Each case asks two levels: the delta (what record the pool holds, and what strikes it) and the door
// (a write signed by the key is admitted or refused). Who may revoke is the caller's decision (the
// admin page checks the session user; the CLI holds the operator seed); `revokeConnection` only
// picks a voice that binds, so no case here drives an unauthorized caller. Every revoke case keeps a bystander connection
// that still writes, so a revoke that reached too far is seen.
//
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { delegationClaims } from "../../src/gateway/principal.js";
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
const STRANGER = authorForSeed(STRANGER_SEED);

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

afterEach(() => {
  vi.useRealTimers();
});

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

describe("a scope is read exactly", () => {
  it("an owner-signed delegation scoped to an ANCESTOR of two inboxes is honored in neither", async () => {
    const gw = await home();
    const ada = (await bind(gw, CONN_SEED, "home:ada")).gateway!;
    const bea = (await bind(gw, OTHER_SEED, "home:bea")).gateway!;
    const broad = signClaims(
      delegationClaims(GARDENER, STRANGER, "inbox:home", 1021),
      GARDENER_SEED,
    );
    for (const pool of [ada, bea]) {
      expect(await door(pool, broad)).toBe("admitted");
      expect(await door(pool, observed(FERN, "height", 17, 1022, STRANGER_SEED))).toBe("refused");
    }
    // Control: the same owner, the same key, the exact pool name: honored in that pool only.
    const exact = signClaims(
      delegationClaims(GARDENER, STRANGER, inboxName("home:ada", CONN), 1023),
      GARDENER_SEED,
    );
    await ada.append([exact]);
    await bea.append([exact]);
    expect(await door(ada, observed(FERN, "height", 18, 1024, STRANGER_SEED))).toBe("admitted");
    expect(await door(bea, observed(FERN, "height", 19, 1025, STRANGER_SEED))).toBe("refused");
    await gw.close();
  });
});

describe("the admin panel's label reads only root-signed delegations", () => {
  it("a delegation-shaped record another pool writer signed, then struck, leaves the key ungranted", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    await pool.append([
      signClaims(grantClaims(STORE_ENTITY, OTHER, "write", GARDENER, 1026), GARDENER_SEED),
    ]);
    // OTHER signs a record claiming to be GARDENER's delegation to STRANGER, then strikes it.
    const forged = signClaims(
      { ...delegationClaims(GARDENER, STRANGER, inboxName("home:ada", CONN), 1027), author: OTHER },
      OTHER_SEED,
    );
    await pool.append([forged]);
    await pool.append([signClaims(makeNegationClaims(OTHER, 1028, forged.id), OTHER_SEED)]);
    expect(connectionGrantState(pool.reactor, pool.validityNow(), OP, STRANGER)).toBe("ungranted");
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

  it("the operator's revoke binds too, and reaches only that connection", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const other = await bind(gw, OTHER_SEED);
    const [d] = delegationsOf(conn.gateway!, CONN);
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: OP_SEED });
    expect(conn.gateway!.reactor.negationsOf(d!.id)).toHaveLength(1);
    expect(await door(conn.gateway!, observed(FERN, "height", 7, 1007, CONN_SEED))).toBe("refused");
    expect(await door(other.gateway!, observed(FERN, "tag", "sun", 1019, OTHER_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });

  it("the operator's revoke still finds the delegation after the owner's own grant is struck", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const other = await bind(gw, OTHER_SEED, "home:bea");
    const pool = conn.gateway!;
    const ownerGrant = [...pool.reactor.snapshot()].find(
      (x) => prim(x, "subject") === GARDENER && prim(x, "verb") === "admin",
    )!;
    await pool.append([signClaims(makeNegationClaims(OP, 1020, ownerGrant.id), OP_SEED)]);
    const [d] = delegationsOf(pool, CONN);
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: OP_SEED });
    expect(pool.reactor.negationsOf(d!.id)).toHaveLength(1);
    expect(await door(other.gateway!, observed(FERN, "tag", "dew", 1030, OTHER_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });

  it("after the owner's seed is replaced, a re-bind signs afresh, strikes the old, and the new key revokes", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const other = await bind(gw, OTHER_SEED);
    const pool = conn.gateway!;
    // The person's seed is replaced (a role change mints a new one) and they consent again.
    const NEW_SEED = "e1".repeat(32);
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: NEW_SEED });
    const both = delegationsOf(pool, CONN);
    // The re-bind signed a fresh delegation from the new key, and the operator struck the old one.
    const old = both.find((d) => d.claims.author === GARDENER)!;
    expect(pool.reactor.negationsOf(old.id).map((n) => pool.reactor.get(n)!.claims.author)).toEqual(
      [OP],
    );
    expect(both.map((d) => d.claims.author).sort()).toEqual(
      [GARDENER, authorForSeed(NEW_SEED)].sort(),
    );
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: NEW_SEED });
    for (const d of both) expect(pool.reactor.negationsOf(d.id)).toHaveLength(1);
    expect(await door(pool, observed(FERN, "height", 8, 1008, CONN_SEED))).toBe("refused");
    expect(connectionGrantState(pool.reactor, pool.validityNow(), OP, CONN)).toBe("revoked");
    expect(await door(other.gateway!, observed(FERN, "tag", "fog", 1029, OTHER_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });

  it("after a replacement, the OLD key cannot reissue a delegation, even after the new owner revokes", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const other = await bind(gw, OTHER_SEED);
    const pool = conn.gateway!;
    const NEW_SEED = "e2".repeat(32);
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: NEW_SEED });
    // The old key lost its admin standing here, so its fresh delegation is refused at the door.
    const reissue = (t: number) =>
      signClaims(delegationClaims(GARDENER, CONN, inboxName("home:ada", CONN), t), GARDENER_SEED);
    expect(await door(pool, reissue(1031))).toBe("refused");
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: NEW_SEED });
    expect(await door(pool, reissue(1032))).toBe("refused");
    // Arriving raw, as federation would carry it, the reissue still grants nothing: its root holds
    // no standing grant here any more.
    expect(pool.reactor.ingest(reissue(1033)).status).toBe("accepted");
    expect(await door(pool, observed(FERN, "height", 20, 1034, CONN_SEED))).toBe("refused");
    expect(await door(other.gateway!, observed(FERN, "tag", "rime", 1035, OTHER_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });

  it("a strike with an end does not let a replaced root back in once it lapses", async () => {
    const T0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    const T1 = T0 + 1_000;
    // The operator strikes the old owner's admin grant and delegation, but only over [T0+10, T1).
    const timed = (id: string) =>
      signClaims({ ...makeNegationClaims(OP, T0 + 10, id), validUntil: T1 }, OP_SEED);
    const oldAdmin = [...pool.reactor.snapshot()].find(
      (x) => prim(x, "subject") === GARDENER && prim(x, "verb") === "admin",
    )!;
    const [oldDelegation] = delegationsOf(pool, CONN);
    vi.setSystemTime(T0 + 10);
    await pool.append([timed(oldAdmin.id), timed(oldDelegation!.id)]);
    // Inside the window the person's replaced seed re-binds, then revokes.
    vi.setSystemTime(T0 + 20);
    const NEW_SEED = "e4".repeat(32);
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: NEW_SEED });
    const forGood = (id: string) =>
      pool.reactor
        .negationsOf(id)
        .map((n) => pool.reactor.get(n)!.claims)
        .filter((c) => c.author === OP && c.validUntil === undefined).length;
    expect(forGood(oldAdmin.id)).toBe(1);
    expect(forGood(oldDelegation!.id)).toBe(1);
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: NEW_SEED });
    expect(forGood(oldAdmin.id)).toBe(1); // a repeated bind adds no second strike
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: NEW_SEED });
    // After the timed strikes lapse, the old root has neither write nor delegation authority.
    vi.setSystemTime(T1 + 10);
    expect(await door(pool, observed(FERN, "height", 22, T1 + 10, GARDENER_SEED))).toBe("refused");
    const reissue = signClaims(
      delegationClaims(GARDENER, CONN, inboxName("home:ada", CONN), T1 + 11),
      GARDENER_SEED,
    );
    expect(await door(pool, reissue)).toBe("refused");
    expect(pool.reactor.ingest(reissue).status).toBe("accepted");
    expect(await door(pool, observed(FERN, "height", 23, T1 + 12, CONN_SEED))).toBe("refused");
    await gw.close();
  });

  it("a bind strikes a second root's delegation and admin grant, even when the owner's stands", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const pool = conn.gateway!;
    const SECOND_SEED = "e3".repeat(32);
    const SECOND = authorForSeed(SECOND_SEED);
    const admin = signClaims(grantClaims(STORE_ENTITY, SECOND, "admin", OP, 1036), OP_SEED);
    const extra = signClaims(
      delegationClaims(SECOND, CONN, inboxName("home:ada", CONN), 1037),
      SECOND_SEED,
    );
    await pool.append([admin]);
    await pool.append([extra]);
    await bind(gw, CONN_SEED); // the owner's delegation stands; the bind still cleans up
    const by = (id: string) =>
      pool.reactor.negationsOf(id).map((n) => pool.reactor.get(n)!.claims.author);
    expect(by(extra.id)).toEqual([OP]);
    expect(by(admin.id)).toEqual([OP]);
    const [own] = delegationsOf(pool, CONN).filter((d) => d.claims.author === GARDENER);
    expect(pool.reactor.negationsOf(own!.id)).toEqual([]); // the owner's own is untouched
    expect(await door(pool, observed(FERN, "height", 21, 1038, CONN_SEED))).toBe("admitted");
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
