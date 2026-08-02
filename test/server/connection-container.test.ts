// §39 / T138 — a connection binds to a container (the inbox model). The 17 acceptance criteria of
// the working spec, railed here. A connection binds to exactly one container: reads GATHER that
// container (its own ground plus every inbox pool bound to it), writes LAND in a per-connection inbox
// pool as the owner, each connection signs with its own key that is provably the owner's, and
// negation binds by MEMBERSHIP — a strike admitted to the gather is in play, whoever wrote it.
//
// Two levels throughout (the P3 doctrine): the DELTA level asks what is in `containerScope` /
// `connectionScope`; the OBJECT level asks what a READER resolves through a Schema — federate the
// scoped read into a fresh store, register PLANT, and query. The two come apart exactly when
// suppression is involved, which is where H1 lives.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { CTX_GRANTS, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims, type Container } from "../../src/gateway/container.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "3a".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = "b4".repeat(32); // Alice, the container owner
const OWNER = authorForSeed(OWNER_SEED);
const CONN_SEED = "c5".repeat(32); // a connection actor seed — signs its own writes
const CONN = authorForSeed(CONN_SEED);
const CONN2_SEED = "d6".repeat(32); // a second connection, same owner
const CONN2 = authorForSeed(CONN2_SEED);
const FOREIGN_SEED = "e7".repeat(32); // neither the owner nor any connection
const FOREIGN = authorForSeed(FOREIGN_SEED);

const OAK = "plant:oak";

// The owner (Alice) holds write standing on her own store — the connection grants live in the inbox
// pools, but the fixtures also let the owner seed primary data directly.
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

// A strike in some author's own voice — a negation delta pointing at a delta.
const strikeBy = (targetId: string, seed: string, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
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

// OBJECT LEVEL: land the scoped read in a fresh store and ask what a READER resolves for `entity`'s
// height — never merely which ids crossed. `null` means the height field resolved to nothing (the
// only height claim was struck, or none was present).
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
    // Admitted by federation (the deliberate act, §39.2), authored by a foreign key.
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
    await gw.append([onlyFriends]);
    await bind(gw, "alice:folklore", CONN_SEED);

    // The refusal is a SCOPE answer, not an error: reading folklore simply does not include it.
    const read = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
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
    const w = observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED);
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
    const w = observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED);
    await inbox.gateway!.append([w]);

    const friends = gw.connectionScope({ bound: "alice:friends" }).map((d) => d.id);
    expect(friends).not.toContain(w.id); // the target is absent
    expect(friends).toContain(bystander.id); // the live bystander survives
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
    const w = observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED);
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
    const w1 = observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED);
    const w2 = observed(FERN, "height", 43, gw.nextTimestamp(), CONN2_SEED);
    await inbox1.gateway!.append([w1]);
    await inbox2.gateway!.append([w2]);

    const a1 = inbox1.gateway!.reactor.get(w1.id)!.claims.author;
    const a2 = inbox2.gateway!.reactor.get(w2.id)!.claims.author;
    expect(a1).toBe(CONN);
    expect(a2).toBe(CONN2);
    expect(a1).not.toBe(a2); // DIFFER, not merely both non-empty
    await gw.close();
  });
});

describe("§39 criterion 7 — the connection grant and a store grant coexist, neither confused", () => {
  it("the connection grant is owner-authored, subject=connection key, verb=write, in the inbox ground", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const pool = inbox.gateway!;

    // The connection grant lives in the INBOX pool's own ground. Assert its SHAPE and AUTHOR — it is
    // preceded by the pool genesis and the operator's owner-admin grant, so it is not the pool's
    // first delta.
    const grants = [...pool.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === STORE_ENTITY &&
          p.target.entity.context === CTX_GRANTS,
      ),
    );
    const subjectVerb = (d: Delta): { subject?: string; verb?: string } => {
      let subject: string | undefined;
      let verb: string | undefined;
      for (const p of d.claims.pointers) {
        if (p.target.kind !== "primitive") continue;
        if (p.role === "subject" && typeof p.target.value === "string") subject = p.target.value;
        if (p.role === "verb" && typeof p.target.value === "string") verb = p.target.value;
      }
      return {
        ...(subject !== undefined ? { subject } : {}),
        ...(verb !== undefined ? { verb } : {}),
      };
    };
    const connGrant = grants.find((d) => subjectVerb(d).subject === CONN);
    expect(connGrant).toBeDefined();
    expect(subjectVerb(connGrant!).verb).toBe("write");
    expect(connGrant!.claims.author).toBe(OWNER); // owner-authored authority
    // The connection's write standing resolves through the chain (connection-write → owner-admin).
    expect(holdsGrant(pool.reactor, STORE_ENTITY, CONN, "write", OP)).toBe(true);

    // A store-targeting grant shape still validates UNCHANGED beside it, in the real store.
    await gw.append([signClaims(grantClaims(STORE_ENTITY, FOREIGN, "write", OP, 2000), OP_SEED)]);
    expect(holdsGrant(gw.reactor, STORE_ENTITY, FOREIGN, "write", OP)).toBe(true);
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
    // D1 in the primary — a member of BOTH containers (both select the height context).
    const d1 = observed(FERN, "height", 30, 900, OWNER_SEED);
    // A bystander in a different entity, also a member of both — it must survive in folklore.
    const oak = observed(OAK, "height", 50, 910, OWNER_SEED);
    await gw.append([d1, oak]);
    // D2 (negating D1) admitted to FOLKLORE only, via its inbox.
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const d2 = strikeBy(d1.id, CONN_SEED, gw.nextTimestamp());
    await inbox.gateway!.append([d2]);

    // DELTA level: D2 is a member of folklore's gather, and NOT of friends'.
    const folklore = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    const friends = gw.connectionScope({ bound: "alice:friends" }).map((d) => d.id);
    expect(folklore).toContain(d2.id);
    expect(friends).not.toContain(d2.id);

    // OBJECT level, both containers: folklore resolves WITHOUT D1; friends still shows D1; the
    // bystander survives in folklore.
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
    const d1 = observed(FERN, "height", 30, 900, OWNER_SEED); // primary member
    await gw.append([d1]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const d2 = strikeBy(d1.id, CONN_SEED, gw.nextTimestamp()); // the strike, in the inbox pool
    await inbox.gateway!.append([d2]);

    // DELTA level: BOTH cross into the gather. A gather that returns D1 without its admitted D2 is
    // the failure this rail exists to catch (it is RED before the inbox composition lands).
    const scoped = gw.connectionScope({ bound: "alice:folklore" });
    const ids = scoped.map((d) => d.id);
    expect(ids).toContain(d1.id);
    expect(ids).toContain(d2.id);
    // OBJECT level: the View resolves WITHOUT the negated claim.
    expect(await heightVia(scoped, FERN)).not.toBe(30);
    await gw.close();
  });

  it("union closure spans grounds: D1 in an inbox, its bare negation in the primary, still suppressed", async () => {
    // The strike here is a bare negation in the PRIMARY — no context Term selects it, so it is NOT a
    // direct member of any ground; it is reachable only by closing negation ACROSS the pool boundary.
    // A per-ground closure treats the pool as a boundary and hands the reader D1 live. This is killed
    // only by the union closure (decision 1).
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    const d1 = observed(FERN, "height", 40, gw.nextTimestamp(), CONN_SEED); // inbox member
    await inbox.gateway!.append([d1]);
    const d2 = strikeBy(d1.id, OP_SEED, gw.nextTimestamp()); // bare negation, in the primary
    await gw.append([d2]);

    const scoped = gw.connectionScope({ bound: "alice:folklore" });
    expect(scoped.map((d) => d.id)).toContain(d2.id); // the strand was pulled across the boundary
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
    // Without any strike, D1 is live — the control that proves the strike is what suppresses.
    expect(await heightVia(gw.connectionScope({ bound: "alice:folklore" }), FERN)).toBe(30);

    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    // A FOREIGN-authored strike, admitted to folklore's gather by federation into its inbox.
    const foreignStrike = strikeBy(d1.id, FOREIGN_SEED, gw.nextTimestamp());
    expect(foreignStrike.claims.author).toBe(FOREIGN);
    await inbox.gateway!.federate([foreignStrike], { admit: () => true });

    const scoped = gw.connectionScope({ bound: "alice:folklore" });
    expect(scoped.map((d) => d.id)).toContain(foreignStrike.id);
    expect(await heightVia(scoped, FERN)).not.toBe(30); // suppressed, author notwithstanding
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

    // Wide (bound to the root) reaches the child by naming it.
    const wide = gw
      .connectionScope({ bound: "bob:root", containers: ["bob:sub"] })
      .map((d) => d.id);
    expect(wide).toContain(h.id);
    // Narrow (bound to folklore) naming bob:sub refuses — bob:sub is outside its subtree.
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
      gw.nextTimestamp(),
      CONN_SEED,
    );
    await inbox.gateway!.append([w]);

    const read = gw.connectionScope({ bound: "charlie:root" }).map((d) => d.id);
    expect(read).toContain(heap.id); // the pre-existing heap
    expect(read).toContain(w.id); // the connection write
    await gw.close();
  });
});

describe("§39 criterion 13 — revocation is two-sided", () => {
  it("after the grant is struck the write refuses; a second connection still lands; past writes keep their author", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox1 = await bind(gw, "alice:folklore", CONN_SEED);
    const inbox2 = await bind(gw, "alice:folklore", CONN2_SEED);
    const past = observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED);
    await inbox1.gateway!.append([past]);

    await gw.revokeConnection({ inbox: inbox1, connectionKey: CONN, ownerSeed: OWNER_SEED });

    // The revoked connection's NEW write refuses.
    await expect(
      inbox1.gateway!.append([observed(FERN, "height", 99, gw.nextTimestamp(), CONN_SEED)]),
    ).rejects.toThrow();
    // A SECOND connection's write still lands.
    const w2 = observed(FERN, "height", 43, gw.nextTimestamp(), CONN2_SEED);
    await inbox2.gateway!.append([w2]);
    expect(inbox2.gateway!.reactor.get(w2.id)).toBeDefined();
    // Every delta the revoked connection wrote keeps its author and stays readable.
    expect(inbox1.gateway!.reactor.get(past.id)!.claims.author).toBe(CONN);
    expect(gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id)).toContain(past.id);
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

    // Into a different inbox: refused, and the message names the store entity, never the inbox id.
    let intoOther: unknown;
    await inbox2
      .gateway!.append([observed(FERN, "height", 7, gw.nextTimestamp(), CONN_SEED)])
      .catch((e: unknown) => (intoOther = e));
    expect(intoOther).toBeInstanceOf(Error);
    expect((intoOther as Error).message).not.toContain("inbox:");
    // Into the primary: refused too.
    await expect(
      gw.append([observed(FERN, "height", 8, gw.nextTimestamp(), CONN_SEED)]),
    ).rejects.toThrow();
    // The bound inbox still accepts it — proving the refusals are about the target, not the key.
    await inbox1.gateway!.append([observed(FERN, "height", 9, gw.nextTimestamp(), CONN_SEED)]);
    await gw.close();
  });
});

describe("§39 criterion 15 — the connection's seed never enters the ground", () => {
  it("a planted leak is SEEN by the scan; a clean grant-write-revoke cycle leaves none", async () => {
    const scanFor = (gws: Gateway[], secret: string): boolean =>
      gws.some((g) => [...g.reactor.snapshot()].some((d) => JSON.stringify(d).includes(secret)));

    // Instrument first (H7): plant a delta whose value IS the seed and prove the scan catches it.
    const planted = await boot();
    await planted.append([observed(FERN, "message", CONN_SEED, 900, OP_SEED)]);
    expect(scanFor([planted], CONN_SEED)).toBe(true);
    await planted.close();

    // Then a clean store: a full grant → write → revoke cycle, and the seed is nowhere.
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const inbox = await bind(gw, "alice:folklore", CONN_SEED);
    await inbox.gateway!.append([observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED)]);
    await gw.revokeConnection({ inbox, connectionKey: CONN, ownerSeed: OWNER_SEED });
    expect(scanFor([gw, inbox.gateway!], CONN_SEED)).toBe(false);
    await gw.close();
  });
});

describe("§39 criterion 16 — no existing delta changes shape; no §20 migration is owed", () => {
  it("a container declared without inboxOf resolves identically and is not composed as an inbox", async () => {
    const gw = await boot();
    // The pre-existing shape: a plain container declaration, no inboxOf pointer.
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const h = observed(FERN, "height", 30, 900, OWNER_SEED);
    await gw.append([h]);

    const rec = gw.containers().containers.get("alice:folklore")!;
    expect(rec.inboxOf).toBeUndefined(); // the new field is absent — the old shape reads unchanged
    expect(gw.containerScope({ containers: ["alice:folklore"] }).map((d) => d.id)).toEqual([h.id]);

    // And an inbox declaration is shape-distinguishable by the presence of the pointer.
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

    // CONN holds WRITE but not ADMIN. Its grant for CONN2 lands but is INEFFECTIVE (a non-admin
    // granter roots no authority), so CONN2's write is still refused — membership is not extended.
    await pool.append([
      signClaims(grantClaims(STORE_ENTITY, CONN2, "write", CONN, pool.nextTimestamp()), CONN_SEED),
    ]);
    await expect(
      pool.append([observed(FERN, "height", 7, gw.nextTimestamp(), CONN2_SEED)]),
    ).rejects.toThrow();

    // The OWNER holds admin (rooted in the operator), so the owner's grant DOES extend membership.
    await pool.append([
      signClaims(
        grantClaims(STORE_ENTITY, CONN2, "write", OWNER, pool.nextTimestamp()),
        OWNER_SEED,
      ),
    ]);
    const w = observed(FERN, "height", 8, gw.nextTimestamp(), CONN2_SEED);
    await pool.append([w]);
    expect(pool.reactor.get(w.id)).toBeDefined();
    await gw.close();
  });
});

describe("§39 — the inbox drops to a total forget (two-sided)", () => {
  it("drop() purges the inbox's own bytes and strikes its declaration; a bystander inbox survives", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        { container: "alice:folklore", trust: "curated", posture: "shared", membership: HEIGHTS },
        1000,
      ),
    ]);
    const backend1 = new MemoryBackend();
    const backend2 = new MemoryBackend();
    const inbox1 = await bind(gw, "alice:folklore", CONN_SEED, backend1);
    const inbox2 = await bind(gw, "alice:folklore", CONN2_SEED, backend2);
    const w1 = observed(FERN, "height", 42, gw.nextTimestamp(), CONN_SEED);
    const w2 = observed(OAK, "height", 50, gw.nextTimestamp(), CONN2_SEED);
    await inbox1.gateway!.append([w1]);
    await inbox2.gateway!.append([w2]);
    expect(await backend1.holds(w1.id)).toBe(true); // baseline: the bytes are there before the drop

    await inbox1.drop();

    // The target is GONE. drop() purges + byte-verifies the pool (it refuses to close if any survive)
    // then closes its store, so a successful drop IS the byte proof; the read and the table confirm
    // it downward.
    expect(gw.containers().containers.has(`inbox:alice:folklore:${CONN}`)).toBe(false);
    const scoped = gw.connectionScope({ bound: "alice:folklore" }).map((d) => d.id);
    expect(scoped).not.toContain(w1.id);
    // The bystander inbox and its bytes SURVIVE — drop struck one inbox, not the container.
    expect(await backend2.holds(w2.id)).toBe(true);
    expect(scoped).toContain(w2.id);
    await gw.close();
  });
});
