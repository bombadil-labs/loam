import { describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";

const errno = (code: string, what: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: ${what}`), { code });

const seam = vi.hoisted(() => ({
  blocked: undefined as { path: string; code: string } | undefined,
  locked: undefined as { path: string; code: string } | undefined,
  first: undefined as string | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    readdirSync: ((path: Parameters<typeof real.readdirSync>[0], options?: unknown) => {
      if (seam.blocked?.path === String(path)) {
        throw errno(seam.blocked.code, `scandir '${String(path)}'`);
      }
      const out = (real.readdirSync as (p: unknown, o?: unknown) => unknown)(path, options);
      const names = out as unknown[];
      if (seam.first !== undefined && Array.isArray(names) && names.includes(seam.first)) {
        return [seam.first, ...names.filter((n) => n !== seam.first)];
      }
      return out;
    }) as typeof real.readdirSync,
    rmSync: ((path: Parameters<typeof real.rmSync>[0], options?: unknown) => {
      if (seam.locked?.path === String(path)) {
        throw errno(seam.locked.code, `unlink '${String(path)}'`);
      }
      return (real.rmSync as (p: unknown, o?: unknown) => void)(path, options);
    }) as typeof real.rmSync,
  };
});

const { ArchiveBackend } = await import("../../src/store/archive.js");

const eaccesForceable = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), "loam-t50-probe-"));
  try {
    chmodSync(probe, 0o000);
    readdirSync(probe);
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(probe, 0o755);
  }
})();

const symlinkForceable = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), "loam-t50-probe-"));
  try {
    mkdirSync(join(probe, "target"));
    symlinkSync(join(probe, "target"), join(probe, "link"), "dir");
    return statSync(join(probe, "link")).isDirectory();
  } catch {
    return false;
  }
})();

const denied = eaccesForceable ? it : it.skip;
const linked = symlinkForceable ? it : it.skip;

const STRAY = "ab";

interface Vault {
  root: string;
  store: InstanceType<typeof ArchiveBackend>;
  id: string;
  canonical: string;
  misfiled: string;
  other: string;
  otherFile: string;
}

async function vault(): Promise<Vault> {
  const root = mkdtempSync(join(tmpdir(), "loam-t50-"));
  const store = new ArchiveBackend(root);
  const dead = observed(FERN, "height", 30, 1000, GARDENER_SEED);
  const also = observed(FERN, "girth", 7, 1001, GARDENER_SEED);
  await store.append([dead, also]);
  const canonical = join(root, dead.id.slice(0, 2), `${dead.id}.json`);
  mkdirSync(join(root, STRAY), { recursive: true });
  const misfiled = join(root, STRAY, `${dead.id}.json`);
  copyFileSync(canonical, misfiled);
  return {
    root,
    store,
    id: dead.id,
    canonical,
    misfiled,
    other: also.id,
    otherFile: join(root, also.id.slice(0, 2), `${also.id}.json`),
  };
}

const verdict = (probe: Promise<boolean>): Promise<string> =>
  probe.then(
    (held) => (held ? "held" : "clean"),
    () => "unprovable",
  );

describe("T50: ArchiveBackend.purge at a wall — the seam, on every platform", () => {
  it("holds the fixture's premise: the dead delta is on disk twice, in two fans", async () => {
    const { store, id, canonical, misfiled } = await vault();
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(misfiled)).toBe(true);
    expect(id.slice(0, 2)).not.toBe(STRAY);
    expect(await store.holds(id)).toBe(true);
    await store.close();
  });

  for (const [code, tolerated] of [
    ["ENOENT", true],
    ["ENOTDIR", true],
    ["EACCES", false],
    ["EIO", false],
  ] as const) {
    it(`${tolerated ? "tolerates" : "refuses over"} a fan whose listing fails ${code}`, async () => {
      const { root, store, id, canonical, misfiled } = await vault();
      seam.blocked = { path: join(root, STRAY), code };
      try {
        if (tolerated) await expect(store.purge([id])).resolves.toBe(1);
        else await expect(store.purge([id])).rejects.toThrow(new RegExp(code));
      } finally {
        seam.blocked = undefined;
      }
      expect(existsSync(canonical)).toBe(false);
      expect(existsSync(misfiled)).toBe(true);
      await store.close();
    });
  }

  it("finishes the sweep past a file it cannot remove, then refuses", async () => {
    const { store, id, canonical, other, otherFile } = await vault();
    seam.locked = { path: canonical, code: "EPERM" };
    seam.first = `${id}.json`;
    try {
      await expect(store.purge([id, other])).rejects.toThrow(/EPERM|could not be removed/);
    } finally {
      seam.locked = undefined;
      seam.first = undefined;
    }
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(otherFile)).toBe(false);
    await store.close();
  });

  it("answers the batch verdict from the canonical name when the walk cannot run", async () => {
    const { root, store, id } = await vault();
    seam.blocked = { path: join(root, id.slice(0, 2)), code: "EACCES" };
    try {
      expect([...(await store.heldAmong([id]))]).toEqual([id]);
    } finally {
      seam.blocked = undefined;
    }
    await store.close();
  });
});

describe("T50: ArchiveBackend.purge at a wall — the real filesystem", () => {
  denied("refuses rather than counting an id forgotten over a fan it never examined", async () => {
    const { root, store, id, canonical, misfiled } = await vault();
    chmodSync(join(root, STRAY), 0o000);
    try {
      await expect(store.purge([id])).rejects.toThrow(/EACCES|could not be read/i);
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    expect(existsSync(misfiled)).toBe(true);
    expect(existsSync(canonical)).toBe(false);
    await store.close();
  });

  denied("leaves both byte verdicts unprovable, never clean, for the retained id", async () => {
    const { root, store, id } = await vault();
    chmodSync(join(root, STRAY), 0o000);
    try {
      await store.purge([id]).catch(() => undefined);
      expect(await verdict(store.holds(id))).not.toBe("clean");
      expect(await verdict(store.heldAmong([id]).then((h) => h.has(id)))).not.toBe("clean");
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    await store.close();
  });

  denied("hands the refusal to the tier above, which sweeps its own half regardless", async () => {
    const { root, store, id } = await vault();
    const hot = new MemoryBackend();
    await hot.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const pair = new MirrorBackend(hot, store);
    chmodSync(join(root, STRAY), 0o000);
    try {
      await expect(pair.purge([id])).rejects.toThrow(/EACCES|could not be read/i);
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    expect(await hot.holds(id)).toBe(false);
    await pair.close();
  });

  linked("refuses over a symlinked fan and does NOT delete through it", async () => {
    const { root, store, id, canonical } = await vault();
    const outside = mkdtempSync(join(tmpdir(), "loam-t50-outside-"));
    copyFileSync(canonical, join(outside, `${id}.json`));
    symlinkSync(outside, join(root, "cd"), "dir");

    await expect(store.purge([id])).rejects.toThrow(/will not delete through/);
    expect(existsSync(join(outside, `${id}.json`))).toBe(true);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(canonical)).toBe(false);

    expect(await store.holds(id)).toBe(true);
    expect((await store.heldAmong([id])).has(id)).toBe(true);
    await store.close();
  });
});
