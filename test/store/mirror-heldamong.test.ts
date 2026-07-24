// T70 (health) — the batch byte probe crosses the mirror combinator. `heldAmong` was added to the
// seam so the boot heal's verdict is one pass instead of one archive sweep per dead id; a health
// door polling the SAME question through a MirrorBackend would fall back to the composite per-id
// `holds` — each call a full archive sweep on absence — and re-enter the exact cliff the seam
// method exists to avoid. So the combinator forwards: ask each tier (its batch probe if offered,
// else its cheap per-id holds), union the answers, and reject if either tier cannot answer (H9 —
// the same fail-closed composition `holds` keeps).

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
    await mirror.append([d2]); // only the cold side holds this one
    const store = new MirrorBackend(primary, mirror);

    const held = await store.heldAmong([d1.id, d2.id, "de".repeat(32)]);
    expect(held.has(d1.id)).toBe(true);
    expect(held.has(d2.id)).toBe(true); // the mirror's lone byte still counts (§11 covers both tiers)
    expect(held.size).toBe(2); // the absent id is not held — not an echo of the input
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
        holdsCalled = true; // the combinator must route around this when heldAmong exists
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

    // The primary's clean answer must not launder the mirror's silence into "settled".
    await expect(store.heldAmong([d1.id])).rejects.toThrow(/mirror.*unreachable/s);
  });
});
