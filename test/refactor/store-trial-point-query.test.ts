import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  createMemoryStore,
  makeNegationClaims,
  parseTerm,
  signClaims,
  StoreError,
  StoreFaultError,
  StoreReactor,
  type Delta,
  type PeerStore,
  type StoreMeter,
} from "@bombadil/rhizomatic";
import { openSqliteStore } from "@bombadil/rhizomatic/store/sqlite";
import { governedGatherBody } from "../../src/gateway/accounts.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { eraseClaims, ERASE_ENTITY, LOCAL_CONTROL } from "../../src/gateway/erase-law.js";
import { Gateway, type GatewayOptions } from "../../src/gateway/gateway.js";
import { SLATE_ENTITY } from "../../src/gateway/slate-law.js";
import { CTX_SLATE } from "../../src/gateway/slate-vocab.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { fillStore } from "../helpers/store-fixture.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5e".repeat(32);
const OP = authorForSeed(OP_SEED);
const MOSS = "plant:moss";
const TOKEN = "trial-token";
const PEER_SEED = "c4".repeat(32);
const GOVERNOR_SEED = "9a".repeat(32);
const GOVERNOR = authorForSeed(GOVERNOR_SEED);

type Route = Parameters<NonNullable<GatewayOptions["onReadRoute"]>>[0];

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function sqlitePeer(dir = mkdtempSync(join(tmpdir(), "loam-store-trial-"))) {
  if (!dirs.includes(dir)) dirs.push(dir);
  const store = await openSqliteStore(join(dir, "store.db"));
  closers.push(() => store.close());
  return { dir, store, peer: await store.createPeer("peer:trial", { erasure: "unproven" }) };
}

function counted(peer: PeerStore, read: () => ReturnType<PeerStore["read"]> = () => peer.read()) {
  const calls = { reads: 0 };
  const wrapped: PeerStore = {
    id: peer.id,
    history: peer.history,
    erasure: peer.erasure,
    read: () => {
      calls.reads += 1;
      return read();
    },
    append: (batch) => peer.append(batch),
    purge: () => Promise.reject(new Error("the store read path must never purge")),
    changes: (from, to) => peer.changes(from, to),
  };
  return { calls, peer: wrapped };
}

async function host(storeReads?: { peer: PeerStore }, register = true) {
  const routes: Route[] = [];
  const gw = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    ...(storeReads === undefined ? {} : { storeReads }),
    onReadRoute: (r) => void routes.push(r),
  });
  if (register) gw.register(PLANT, PLANT_POLICY, [FERN, MOSS], undefined, PLANT_WRITABLE);
  const handle: ServerHandle = await serve({
    mounts: { garden: gw },
    tokens: { [TOKEN]: { actor: OP_SEED } },
    port: 0,
    host: "127.0.0.1",
  });
  closers.push(async () => {
    await handle.close();
    await gw.close();
  });
  const query = async (q: string) => {
    const res = await fetch(`${handle.url}/garden/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query: q }),
    });
    return (await res.json()) as {
      data?: Record<string, Record<string, unknown> | null> | null;
      errors?: string[];
    };
  };
  const plant = async (entity: string) =>
    (await query(`{ plant(entity: "${entity}") { height tag } }`)).data?.["plant"];
  return { gw, routes, query, plant };
}

const fern30 = observed(FERN, "height", 30, 1000, OP_SEED);
const fernShade = observed(FERN, "tag", "shade", 1100, OP_SEED);
const fernSun = observed(FERN, "tag", "sun", 1150, OP_SEED);
const mossSoft = observed(MOSS, "tag", "soft", 1200, OP_SEED);
const STORE_DATA = [fern30, fernShade, fernSun, mossSoft];

const operator = (claims: Parameters<typeof signClaims>[0]): Delta => signClaims(claims, OP_SEED);

describe("the store trial: the GraphQL point query answers from the store", () => {
  it("answers the exact view from store data through one snapshot, and the route report names the store and its rounds [gap: the schema surface comes from a manual registration]", async () => {
    const { store, peer } = await sqlitePeer();
    await fillStore(peer, STORE_DATA);
    const { calls, peer: watched } = counted(peer);
    const { gw, routes, plant } = await host({ peer: watched });

    expect(await plant(FERN)).toEqual({ height: 30, tag: ["shade", "sun"] });
    expect(calls.reads).toBe(1);
    const route = routes.at(-1)!;
    expect(route).toMatchObject({ lens: "Plant", entity: FERN, route: "store" });
    expect(route.store!.rounds.some((r) => r.anchors.includes(FERN))).toBe(true);
    expect(store.profile.formatVersion).toBe("rhizomatic-store-sqlite/3");

    const snapshot = await peer.read();
    expect((await snapshot.get(STORE_DATA.map((d) => d.id))).map((d) => d.id).sort()).toEqual(
      STORE_DATA.map((d) => d.id).sort(),
    );
    snapshot.release();
    for (const d of STORE_DATA) expect(gw.reactor.get(d.id)).toBeUndefined();
  });

  it("the store's value wins over a value held only in the gateway's reactor, and with the option off the reactor's value answers", async () => {
    const { peer } = await sqlitePeer();
    await fillStore(peer, STORE_DATA);
    const native99 = observed(FERN, "height", 99, 5000, OP_SEED);

    const onStore = await host({ peer });
    await onStore.gw.append([native99]);
    expect(onStore.gw.reactor.get(native99.id)).toBeDefined();
    expect((await onStore.plant(FERN))?.["height"]).toBe(30);
    expect(onStore.routes.at(-1)?.route).toBe("store");
    for (const d of STORE_DATA) expect(onStore.gw.reactor.get(d.id)).toBeUndefined();

    const off = await host();
    await off.gw.append([native99]);
    expect((await off.plant(FERN))?.["height"]).toBe(99);
    expect(off.routes.at(-1)).toMatchObject({ route: "native", reason: "portable-reads-off" });
  });

  it("an erasure order filed only in the store hides its target, and the bystander claim and entity still answer", async () => {
    const { peer } = await sqlitePeer();
    const order = operator(eraseClaims(fern30.id, OP, OP, 2000));
    await fillStore(peer, [...STORE_DATA, order]);
    const { gw, routes, plant } = await host({ peer });

    expect(await plant(FERN)).toEqual({ height: null, tag: ["shade", "sun"] });
    expect(routes.at(-1)?.route).toBe("store");
    expect(await plant(MOSS)).toEqual({ height: null, tag: ["soft"] });

    const snapshot = await peer.read();
    expect((await snapshot.get([fern30.id, order.id])).length).toBe(2);
    snapshot.release();
    expect(gw.reactor.get(order.id)).toBeUndefined();
    expect(gw.reactor.get(fern30.id)).toBeUndefined();
  });

  it("an erasure order from a pinned erasure governor, filed only in the store, hides its target, and the bystander claim stays", async () => {
    const { peer } = await sqlitePeer();
    const order = signClaims(
      eraseClaims(fern30.id, OP, GOVERNOR, 2000, undefined, undefined, OP),
      GOVERNOR_SEED,
    );
    await fillStore(peer, [...STORE_DATA, order]);
    const { gw, plant } = await host({ peer });
    expect((await plant(FERN))?.["height"]).toBe(30);
    gw.pinErasureGovernors([GOVERNOR]);
    expect(await plant(FERN)).toEqual({ height: null, tag: ["shade", "sun"] });
  });

  it("an erasure order of a negation hides the negation and the claim it negates, and the bystander claim stays", async () => {
    const { peer } = await sqlitePeer();
    const negation = operator(makeNegationClaims(OP, 2000, fernShade.id));
    const order = operator(eraseClaims(negation.id, OP, OP, 2100));
    await fillStore(peer, [...STORE_DATA, negation, order]);
    const { plant } = await host({ peer });
    expect(await plant(FERN)).toEqual({ height: 30, tag: ["sun"] });
  });

  it("a negation filed only in the store removes its claim as the native path does, and the bystander claim stays", async () => {
    const { peer } = await sqlitePeer();
    const negation = operator(makeNegationClaims(OP, 2000, fernShade.id));
    await fillStore(peer, [...STORE_DATA, negation]);
    const onStore = await host({ peer });
    expect(await onStore.plant(FERN)).toEqual({ height: 30, tag: ["sun"] });
    expect(onStore.gw.reactor.get(negation.id)).toBeUndefined();

    const off = await host();
    await off.gw.append([...STORE_DATA, negation]);
    expect(await off.plant(FERN)).toEqual(await onStore.plant(FERN));
  });

  it("a fact appended to the store after a query changes the next answer, and the snapshot revision rises", async () => {
    const { peer } = await sqlitePeer();
    await fillStore(peer, STORE_DATA);
    const { routes, plant } = await host({ peer });
    expect((await plant(FERN))?.["height"]).toBe(30);
    const first = routes.at(-1)!.store!.revision;
    await fillStore(peer, [observed(FERN, "height", 41, 3000, OP_SEED)]);
    expect((await plant(FERN))?.["height"]).toBe(41);
    expect(routes.at(-1)!.store!.revision).toBeGreaterThan(first);
  });

  it("a reopened store file answers the same through a new handle and a new gateway", async () => {
    const first = await sqlitePeer();
    await fillStore(first.peer, STORE_DATA);
    const before = await (await host({ peer: first.peer })).plant(FERN);
    await first.store.close();

    const store = await openSqliteStore(join(first.dir, "store.db"));
    closers.push(() => store.close());
    const after = await (await host({ peer: await store.peer("peer:trial") })).plant(FERN);
    expect(after).toEqual(before);
    expect(after).toEqual({ height: 30, tag: ["shade", "sun"] });
  });

  it("the read path makes no whole-set scan of a metered memory store, while an admin listing does", async () => {
    const meter: StoreMeter = { lookups: 0, visited: 0, scans: 0 };
    const store = createMemoryStore({ meter });
    const peer = await store.createPeer("peer:trial", { erasure: "unproven" });
    await fillStore(peer, [...STORE_DATA, operator(eraseClaims(fern30.id, OP, OP, 2000))]);
    const { routes, plant } = await host({ peer });
    meter.scans = 0;
    expect(await plant(FERN)).toEqual({ height: null, tag: ["shade", "sun"] });
    expect(routes.at(-1)?.route).toBe("store");
    expect(meter.scans).toBe(0);
    expect(meter.lookups).toBeGreaterThan(0);
    for await (const id of store.openAdmin().peer("peer:trial").ids())
      expect(id).toBeTypeOf("string");
    expect(meter.scans).toBeGreaterThan(0);
  });
});

describe("the store trial declines what it cannot answer, and the native path answers", () => {
  it("as-of, an unanchored term, a governed schema and a bound connection each decline with a named reason", async () => {
    const { peer } = await sqlitePeer();
    await fillStore(peer, STORE_DATA);
    const { gw, routes } = await host({ peer });
    gw.register(
      { name: "Wide", alg: 1, body: parseTerm(WIDE) },
      PLANT_POLICY,
      [FERN],
      undefined,
      PLANT_WRITABLE,
    );
    gw.register(
      { name: "Governed", alg: 1, body: governedGatherBody(OP) },
      PLANT_POLICY,
      [FERN],
      undefined,
      PLANT_WRITABLE,
    );
    await gw.append([observed(FERN, "height", 7, 900, OP_SEED)]);

    expect((await gw.readNode("Plant", FERN, 950)).view["height"]).toBe(7);
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "as-of" });
    await gw.readNode("Wide", FERN);
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "unanchored" });
    await gw.readNode("Governed", FERN);
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "governed-lowering" });
    await gw
      .readNode("Plant", FERN, undefined, undefined, { container: "c", inbox: "i" })
      .catch(() => undefined);
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "bound-connection" });
  });

  it("a lens served by a federation channel declines with reason channel", async () => {
    const { peer } = await sqlitePeer();
    await fillStore(peer, STORE_DATA);
    const { gw, routes } = await host({ peer });
    const alice = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: PEER_SEED, registrations: [] }),
    );
    closers.push(() => alice.close());
    await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await alice.append([observed(FERN, "height", 11, 1000, PEER_SEED)]);
    const channel = await gw.openChannel({
      into: "friends",
      prefix: "alice",
      source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    });
    await channel.sync();
    expect((await gw.readNode("alice:Plant", FERN)).view["height"]).toBe(11);
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "channel" });
  });

  it("an erasure request at loam:slate in the store declines, and the reactor's value answers", async () => {
    const { peer } = await sqlitePeer();
    const request = operator({
      timestamp: 2000,
      validFrom: 2000,
      author: OP,
      pointers: [
        {
          role: "slate",
          target: { kind: "entity", entity: { id: SLATE_ENTITY, context: CTX_SLATE } },
        },
      ],
    });
    await fillStore(peer, [...STORE_DATA, request]);
    const { gw, routes, plant } = await host({ peer });
    await gw.append([observed(FERN, "height", 7, 900, OP_SEED)]);
    expect((await plant(FERN))?.["height"]).toBe(7);
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "erasure-request" });
  });

  it("a local-control erasure order in the store declines with reason local-control-erasure", async () => {
    const { peer } = await sqlitePeer();
    const base = eraseClaims(fern30.id, OP, OP, 2000);
    const local = operator({
      ...base,
      pointers: [
        ...base.pointers,
        {
          role: "local-control",
          target: { kind: "entity", entity: { id: fern30.id, context: LOCAL_CONTROL } },
        },
      ],
    });
    await fillStore(peer, [...STORE_DATA, local]);
    const { routes, plant } = await host({ peer });
    expect((await plant(FERN))?.["height"]).toBeNull();
    expect(routes.at(-1)).toMatchObject({ route: "native", reason: "local-control-erasure" });
    expect(ERASE_ENTITY).toBe("loam:erasure");
  });

  it("a gateway refuses to open with both storeReads and portableReads set", async () => {
    const { peer } = await sqlitePeer();
    await expect(
      Gateway.open(new MemoryBackend(), {
        seed: OP_SEED,
        portableReads: true,
        storeReads: { peer },
      }),
    ).rejects.toThrow(/storeReads and portableReads cannot both be set/);
  });
});

describe("the store trial fails closed on a store fault", () => {
  for (const [label, fault, said] of [
    ["a StoreError", new StoreError("store-unavailable", "the lock is held"), "store-unavailable"],
    [
      "a StoreFaultError",
      new StoreFaultError("unasked-ids", {}, "the store named an id nobody asked for"),
      "store fault unasked-ids",
    ],
  ] as const) {
    it(`${label} from the store answers an error, and the reactor's value never answers`, async () => {
      const { peer } = await sqlitePeer();
      await fillStore(peer, STORE_DATA);
      const { peer: broken } = counted(peer, async () => {
        const snapshot = await peer.read();
        return {
          ...snapshot,
          release: () => snapshot.release(),
          scope: () => Promise.reject(fault),
        };
      });
      const { gw, routes, query } = await host({ peer: broken });
      await gw.append([observed(FERN, "height", 99, 5000, OP_SEED)]);
      const body = await query(`{ plant(entity: "${FERN}") { height } }`);
      expect(JSON.stringify(body)).not.toContain("99");
      expect(body.errors?.[0]).toContain(`store read of Plant at ${FERN}: ${said}`);
      expect(routes.filter((r) => r.route === "native")).toEqual([]);
    });
  }

  it("a closed store answers an error, and the reactor's value never answers", async () => {
    const { store, peer } = await sqlitePeer();
    await fillStore(peer, STORE_DATA);
    const { gw, query } = await host({ peer });
    await gw.append([observed(FERN, "height", 99, 5000, OP_SEED)]);
    await store.close();
    const body = await query(`{ plant(entity: "${FERN}") { height } }`);
    expect(JSON.stringify(body)).not.toContain("99");
    expect(body.errors?.[0]).toContain("store-closed");
  });
});

describe("the store trial's rhizomatic", () => {
  it("is 0.11.0-next.11 or later and exports StoreReactor", () => {
    const entry = createRequire(import.meta.url).resolve("@bombadil/rhizomatic");
    const manifest = join(dirname(dirname(entry)), "package.json");
    const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
    const [core, pre] = version.split("-next.");
    const [major, minor, patch] = core!.split(".").map(Number);
    const rank = [major!, minor!, patch!, pre === undefined ? Infinity : Number(pre)];
    const floor = [0, 11, 0, 11];
    const cmp = rank.map((v, i) => Math.sign(v - floor[i]!)).find((s) => s !== 0) ?? 0;
    expect(cmp, version).toBeGreaterThanOrEqual(0);
    expect(typeof StoreReactor.open).toBe("function");
  });
});

const WIDE = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: {
      and: [
        { hasPointer: { targetEntity: { var: "root" } } },
        { inView: { field: "author", term: "input", extract: { role: "subject" } } },
      ],
    },
    in: "input",
  },
};
