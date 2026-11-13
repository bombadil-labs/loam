import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { claimsToJson, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";

const d1 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const d2 = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const d3 = observed(FERN, "height", 38, 3000, GARDENER_SEED);

const ids = (deltas: readonly Delta[]) => deltas.map((d) => d.id).sort();

const tmp = mkdtempSync(join(tmpdir(), "loam-mirror-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const unreachable = (): StoreBackend => ({
  append: () => Promise.reject(new Error("cold store unreachable")),
  deltasSince: () => Promise.reject(new Error("cold store unreachable")),
  purge: () => Promise.reject(new Error("cold store unreachable")),
  holds: () => Promise.reject(new Error("cold store unreachable")),
  close: () => Promise.reject(new Error("cold store unreachable")),
});

function flaky(inner: StoreBackend): { backend: StoreBackend; repair(): void } {
  let broken = true;
  const refuse = () => Promise.reject(new Error("cold store unreachable"));
  return {
    backend: {
      append: (d) => (broken ? refuse() : inner.append(d)),
      deltasSince: (k) => (broken ? refuse() : inner.deltasSince(k)),
      purge: (ids) => (broken ? refuse() : inner.purge(ids)),
      holds: (id) => (broken ? refuse() : inner.holds(id)),
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
    expect(ids(await mirror.deltasSince(new Set()))).toEqual(ids([d1, d2]));
  });

  it("a mirror failure is lag, not loss: the append succeeds, and it is loud", async () => {
    const primary = new MemoryBackend();
    const onLag = vi.fn();
    const store = new MirrorBackend(primary, unreachable(), { onLag });
    expect(await store.append([d1])).toBe(1);
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
    expect(await store.heal()).toEqual({
      toMirror: 2,
      toPrimary: 0,
      purgedPrimary: 0,
      purgedMirror: 0,
      purgeFailures: [],
    });
    expect(store.lagging).toBe(false);
    expect(ids(await inner.deltasSince(new Set()))).toEqual(ids([d1, d2]));
    expect(await store.heal()).toEqual({
      toMirror: 0,
      toPrimary: 0,
      purgedPrimary: 0,
      purgedMirror: 0,
      purgeFailures: [],
    });
  });

  it("heal() is also the restore: a mirror's memory replants an empty primary", async () => {
    const vault = new MemoryBackend();
    await vault.append([d1, d2, d3]);
    const fresh = new MemoryBackend();
    const store = new MirrorBackend(fresh, vault);
    expect(await store.deltasSince(new Set())).toEqual([]);
    expect(await store.heal()).toEqual({
      toMirror: 0,
      toPrimary: 3,
      purgedPrimary: 0,
      purgedMirror: 0,
      purgeFailures: [],
    });
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([d1, d2, d3]));
  });

  it("a corrupt mirror refuses through heal(): damage is never replanted as health", async () => {
    const root = join(tmp, "vault-corrupt");
    const vault = new ArchiveBackend(root);
    await vault.append([d1]);
    const file = join(root, d1.id.slice(0, 2), `${d1.id}.json`);
    const row = JSON.parse(readFileSync(file, "utf8")) as { claims: unknown };
    row.claims = claimsToJson(d2.claims);
    writeFileSync(file, JSON.stringify(row));
    const primary = new MemoryBackend();
    const store = new MirrorBackend(primary, vault);
    await expect(store.heal()).rejects.toThrow(/corruption/);
    expect(await primary.deltasSince(new Set())).toEqual([]);
  });

  it("a primary failure rejects the append, and the mirror is not written first", async () => {
    const mirror = new MemoryBackend();
    const store = new MirrorBackend(unreachable(), mirror);
    await expect(store.append([d1])).rejects.toThrow(/unreachable/);
    expect(await mirror.deltasSince(new Set())).toEqual([]);
    expect(store.lagging).toBe(false);
  });

  it("purge reaches both sides: the hot store and the vault forget together", async () => {
    const primary = new MemoryBackend();
    const vault = new MemoryBackend();
    const store = new MirrorBackend(primary, vault);
    await store.append([d1, d2]);
    expect(await store.purge([d1.id])).toBe(1);
    expect(ids(await primary.deltasSince(new Set()))).toEqual(ids([d2]));
    expect(ids(await vault.deltasSince(new Set()))).toEqual(ids([d2]));
  });

  it("heal(exclude) never resurrects the excluded: the crash in reverse", async () => {
    const vault = new MemoryBackend();
    await vault.append([d1, d2, d3]);
    const primary = new MemoryBackend();
    await primary.append([d2]);
    const store = new MirrorBackend(primary, vault);
    const report = await store.heal(new Set([d1.id]));
    expect(report.toPrimary).toBe(1);
    expect(ids(await primary.deltasSince(new Set()))).toEqual(ids([d2, d3]));
    expect(ids(await vault.deltasSince(new Set()))).toEqual(ids([d2, d3]));
  });

  it("heal(exclude) also refuses to archive an excluded straggler from the primary", async () => {
    const primary = new MemoryBackend();
    await primary.append([d1, d2]);
    const vault = new MemoryBackend();
    const store = new MirrorBackend(primary, vault);
    await store.heal(new Set([d1.id]));
    expect(ids(await vault.deltasSince(new Set()))).toEqual(ids([d2]));
    expect(ids(await primary.deltasSince(new Set()))).toEqual(ids([d2]));
  });

  it("holds asks BOTH tiers: a byte only the mirror kept is still a byte this store holds", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    const store = new MirrorBackend(primary, mirror);
    await mirror.append([d1]);
    expect(await store.deltasSince(new Set())).toEqual([]);
    expect(await store.holds(d1.id)).toBe(true);
  });

  it("holds is true when only the PRIMARY holds it", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    const store = new MirrorBackend(primary, mirror);
    await primary.append([d1]);
    expect(await store.holds(d1.id)).toBe(true);
    expect(await store.holds(d2.id)).toBe(false);
  });

  it("a tier that cannot answer makes holds REJECT, never resolve false — and NAMES the tier", async () => {
    const store = new MirrorBackend(new MemoryBackend(), unreachable());
    await expect(store.holds(d1.id)).rejects.toThrow(/mirror tier could not be proven clean/);
    await expect(store.holds(d1.id)).rejects.toThrow(/unreachable/);
    const flipped = new MirrorBackend(unreachable(), new MemoryBackend());
    await expect(flipped.holds(d1.id)).rejects.toThrow(/primary tier could not be proven clean/);
  });

  it("close() closes both sides even when one refuses, then reports the refusal", async () => {
    const closed: string[] = [];
    const side = (name: string, fail: boolean): StoreBackend => ({
      append: () => Promise.resolve(0),
      deltasSince: () => Promise.resolve([]),
      purge: () => Promise.resolve(0),
      holds: () => Promise.resolve(false),
      close: () => {
        closed.push(name);
        return fail ? Promise.reject(new Error(`${name} refused to close`)) : Promise.resolve();
      },
    });
    const store = new MirrorBackend(side("primary", true), side("mirror", false));
    await expect(store.close()).rejects.toThrow(/primary refused/);
    expect(closed.sort()).toEqual(["mirror", "primary"]);
  });
});
