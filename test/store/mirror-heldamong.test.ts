import { describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const d1 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const d2 = observed(FERN, "height", 34, 2000, GARDENER_SEED);

describe("T70: MirrorBackend.heldAmong — the batch probe forwards through the combinator", () => {
  it("unions the tiers: a byte only the mirror kept is still held by the store", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    await primary.append([d1]);
    await mirror.append([d2]);
    const store = new MirrorBackend(primary, mirror);

    const held = await store.heldAmong([d1.id, d2.id, "de".repeat(32)]);
    expect(held.has(d1.id)).toBe(true);
    expect(held.has(d2.id)).toBe(true);
    expect(held.size).toBe(2);
  });

  it("prefers a tier's own batch probe over its per-id holds", async () => {
    const inner = new MemoryBackend();
    await inner.append([d1]);
    let holdsCalled = false;
    const batchTier: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: (ids) => inner.purge(ids),
      holds: (id) => {
        holdsCalled = true;
        return inner.holds(id);
      },
      heldAmong: () => Promise.resolve(new Set([d1.id])),
      close: () => inner.close(),
    };
    const store = new MirrorBackend(new MemoryBackend(), batchTier);

    const held = await store.heldAmong([d1.id]);
    expect(held.has(d1.id)).toBe(true);
    expect(holdsCalled).toBe(false);
  });

  it("a tier that cannot answer rejects the whole probe, naming the tier (H9)", async () => {
    const broken: StoreBackend = {
      append: () => Promise.reject(new Error("unreachable")),
      deltasSince: () => Promise.reject(new Error("unreachable")),
      purge: () => Promise.reject(new Error("unreachable")),
      holds: () => Promise.reject(new Error("cold store unreachable")),
      close: () => Promise.resolve(),
    };
    const primary = new MemoryBackend();
    await primary.append([d1]);
    const store = new MirrorBackend(primary, broken);

    await expect(store.heldAmong([d1.id])).rejects.toThrow(/mirror.*unreachable/s);
  });
});
