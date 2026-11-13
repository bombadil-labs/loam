import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { CTX_GRANTS, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { type Container } from "../../src/gateway/container.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { FERN, observed } from "../spike/garden.js";
import { withStamp, type Stamp } from "../../src/gateway/stamp.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "3a".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = "b4".repeat(32);
const OWNER = authorForSeed(OWNER_SEED);
const CONN_SEED = "c5".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const CONN2_SEED = "d6".repeat(32);
const CONN2 = authorForSeed(CONN2_SEED);
const FOREIGN_SEED = "e7".repeat(32);
const FOREIGN = authorForSeed(FOREIGN_SEED);

const OAK = "plant:oak";

const boot = async (backend?: MemoryBackend): Promise<Gateway> => {
  const gw = await Gateway.boot(
    backend ?? new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, OWNER, "write", OP, 500), OP_SEED)]);
  return gw;
};

const declare = (spec: Parameters<typeof containerClaims>[0], ts: number): Delta =>
  signClaims(containerClaims(spec, OP, ts), OP_SEED);

const strikeBy = (targetId: string, seed: string, at: Stamp): Delta =>
  signClaims(
    {
      ...at,
      author: authorForSeed(seed),
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    seed,
  );

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
const MESSAGES = {
  op: "select",
  pred: { hasPointer: { context: { exact: "message" } } },
  in: "input",
};

const bind = (
  gw: Gateway,
  container: string,
  connSeed: string,
  backend?: MemoryBackend,
): Promise<Container> =>
  gw.bindConnection({
    container,
    connectionKey: authorForSeed(connSeed),
    ownerSeed: OWNER_SEED,
    ...(backend !== undefined ? { backend } : {}),
  });

const heightVia = async (deltas: readonly Delta[], entity: string): Promise<unknown> => {
  const dest = await Gateway.open(new MemoryBackend(), {});
  await dest.federate(deltas, { admit: () => true });
  dest.register(PLANT, PLANT_POLICY, [entity], undefined, [...PLANT_WRITABLE]);
  const view = await dest.query(`{ plant(entity: "${entity}") { height } }`);
  await dest.close();
  if (view.errors !== undefined)
    throw new Error(`heightVia query failed: ${view.errors.join(", ")}`);
  return (view.data?.plant as { height?: unknown } | undefined)?.height ?? null;
};

describe("§39 criterion 1 — provenance does not gate visibility; membership does", () => {
  it("a folklore connection reads a delta that ORIGINATED elsewhere and was admitted to folklore", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const elsewhere = observed(FERN, "height", 30, 900, FOREIGN_SEED);
    await gw.federate([elsewhere], { admit: () => true });
    await bind(gw, "alice:folklore", CONN_SEED);

    const read = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    expect(read).toContain(elsewhere.id);
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).toBe(30);
    await gw.close();
  });
});

describe("§39 criterion 2 — a narrow binding cannot read a sibling's members", () => {
  it("a folklore connection does not see a delta that sits only in friends; no error leak", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
      declare(
        { container: "alice:friends", trust: "curated", posture: "shared", membership: MESSAGES },
        1001,
      ),
    ]);
    const onlyFriends = observed(FERN, "message", "for friends", 900, OWNER_SEED);
    const ownMember = observed(FERN, "height", 30, 901, OWNER_SEED);
    await gw.append([onlyFriends, ownMember]);
    await bind(gw, "alice:folklore", CONN_SEED);

    const read = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    expect(read).toContain(ownMember.id);
    expect(read).not.toContain(onlyFriends.id);
    await gw.close();
  });
});

describe("§39 criterion 3 — a connection write lands and resolves immediately (both levels)", () => {
  it("the write is in folklore's scope AND a View through a Schema shows it", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const w = observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED);
    await inbox.gateway!.append([w]);

    expect(gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id)).toContain(w.id);
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).toBe(42);
    await gw.close();
  });
});

describe("§39 criterion 4 — a folklore write does not appear in friends (two-sided)", () => {
  it("the friends read omits the folklore write, and a named live bystander in friends survives", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
      declare(
        { container: "alice:friends", trust: "curated", posture: "shared", membership: MESSAGES },
        1001,
      ),
    ]);
    const bystander = observed(FERN, "message", "still here", 900, OWNER_SEED);
    await gw.append([bystander]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const w = observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED);
    await inbox.gateway!.append([w]);

    const friends = gw.connectionScope({ bound: "alice:friends" }).map((d) => d.id);
    expect(friends).not.toContain(w.id);
    expect(friends).toContain(bystander.id);
    await gw.close();
  });
});

describe("§39 criterion 5 — the write's author is the CONNECTION key", () => {
  it("the landed delta's author equals the connection key exactly, not the owner or the store seed", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const w = observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED);
    await inbox.gateway!.append([w]);

    const author = inbox.gateway!.reactor.get(w.id)!.claims.author;
    expect(author).toBe(CONN);
    expect(author).not.toBe(OWNER);
    expect(author).not.toBe(OP);
    await gw.close();
  });
});

describe("§39 criterion 6 — two connections are distinguishable at the delta level", () => {
  it("one write through each yields two DIFFERENT authors, each equal to its own connection key", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox1 = await bind(gw, "alice:folklore", CONN_SEED);
    const inbox2 = await bind(gw, "alice:folklore", CONN2_SEED);
    const w1 = observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED);
    const w2 = observed(FERN, "height", 43, gw.stamp(CONN2), CONN2_SEED);
    await inbox1.gateway!.append([w1]);
    await inbox2.gateway!.append([w2]);

    const a1 = inbox1.gateway!.reactor.get(w1.id)!.claims.author;
    const a2 = inbox2.gateway!.reactor.get(w2.id)!.claims.author;
    expect(a1).toBe(CONN);
    expect(a2).toBe(CONN2);
    expect(a1).not.toBe(a2);
    await gw.close();
  });
});

describe("§39 criterion 7 — the connection's delegation and a store grant coexist, neither confused", () => {
  it("the connection's authority is an owner-signed sealed delegation scoped to its inbox, in the inbox ground", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const pool = inbox.gateway!;

    const prim = (d: Delta, role: string) => {
      const t = d.claims.pointers.find((p) => p.role === role)?.target;
      return t?.kind === "primitive" ? t.value : undefined;
    };
    const delegations = [...pool.reactor.snapshot()].filter(
      (d) => prim(d, "kind") === "delegation" && prim(d, "key") === CONN,
    );
    expect(delegations).toHaveLength(1);
    expect(delegations[0]!.claims.author).toBe(OWNER);
    expect(prim(delegations[0]!, "scope")).toBe(inbox.entity);
    expect(prim(delegations[0]!, "delegable")).toBe(false);
    const grantsNamingConn = [...pool.reactor.snapshot()].filter(
      (d) =>
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.id === STORE_ENTITY &&
            p.target.entity.context === CTX_GRANTS,
        ) && prim(d, "subject") === CONN,
    );
    expect(grantsNamingConn).toEqual([]);
    expect(
      holdsGrant(
        pool.reactor,
        pool.validityNow(),
        STORE_ENTITY,
        CONN,
        "write",
        pool.operatorAuthor,
      ),
    ).toBe(true);

    await gw.append([signClaims(grantClaims(STORE_ENTITY, FOREIGN, "write", OP, 2000), OP_SEED)]);
    expect(holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, FOREIGN, "write", OP)).toBe(true);
    await gw.close();
  });
});

describe("§39 criterion 8 — negation by membership: per-container divergence (both levels, both containers)", () => {
  it("D2 negates D1 in folklore only; folklore resolves without D1, friends still shows it, a bystander survives", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
      declare(
        { container: "alice:friends", trust: "curated", posture: "shared", membership: HEIGHTS },
        1001,
      ),
    ]);
    const d1 = observed(FERN, "height", 30, 900, OWNER_SEED);
    const oak = observed(OAK, "height", 50, 910, OWNER_SEED);
    await gw.append([d1, oak]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const d2 = strikeBy(d1.id, CONN_SEED, gw.stamp(CONN));
    await inbox.gateway!.append([d2]);

    const folklore = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    const friends = gw.connectionScope({ bound: "alice:friends" }).map((d) => d.id);
    expect(folklore).toContain(d2.id);
    expect(friends).not.toContain(d2.id);

    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).not.toBe(30);
    expect(await heightVia(gw.connectionScope({ bound: "alice:friends" }), FERN)).toBe(30);
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), OAK)).toBe(50);
    await gw.close();
  });
});

describe("§39 criterion 9 — the strand rail (H1 relocated across the pool boundary)", () => {
  it("D1 in the primary, its negation in an inbox: the gather includes both; the View resolves without D1", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const d1 = observed(FERN, "height", 30, 900, OWNER_SEED);
    await gw.append([d1]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const d2 = strikeBy(d1.id, CONN_SEED, gw.stamp(CONN));
    await inbox.gateway!.append([d2]);

    const scoped = gw.connectionScope({ bound: "alice:folklore" });
    const ids = scoped.map((d) => d.id);
    expect(ids).toContain(d1.id);
    expect(ids).toContain(d2.id);
    expect(await heightVia(scoped, FERN)).not.toBe(30);
    await gw.close();
  });

  it("union closure spans grounds: D1 in an inbox, its bare negation in the primary, still suppressed", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const d1 = observed(FERN, "height", 40, gw.stamp(CONN), CONN_SEED);
    await inbox.gateway!.append([d1]);
    const d2 = strikeBy(d1.id, OP_SEED, gw.stamp(OP));
    await gw.append([d2]);

    const scoped = gw.connectionScope({ bound: "alice:folklore" });
    expect(scoped.map((d) => d.id)).toContain(d2.id);
    expect(await heightVia(scoped, FERN)).not.toBe(40);
    await gw.close();
  });
});

describe("§39 criterion 10 — the negation's author is irrelevant at read time", () => {
  it("a strike authored by neither the owner nor any connection binds once admitted, exactly as an owner's would", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const d1 = observed(FERN, "height", 30, 900, OWNER_SEED);
    await gw.append([d1]);
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).toBe(30);

    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const foreignStrike = strikeBy(d1.id, FOREIGN_SEED, gw.stamp(FOREIGN));
    expect(foreignStrike.claims.author).toBe(FOREIGN);
    await inbox.gateway!.federate([foreignStrike], { admit: () => true });

    const scoped = gw.connectionScope({ bound: "alice:folklore" });
    expect(scoped.map((d) => d.id)).toContain(foreignStrike.id);
    expect(await heightVia(scoped, FERN)).not.toBe(30);
    await gw.close();
  });
});

describe("§39 criterion 11 — the binding is an upper bound (wide reaches; narrow refuses)", () => {
  it("a wide binding addresses a named sub-container; the same query through a narrow binding refuses", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "bob:root", trust: "curated", posture: "shared", membership: MESSAGES },
        1000,
      ),
      declare(
        {
          container: "bob:sub",
          trust: "curated",
          posture: "shared",
          membership: HEIGHTS,
          parent: "bob:root",
        },
        1001,
      ),
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1002,
      ),
    ]);
    const h = observed(FERN, "height", 30, 900, OWNER_SEED);
    await gw.append([h]);
    await bind(gw, "bob:root", CONN_SEED);
    await bind(gw, "alice:folklore", CONN2_SEED);

    const wide = gw
      .connectionScope({ bound: "bob:root", containers: ["bob:sub"] })
      .map((d) => d.id);
    expect(wide).toContain(h.id);
    expect(() => gw.connectionScope({ bound: "alice:folklore", containers: ["bob:sub"] })).toThrow(
      /upper bound|outside its subtree/,
    );
    await gw.close();
  });
});

describe("§39 criterion 12 — the degenerate case (Charlie's root heap) works with one bind", () => {
  it("a store with no user containers serves a connection bound to a root container: reads and writes work", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "charlie:root", trust: "curated", posture: "shared", membership: MESSAGES },
        1000,
      ),
    ]);
    const heap = observed(FERN, "message", "the heap", 900, OWNER_SEED);
    await gw.append([heap]);
    const inbox = await bind(gw, "charlie:root", CONN_SEED);
    const w = observed(
      FERN,
      "message",
      "written through the connection",
      gw.stamp(CONN),
      CONN_SEED,
    );
    await inbox.gateway!.append([w]);

    const read = gw.connectionScope({ bound: "charlie:root" }).map((d) => d.id);
    expect(read).toContain(heap.id);
    expect(read).toContain(w.id);
    await gw.close();
  });
});

describe("§39 criterion 13 — revocation is two-sided", () => {
  it("after the grant is struck the write refuses; a second connection still lands; past writes keep their author in the pool and leave the parent", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox1 = await bind(gw, "alice:folklore", CONN_SEED);
    const inbox2 = await bind(gw, "alice:folklore", CONN2_SEED);
    const past = observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED);
    await inbox1.gateway!.append([past]);

    await gw.revokeConnection({ inbox: inbox1, connectionKey: CONN, ownerSeed: OWNER_SEED });

    await expect(
      inbox1.gateway!.append([observed(FERN, "height", 99, gw.stamp(CONN), CONN_SEED)]),
    ).rejects.toThrow();
    const w2 = observed(FERN, "height", 43, gw.stamp(CONN2), CONN2_SEED);
    await inbox2.gateway!.append([w2]);
    expect(inbox2.gateway!.reactor.get(w2.id)).toBeDefined();
    expect(inbox1.gateway!.reactor.get(past.id)!.claims.author).toBe(CONN);
    const scope = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    expect([scope.includes(past.id), scope.includes(w2.id)]).toEqual([false, true]);
    await gw.close();
  });
});

describe("§39 criterion 14 — the door refuses a write into a container the key is not bound to", () => {
  it("a key granted to inbox-1 is refused into inbox-2 and into the primary, without echoing its grant's container", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
      declare(
        { container: "alice:friends", trust: "curated", posture: "shared", membership: HEIGHTS },
        1001,
      ),
    ]);
    const inbox1 = await bind(gw, "alice:folklore", CONN_SEED);
    const inbox2 = await bind(gw, "alice:friends", CONN2_SEED);

    let intoOther: unknown;
    await inbox2
      .gateway!.append([observed(FERN, "height", 7, gw.stamp(CONN), CONN_SEED)])
      .catch((e: unknown) => (intoOther = e));
    expect(intoOther).toBeInstanceOf(Error);
    expect((intoOther as Error).message).not.toContain("inbox:");
    await expect(
      gw.append([observed(FERN, "height", 8, gw.stamp(CONN), CONN_SEED)]),
    ).rejects.toThrow();
    await inbox1.gateway!.append([observed(FERN, "height", 9, gw.stamp(CONN), CONN_SEED)]);
    await gw.close();
  });
});

describe("§39 criterion 15 — the connection's seed never enters the ground", () => {
  it("a planted leak is SEEN by the scan; a clean grant-write-revoke cycle leaves none", async () => {
    const scanFor = (gws: Gateway[], secret: string): boolean =>
      gws.some((g) => [...g.reactor.snapshot()].some((d) => JSON.stringify(d).includes(secret)));

    const planted = await boot();
    await planted.append([observed(FERN, "message", CONN_SEED, 900, OP_SEED)]);
    expect(scanFor([planted], CONN_SEED)).toBe(true);
    await planted.close();

    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    await inbox.gateway!.append([observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED)]);
    await gw.revokeConnection({ inbox, connectionKey: CONN, ownerSeed: OWNER_SEED });
    expect(scanFor([gw, inbox.gateway!], CONN_SEED)).toBe(false);
    await gw.close();
  });
});

describe("§39 criterion 16 — no existing delta changes shape; no §20 migration is owed", () => {
  it("a container declared without inboxOf resolves identically and is not composed as an inbox", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const h = observed(FERN, "height", 30, 900, OWNER_SEED);
    await gw.append([h]);

    const rec = gw.containers().containers.get("alice:folklore")!;
    expect(rec.inboxOf).toBeUndefined();
    expect(gw.containerScope({ containers: ["alice:folklore"] }).map((d) => d.id)).toEqual([h.id]);

    await bind(gw, "alice:folklore", CONN_SEED);
    const inboxRec = gw.containers().containers.get(`inbox:alice:folklore:${CONN}`)!;
    expect(inboxRec.inboxOf).toBe("alice:folklore");
    await gw.close();
  });
});

describe("§39 criterion 17 — only an owner-authored grant extends membership", () => {
  it("a non-owner key's grant does not admit a third key; the owner's grant does", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const pool = inbox.gateway!;

    await pool.append([
      signClaims(
        withStamp(pool.stamp(CONN), (t) => grantClaims(STORE_ENTITY, CONN2, "write", CONN, t)),
        CONN_SEED,
      ),
    ]);
    await expect(
      pool.append([observed(FERN, "height", 7, gw.stamp(CONN2), CONN2_SEED)]),
    ).rejects.toThrow();

    await pool.append([
      signClaims(
        withStamp(pool.stamp(OWNER), (t) => grantClaims(STORE_ENTITY, CONN2, "write", OWNER, t)),
        OWNER_SEED,
      ),
    ]);
    const w = observed(FERN, "height", 8, gw.stamp(CONN2), CONN2_SEED);
    await pool.append([w]);
    expect(pool.reactor.get(w.id)).toBeDefined();
    await gw.close();
  });
});

describe("§39 — the inbox drops to a total forget (two-sided)", () => {
  it("drop() purges the inbox's own bytes and strikes its declaration; bystanders (a sibling inbox AND a primary member) survive", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const primaryMember = observed(FERN, "height", 33, 1100, OWNER_SEED);
    await gw.append([primaryMember]);

    const backend1 = new MemoryBackend();
    const backend2 = new MemoryBackend();
    const purged: string[] = [];
    const origPurge = backend1.purge.bind(backend1);
    backend1.purge = (ids: Iterable<string>): Promise<number> => {
      purged.push(...ids);
      return origPurge(ids);
    };

    const inbox1 = await bind(gw, "alice:folklore", CONN_SEED, backend1);
    const inbox2 = await bind(gw, "alice:folklore", CONN2_SEED, backend2);
    const w1 = observed(FERN, "height", 42, gw.stamp(CONN), CONN_SEED);
    const w2 = observed(OAK, "height", 50, gw.stamp(CONN2), CONN2_SEED);
    await inbox1.gateway!.append([w1]);
    await inbox2.gateway!.append([w2]);
    expect(await backend1.holds(w1.id)).toBe(true);

    await inbox1.drop();

    expect(purged).toContain(w1.id);
    expect(gw.containers().containers.has(`inbox:alice:folklore:${CONN}`)).toBe(false);
    const scoped = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    expect(scoped).not.toContain(w1.id);
    expect(await backend2.holds(w2.id)).toBe(true);
    expect(scoped).toContain(w2.id);
    expect(scoped).toContain(primaryMember.id);
    await gw.close();
  });

  it("detach is REFUSED on an inbox — the durable lifecycle is bind / revoke / drop, never a silent un-suppression", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const d1 = observed(FERN, "height", 30, 900, OWNER_SEED);
    await gw.append([d1]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    await inbox.gateway!.append([strikeBy(d1.id, CONN_SEED, gw.stamp(CONN))]);
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).not.toBe(30);
    await expect(inbox.detach()).rejects.toThrow(/durable|drop\(\)|revoke/);
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).not.toBe(30);
    await gw.close();
  });
});
