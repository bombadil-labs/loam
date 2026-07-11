// The browser driver's own edges (SPEC §15). The contract suite proves LocalStorageBackend is
// an interchangeable witness to the seam; this file pins what is PARTICULAR to this driver:
// one key per delta under `loam:<store>:` with the canonical wire JSON as the value, quota as
// an atomic all-or-nothing refusal, the seed key structurally outside the delta set, and a
// shared origin's foreign keys left untouched and unseen.

import { describe, expect, it } from "vitest";
import { LocalStorageBackend } from "../../src/store/local-storage.js";
import { toWire } from "../../src/federation/wire.js";
import { canonicalDelta } from "../../src/store/canon.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { MemStorage } from "./mem-storage.js";

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

describe("LocalStorageBackend: a row edited in devtools is corruption", () => {
  it("unparseable bytes under the delta prefix refuse the read", async () => {
    const origin = new MemStorage();
    origin.setItem("loam:garden:deadbeef", "not json at all");
    const store = new LocalStorageBackend("garden", origin);
    await expect(store.deltasSince(new Set())).rejects.toThrow(/corruption/);
    await store.close();
  });

  it("a row filed under a key that is not its id refuses the read", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([d1]);
    // Copy d1's honest row to a key claiming a different id — laundering by relocation.
    origin.setItem(`loam:garden:${d2.id}`, origin.getItem(`loam:garden:${d1.id}`)!);
    await expect(store.deltasSince(new Set())).rejects.toThrow(/corruption/);
    await store.close();
  });
});
