// The mirror's own promises, beyond the shared contract. The primary is authoritative: its
// failures reject, its rows answer every read. The mirror is the shadow: a write reaches it in
// the same append, and when it CANNOT, the append still succeeds — under union a lagging copy
// is merely behind, never wrong — but loudly (`lagging`, `onLag`). `heal()` is one operation
// serving two stories: catch-up (primary → mirror) and restore-after-disaster (mirror →
// primary), because both are the same two-way union.

import { describe, expect, it, vi } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";

const d1 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const d2 = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const d3 = observed(FERN, "height", 38, 3000, GARDENER_SEED);

const ids = (deltas: readonly Delta[]) => deltas.map((d) => d.id).sort();

// A side that refuses every call — the unreachable cold store.
const unreachable = (): StoreBackend => ({
  append: () => Promise.reject(new Error("cold store unreachable")),
  deltasSince: () => Promise.reject(new Error("cold store unreachable")),
  close: () => Promise.reject(new Error("cold store unreachable")),
});

// A side that refuses until repaired — the cold store that comes back.
function flaky(inner: StoreBackend): { backend: StoreBackend; repair(): void } {
  let broken = true;
  const refuse = () => Promise.reject(new Error("cold store unreachable"));
  return {
    backend: {
      append: (d) => (broken ? refuse() : inner.append(d)),
      deltasSince: (k) => (broken ? refuse() : inner.deltasSince(k)),
      close: () => inner.close(),
    },
    repair: () => {
      broken = false;
    },
  };
}

describe("MirrorBackend", () => {
  it("writes through: one append lands on both sides", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    const store = new MirrorBackend(primary, mirror);
    expect(await store.append([d1, d2])).toBe(2);
    expect(ids(await primary.deltasSince(new Set()))).toEqual(ids([d1, d2]));
    expect(ids(await mirror.deltasSince(new Set()))).toEqual(ids([d1, d2]));
    expect(store.lagging).toBe(false);
  });

  it("materializes the batch once: a generator input feeds BOTH sides in full", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    const store = new MirrorBackend(primary, mirror);
    function* batch(): Generator<Delta> {
      yield d1;
      yield d2;
    }
    expect(await store.append(batch())).toBe(2);
    // a consumed-twice iterable would leave the mirror empty and call it success
    expect(ids(await mirror.deltasSince(new Set()))).toEqual(ids([d1, d2]));
  });

  it("a mirror failure is lag, not loss: the append succeeds, and it is loud", async () => {
    const primary = new MemoryBackend();
    const onLag = vi.fn();
    const store = new MirrorBackend(primary, unreachable(), { onLag });
    expect(await store.append([d1])).toBe(1); // the authoritative side has it — that IS success
    expect(store.lagging).toBe(true);
    expect(onLag).toHaveBeenCalledTimes(1);
    expect(onLag.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(ids(await primary.deltasSince(new Set()))).toEqual(ids([d1]));
  });

  it("heal() catches the mirror up after lag and clears the flag", async () => {
    const inner = new MemoryBackend();
    const cold = flaky(inner);
    const store = new MirrorBackend(new MemoryBackend(), cold.backend);
    await store.append([d1, d2]);
    expect(store.lagging).toBe(true);
    expect(ids(await inner.deltasSince(new Set()))).toEqual([]);
    cold.repair();
    expect(await store.heal()).toEqual({ toMirror: 2, toPrimary: 0 });
    expect(store.lagging).toBe(false);
    expect(ids(await inner.deltasSince(new Set()))).toEqual(ids([d1, d2]));
    // healing an already-whole pair moves nothing
    expect(await store.heal()).toEqual({ toMirror: 0, toPrimary: 0 });
  });

  it("heal() is also the restore: a mirror's memory replants an empty primary", async () => {
    const vault = new MemoryBackend();
    await vault.append([d1, d2, d3]);
    const fresh = new MemoryBackend(); // the primary burned down; this is its replacement
    const store = new MirrorBackend(fresh, vault);
    // before healing, reads answer from the primary alone — the mirror is a shadow, not a read path
    expect(await store.deltasSince(new Set())).toEqual([]);
    expect(await store.heal()).toEqual({ toMirror: 0, toPrimary: 3 });
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([d1, d2, d3]));
  });

  it("a primary failure rejects the append, and the mirror is not written first", async () => {
    const mirror = new MemoryBackend();
    const store = new MirrorBackend(unreachable(), mirror);
    await expect(store.append([d1])).rejects.toThrow(/unreachable/);
    // the mirror never runs ahead of the authority it shadows
    expect(await mirror.deltasSince(new Set())).toEqual([]);
    expect(store.lagging).toBe(false);
  });

  it("close() closes both sides even when one refuses, then reports the refusal", async () => {
    const closed: string[] = [];
    const side = (name: string, fail: boolean): StoreBackend => ({
      append: () => Promise.resolve(0),
      deltasSince: () => Promise.resolve([]),
      close: () => {
        closed.push(name);
        return fail ? Promise.reject(new Error(`${name} refused to close`)) : Promise.resolve();
      },
    });
    const store = new MirrorBackend(side("primary", true), side("mirror", false));
    await expect(store.close()).rejects.toThrow(/primary refused/);
    expect(closed.sort()).toEqual(["mirror", "primary"]); // the mirror was not abandoned
  });
});
