// `holdsAny` (SPEC §11): does a store hold bytes filed under ANY id, on any tier it owns? The
// whole-store form of `holds`, with the same reach and the same fail-closed. Each driver: empty
// answers false, one byte answers true, a purge back to empty answers false. The mirror pair
// answers true while EITHER tier holds, and refuses when a tier cannot answer. The archive counts
// a crash-left `.tmp` and refuses on a fan it cannot read. All stores are this file's own temp dirs.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { LocalStorageBackend } from "../../src/store/local-storage.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { MemStorage } from "./mem-storage.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "loam-holds-any-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const one = (): Delta => observed(FERN, "height", 1, 1, GARDENER_SEED);

async function roundTrip(store: StoreBackend) {
  expect(typeof store.holdsAny).toBe("function");
  expect(await store.holdsAny!()).toBe(false);
  const d = one();
  await store.append([d]);
  expect(await store.holdsAny!()).toBe(true);
  await store.purge([d.id]);
  expect(await store.holdsAny!()).toBe(false);
  await store.close();
}

describe("holdsAny: the whole-store byte probe", () => {
  it("memory", async () => roundTrip(new MemoryBackend()));
  it("sqlite", async () => roundTrip(new SqliteBackend(join(tmp(), "s.sqlite"))));
  it("archive", async () => roundTrip(new ArchiveBackend(tmp())));
  it("local storage", async () => roundTrip(new LocalStorageBackend("garden", new MemStorage())));
  it("mirror: true while either tier holds, false when both are clean", async () => {
    await roundTrip(new MirrorBackend(new MemoryBackend(), new MemoryBackend()));
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    const d = one();
    await mirror.append([d]);
    expect(await new MirrorBackend(primary, mirror).holdsAny()).toBe(true);
    await primary.append([d]);
    await primary.purge([d.id]);
    expect(await new MirrorBackend(primary, mirror).holdsAny()).toBe(true);
  });
  it("mirror: a tier with no probe makes the store unprovable, never empty", async () => {
    const blind: StoreBackend = {
      append: () => Promise.resolve(0),
      deltasSince: () => Promise.resolve([]),
      purge: () => Promise.resolve(0),
      holds: () => Promise.resolve(false),
      close: () => Promise.resolve(),
    };
    const store = new MirrorBackend(new MemoryBackend(), blind);
    await expect(store.holdsAny()).rejects.toThrow(/could not be proven empty/);
  });
  it("archive: a crash-left .tmp counts as bytes, and an unreadable fan refuses", async () => {
    const root = tmp();
    const store = new ArchiveBackend(root);
    expect(await store.holdsAny()).toBe(false);
    mkdirSync(join(root, "ab"), { recursive: true });
    // A stray file of another shape is not this store's bytes: purge never sweeps it.
    writeFileSync(join(root, "ab", "notes.json"), "{}");
    expect(await store.holdsAny()).toBe(false);
    const stray = `1e20${"ab".repeat(32)}.json.123.tmp`;
    writeFileSync(join(root, "ab", stray), "{}");
    expect(await store.holdsAny()).toBe(true);
    rmSync(join(root, "ab", stray));
    if (process.getuid?.() !== 0) {
      chmodSync(join(root, "ab"), 0o000);
      await expect(store.holdsAny()).rejects.toThrow();
      chmodSync(join(root, "ab"), 0o700);
    }
    await store.close();
  });
});
