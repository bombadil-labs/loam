import { describe, expect, it } from "vitest";
import { LocalStorageBackend, type StorageLike } from "../../src/store/local-storage.js";
import { toWire } from "../../src/federation/wire.js";
import { canonicalDelta } from "../../src/store/canon.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { MemStorage } from "./mem-storage.js";

const OPERATOR_SEED = "0e".repeat(32);

const d1 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const d2 = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const d3 = observed(FERN, "tag", "shade", 3000, GARDENER_SEED);

const ids = (deltas: readonly { id: string }[]) => deltas.map((d) => d.id).sort();

describe("LocalStorageBackend: one key per delta", () => {
  it("stores each delta at loam:<store>:<id>, the value its canonical wire JSON", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    const raw = origin.getItem(`loam:garden:${d1.id}`);
    expect(raw).not.toBeNull();
    expect(raw).toBe(JSON.stringify(toWire(canonicalDelta(d1))));
    await store.close();
  });

  it("purge is removeItem: the key is physically gone from the origin", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1, d2]);
    expect(await store.purge([d1.id])).toBe(1);
    expect(origin.getItem(`loam:garden:${d1.id}`)).toBeNull();
    expect(origin.getItem(`loam:garden:${d2.id}`)).not.toBeNull();
    await store.close();
  });

  it("two stores share one origin without touching each other", async () => {
    const origin = new MemStorage();
    const garden = new LocalStorageBackend("garden", origin);
    const library = new LocalStorageBackend("library", origin);
    await garden.append([d1]);
    await library.append([d2]);
    expect(ids(await garden.deltasSince(new Set()))).toEqual([d1.id]);
    expect(ids(await library.deltasSince(new Set()))).toEqual([d2.id]);
    expect(await garden.purge([d2.id])).toBe(0);
    expect(origin.getItem(`loam:library:${d2.id}`)).not.toBeNull();
    await garden.close();
    await library.close();
  });

  it("foreign keys on the origin are invisible: not deltas, not corruption, not purgeable", async () => {
    const origin = new MemStorage();
    origin.setItem("someone-elses-app", "their business");
    origin.setItem("loamish-but-not-ours", "still theirs");
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    expect(origin.getItem("someone-elses-app")).toBe("their business");
    await store.close();
  });
});

describe("LocalStorageBackend: the store name cannot smuggle the separator", () => {
  it('a store name containing ":" is refused at birth', () => {
    expect(() => new LocalStorageBackend("app:v2", new MemStorage())).toThrow(/separator/);
  });
});

describe("LocalStorageBackend: the seed key is structurally outside the delta set", () => {
  it("loam:<store>:seed is never returned by a read and never purged as a delta", async () => {
    const origin = new MemStorage();
    origin.setItem("loam:garden:seed", "a1".repeat(32));
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    expect(await store.purge(["seed"])).toBe(0);
    expect(origin.getItem("loam:garden:seed")).toBe("a1".repeat(32));
    expect(await store.holds("seed")).toBe(false);
    await store.close();
  });
});

describe("LocalStorageBackend: quota is this disk's edge", () => {
  it("QuotaExceededError mid-batch removes the batch's own writes and rejects the lot", async () => {
    const key = (d: { id: string }) => `loam:garden:${d.id}`;
    const size = (d: typeof d1) => key(d).length + JSON.stringify(toWire(canonicalDelta(d))).length;
    const origin = new MemStorage(size(d1) + size(d2) + 10);
    const store = new LocalStorageBackend("garden", origin);
    await expect(store.append([d1, d2, d3])).rejects.toThrow(/quota/i);
    expect(origin.getItem(key(d1))).toBeNull();
    expect(origin.getItem(key(d2))).toBeNull();
    expect(origin.getItem(key(d3))).toBeNull();
    await store.close();
  });

  it("a quota failure never disturbs what was already durable", async () => {
    const key = (d: { id: string }) => `loam:garden:${d.id}`;
    const size = (d: typeof d1) => key(d).length + JSON.stringify(toWire(canonicalDelta(d))).length;
    const origin = new MemStorage(size(d1) + size(d2) + 10);
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    await expect(store.append([d2, d3])).rejects.toThrow(/quota/i);
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    await store.close();
  });
});

describe("LocalStorageBackend: a poked row quarantines, it does not brick the tab (SPEC §25)", () => {
  it("a foreign key under the prefix is quarantined, and every good fact still resolves", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1, d3]);
    origin.setItem("loam:garden:ui:pins", JSON.stringify(["fern", "moss"]));
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([d1, d3]));
    const pen = await store.quarantine();
    expect(pen).toHaveLength(1);
    expect(pen[0]!.reason).toBe("foreign-key");
    expect(pen[0]!.key).toBe("loam:garden:ui:pins");
    expect(await store.discardRow("loam:garden:ui:pins")).toBe(true);
    expect(origin.getItem("loam:garden:ui:pins")).toBeNull();
    await store.close();
  });

  it("unparseable bytes under a delta-shaped key are set aside, not fatal", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    origin.setItem(`loam:garden:${d2.id}`, "not json at all");
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    const pen = await store.quarantine();
    expect(pen.map((r) => r.reason)).toEqual(["unparseable"]);
    await store.close();
  });

  it("a row filed under a key that is not its id is set aside, never laundered by relocation", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    origin.setItem(`loam:garden:${d2.id}`, origin.getItem(`loam:garden:${d1.id}`)!);
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    const pen = await store.quarantine();
    expect(pen.map((r) => r.reason)).toEqual(["id-mismatch"]);
    expect(pen[0]!.key).toBe(`loam:garden:${d2.id}`);
    await store.close();
  });

  it("re-admits a row whose transient cause cleared, without reconstructing bytes", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    const good = origin.getItem(`loam:garden:${d1.id}`)!;
    origin.setItem(`loam:garden:${d1.id}`, "torn");
    expect(await store.deltasSince(new Set())).toEqual([]);
    expect((await store.quarantine()).map((r) => r.reason)).toEqual(["unparseable"]);
    origin.setItem(`loam:garden:${d1.id}`, good);
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    expect(await store.quarantine()).toEqual([]);
    await store.close();
  });
});

function flakyOver(origin: MemStorage): { storage: StorageLike; fail: () => void } {
  let failing = false;
  return {
    fail: () => (failing = true),
    storage: {
      get length() {
        return origin.length;
      },
      key: (i) => origin.key(i),
      getItem: (k) => origin.getItem(k),
      setItem: (k, v) => {
        if (failing) throw new DOMException("the quota has been exceeded", "QuotaExceededError");
        origin.setItem(k, v);
      },
      removeItem: (k) => origin.removeItem(k),
    },
  };
}

describe("quota reaches the gateway (SPEC §15): the degradation latch", () => {
  it("a direct append over quota rejects whole: nothing ingested, nothing served", async () => {
    const { storage, fail } = flakyOver(new MemStorage());
    const gateway = await Gateway.open(new LocalStorageBackend("tab", storage), {
      seed: OPERATOR_SEED,
    });
    fail();
    await expect(
      gateway.append([observed(FERN, "height", 30, 1000, OPERATOR_SEED)]),
    ).rejects.toThrow(/quota/i);
    expect(gateway.offeredDeltas()).toEqual([]);
    await gateway.close();
  });

  it("a mutation over quota refuses loudly in its own answer; the view never tears", async () => {
    const { storage, fail } = flakyOver(new MemStorage());
    const gateway = await Gateway.open(new LocalStorageBackend("tab", storage), {
      seed: OPERATOR_SEED,
    });
    await gateway.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
    );
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 30) { height } }`);
    await gateway.flush();

    fail();
    const refused = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 44) { height } }`,
    );
    expect(refused.errors?.join(" ")).toMatch(/quota/i);
    const answer = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((answer.data as { plant: { height: number } }).plant.height).toBe(30);
    await gateway.close();
  });

  it("a raw-stream write failure latches the gateway: writes refuse, reads keep answering", async () => {
    const { storage, fail } = flakyOver(new MemStorage());
    const gateway = await Gateway.open(new LocalStorageBackend("tab", storage), {
      seed: OPERATOR_SEED,
    });
    await gateway.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
    );
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 30) { height } }`);
    await gateway.flush();

    fail();
    gateway.reactor.ingest(observed(FERN, "height", 44, 4000, OPERATOR_SEED));
    await expect(gateway.flush()).rejects.toThrow(/quota/i);
    await expect(
      gateway.append([observed(FERN, "height", 50, 5000, OPERATOR_SEED)]),
    ).rejects.toThrow(/can no longer persist/);
    const answer = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(answer.errors).toBeUndefined();
    await gateway.close().catch(() => {});
  });
});

describe("erasure reaches the page (SPEC §15): erasure → purge → removeItem", () => {
  it("the bytes leave the origin's storage and the door refuses the id's return", async () => {
    const origin = new MemStorage();
    const gateway = await Gateway.open(new LocalStorageBackend("tab", origin), {
      seed: OPERATOR_SEED,
    });
    const fact = observed(FERN, "height", 30, 1000, OPERATOR_SEED);
    await gateway.append([fact]);
    await gateway.flush();
    expect(origin.getItem(`loam:tab:${fact.id}`)).not.toBeNull();

    await gateway.erase(fact.id, { reason: "asked and honored" });
    expect(origin.getItem(`loam:tab:${fact.id}`)).toBeNull();
    const survivors = await new LocalStorageBackend("tab", origin).deltasSince(new Set());
    expect(survivors.some((d) => d.id === fact.id)).toBe(false);
    expect(survivors.length).toBeGreaterThan(0);
    await expect(gateway.append([fact])).rejects.toThrow(/was erased/);
    await gateway.close();
  });
});
