import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const dead = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const other = observed(FERN, "height", 34, 2000, GARDENER_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-heal-verdict-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const purgeLies = (inner: StoreBackend): StoreBackend => ({
  append: (d) => inner.append(d),
  deltasSince: (k) => inner.deltasSince(k),
  purge: (ids) => Promise.resolve([...ids].length),
  holds: (id) => inner.holds(id),
  close: () => inner.close(),
});

const purgeThrows = (inner: StoreBackend): StoreBackend => ({
  append: (d) => inner.append(d),
  deltasSince: (k) => inner.deltasSince(k),
  purge: () => Promise.reject(new Error("read-only mount: purge refused")),
  holds: (id) => inner.holds(id),
  close: () => inner.close(),
});

describe("T70: heal reports a byte verdict, never trusts a purge's count", () => {
  it("a mirror whose purge LIES (success, bytes remain) is reported — the count is not the verdict", async () => {
    const primaryInner = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    await primaryInner.append([dead]);
    await mirrorInner.append([dead]);
    const store = new MirrorBackend(primaryInner, purgeLies(mirrorInner));

    const report = await store.heal(new Set([dead.id]));

    expect(await mirrorInner.holds(dead.id)).toBe(true);
    expect(report.purgeFailures.length).toBeGreaterThan(0);
    expect(report.purgeFailures.some((m) => m.includes(dead.id))).toBe(true);
  });

  it("a tier whose purge THROWS is reported AND its dead id is verified still held (never swallowed)", async () => {
    const primaryInner = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    await primaryInner.append([dead]);
    await mirrorInner.append([dead]);
    const store = new MirrorBackend(primaryInner, purgeThrows(mirrorInner));

    const report = await store.heal(new Set([dead.id]));

    expect(report.toMirror).toBeGreaterThanOrEqual(0);
    expect(report.purgeFailures.some((m) => m.includes("refused"))).toBe(true);
    expect(await mirrorInner.holds(dead.id)).toBe(true);
    expect(report.purgeFailures.some((m) => m.includes(dead.id))).toBe(true);
  });

  it("a HEALTHY sweep that truly removes the bytes reports nothing — the verdict is silent when clean", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    await primary.append([dead]);
    await mirror.append([dead]);
    const store = new MirrorBackend(primary, mirror);

    const report = await store.heal(new Set([dead.id]));

    expect(await primary.holds(dead.id)).toBe(false);
    expect(await mirror.holds(dead.id)).toBe(false);
    expect(report.purgeFailures).toEqual([]);
  });
});

describe("T70: ArchiveBackend.heldAmong — one pass over the bytes, holds's reach", () => {
  it("finds a canonical byte AND a misfiled straggler; an absent id is not reported held", async () => {
    const root = join(tmp, "archive-heldamong");
    const archive = new ArchiveBackend(root);
    await archive.append([dead]);
    const alienFan = join(root, "zz");
    mkdirSync(alienFan, { recursive: true });
    writeFileSync(join(alienFan, `${other.id}.json.99999.tmp`), "{}");

    const held = await archive.heldAmong([dead.id, other.id, "de".repeat(32)]);
    expect(held.has(dead.id)).toBe(true);
    expect(held.has(other.id)).toBe(true);
    expect(held.size).toBe(2);
    expect(await archive.heldAmong([])).toEqual(new Set());
    await archive.close();
  });
});

describe("T70: heal prefers the batch probe and honours its refusal", () => {
  const probeDouble = (
    heldAmong: () => Promise<Set<string>>,
    holdsCalled: { value: boolean },
  ): StoreBackend => {
    const inner = new MemoryBackend();
    return {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: (batch) => inner.purge(batch),
      holds: (id) => {
        holdsCalled.value = true;
        return inner.holds(id);
      },
      heldAmong,
      close: () => inner.close(),
    };
  };

  it("uses heldAmong, not per-id holds, on a tier that offers it", async () => {
    const holdsCalled = { value: false };
    const mirror = probeDouble(() => Promise.resolve(new Set([dead.id])), holdsCalled);
    const store = new MirrorBackend(new MemoryBackend(), mirror);

    const report = await store.heal(new Set([dead.id]));

    expect(report.purgeFailures.some((m) => m.includes(dead.id))).toBe(true);
    expect(holdsCalled.value).toBe(false);
    await store.close();
  });

  it("a batch probe that REJECTS marks the whole set unproven, never clean (H9)", async () => {
    const holdsCalled = { value: false };
    const mirror = probeDouble(
      () => Promise.reject(new Error("archive fan unreadable")),
      holdsCalled,
    );
    const store = new MirrorBackend(new MemoryBackend(), mirror);

    const report = await store.heal(new Set([dead.id]));

    expect(report.purgeFailures.some((m) => m.includes(dead.id) && m.includes("unreadable"))).toBe(
      true,
    );
    await store.close();
  });
});
