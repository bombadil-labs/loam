// The browser driver's own edges (SPEC §15). The contract suite proves LocalStorageBackend is
// an interchangeable witness to the seam; this file pins what is PARTICULAR to this driver:
// one key per delta under `loam:<store>:` with the canonical wire JSON as the value, quota as
// an atomic all-or-nothing refusal, the seed key structurally outside the delta set, a shared
// origin's foreign keys left untouched and unseen — and the two §15 compositions the driver
// exists for: quota latching the GATEWAY's degradation, and erasure reaching the origin.

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
    // Byte-identical to a federation offer's row: an export never launders provenance.
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
    expect(await garden.purge([d2.id])).toBe(0); // the library's delta is not the garden's to purge
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
    // "app:v2" would sit inside store "app"'s prefix; each would read the other's rows as
    // corruption — a valid sibling store must never brick its neighbor.
    expect(() => new LocalStorageBackend("app:v2", new MemStorage())).toThrow(/separator/);
  });
});

describe("LocalStorageBackend: the seed key is structurally outside the delta set", () => {
  it("loam:<store>:seed is never returned by a read and never purged as a delta", async () => {
    const origin = new MemStorage();
    origin.setItem("loam:garden:seed", "a1".repeat(32));
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    // No export of deltas can carry key material by accident:
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]);
    // and no purge can be talked into removing it:
    expect(await store.purge(["seed"])).toBe(0);
    expect(origin.getItem("loam:garden:seed")).toBe("a1".repeat(32));
    await store.close();
  });
});

describe("LocalStorageBackend: quota is this disk's edge", () => {
  it("QuotaExceededError mid-batch removes the batch's own writes and rejects the lot", async () => {
    // Room for d1 and d2, not d3: the third setItem of the batch throws.
    const key = (d: { id: string }) => `loam:garden:${d.id}`;
    const size = (d: typeof d1) => key(d).length + JSON.stringify(toWire(canonicalDelta(d))).length;
    const origin = new MemStorage(size(d1) + size(d2) + 10);
    const store = new LocalStorageBackend("garden", origin);
    await expect(store.append([d1, d2, d3])).rejects.toThrow(/quota/i);
    // Atomic, as the seam demands: the two that fit were rolled back with the one that did not.
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
    await store.append([d1]); // durable before the storm
    await expect(store.append([d2, d3])).rejects.toThrow(/quota/i);
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]); // d1 untouched
    await store.close();
  });
});

describe("LocalStorageBackend: a poked row quarantines, it does not brick the tab (SPEC §25)", () => {
  // A key whose suffix is not a delta id was never ours — the tutorial's `loam:tutorial:ui:pins`
  // brick. Under the shared prefix it is FOREIGN: set aside so repair can see it, ignored on the
  // read path, never mistaken for corruption that aborts boot.
  it("a foreign key under the prefix is quarantined, and every good fact still resolves", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1, d3]);
    origin.setItem("loam:garden:ui:pins", JSON.stringify(["fern", "moss"])); // an old build's UI key
    // The store BOOTS: both good facts resolve; the stray key contributes nothing.
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([d1, d3]));
    const pen = await store.quarantine();
    expect(pen).toHaveLength(1);
    expect(pen[0]!.reason).toBe("foreign-key");
    expect(pen[0]!.key).toBe("loam:garden:ui:pins");
    // and repair discard sweeps it deliberately — the removeItem healStrayKeys reached for
    expect(await store.discardRow("loam:garden:ui:pins")).toBe(true);
    expect(origin.getItem("loam:garden:ui:pins")).toBeNull();
    await store.close();
  });

  it("unparseable bytes under a delta-shaped key are set aside, not fatal", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    // A key whose suffix IS a delta id, but whose value is garbage a devtools edit left.
    origin.setItem(`loam:garden:${d2.id}`, "not json at all");
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]); // d1 still resolves
    const pen = await store.quarantine();
    expect(pen.map((r) => r.reason)).toEqual(["unparseable"]);
    await store.close();
  });

  it("a row filed under a key that is not its id is set aside, never laundered by relocation", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    // Copy d1's honest row to a key claiming a different id — laundering by relocation.
    origin.setItem(`loam:garden:${d2.id}`, origin.getItem(`loam:garden:${d1.id}`)!);
    // The honest d1 still resolves; the relocated copy quarantines rather than becoming d2.
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
    // Damage d1's row (a torn write), then let the correct bytes re-sync in place.
    const good = origin.getItem(`loam:garden:${d1.id}`)!;
    origin.setItem(`loam:garden:${d1.id}`, "torn");
    expect(await store.deltasSince(new Set())).toEqual([]); // quarantined, tab still boots
    expect((await store.quarantine()).map((r) => r.reason)).toEqual(["unparseable"]);
    origin.setItem(`loam:garden:${d1.id}`, good); // the delta re-synced, bytes intact
    expect(ids(await store.deltasSince(new Set()))).toEqual([d1.id]); // back in the ground
    expect(await store.quarantine()).toEqual([]);
    await store.close();
  });
});

// A Storage that can be told to start refusing — the deterministic stand-in for an origin
// running out of room mid-life.
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
    expect(gateway.offeredDeltas()).toEqual([]); // the refused delta never entered the view
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
    await gateway.flush(); // durable before the storm

    fail();
    // The mutation writes durably BEFORE it serves (append-then-ingest), so quota surfaces
    // in the mutation's own answer and the live view never shows an unpersisted fact.
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
    await gateway.flush(); // durable before the storm

    fail();
    // A raw-stream emitter (an animated tab's derivation, here spoken directly to the
    // reactor) rides the write-through queue; its failure latches the degradation.
    gateway.reactor.ingest(observed(FERN, "height", 44, 4000, OPERATOR_SEED));
    await expect(gateway.flush()).rejects.toThrow(/quota/i); // the failure surfaces
    // — and LATCHES: from here, writes refuse before ingesting
    await expect(
      gateway.append([observed(FERN, "height", 50, 5000, OPERATOR_SEED)]),
    ).rejects.toThrow(/can no longer persist/);
    // while reads keep answering (the remedy is export or a bigger driver)
    const answer = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(answer.errors).toBeUndefined();
    await gateway.close().catch(() => {}); // close surfaces the same failure; already heard
  });
});

describe("erasure reaches the page (SPEC §15): tombstone → purge → removeItem", () => {
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
    expect(origin.getItem(`loam:tab:${fact.id}`)).toBeNull(); // physically gone
    // the store remembers THAT it forgot: the tombstone rides the same origin
    const survivors = await new LocalStorageBackend("tab", origin).deltasSince(new Set());
    expect(survivors.some((d) => d.id === fact.id)).toBe(false);
    expect(survivors.length).toBeGreaterThan(0); // the tombstone itself
    // and the door refuses the id's return
    await expect(gateway.append([fact])).rejects.toThrow(/was erased/);
    await gateway.close();
  });
});
