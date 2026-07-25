// §11 through the fan directory `purge` could not open (ticket T50, hazard H9). `ArchiveBackend.purge`
// reads each fan once; a fan it cannot LIST contributes no names, so every dead byte parked there —
// the canonical `<id>.json`, a crash-left `<id>.json.<pid>.tmp`, a misfiled copy — survives the sweep.
// The count that comes back then reports a completeness never delivered: it counts the files the
// readable fans gave up and says nothing about the directory nobody could open.
//
// These rails force the unreadable fan for real (`chmod 000`, so `readdirSync` raises EACCES) and ask
// both levels — what the CALL reports, and what the BYTES and the byte verdict (`holds`) say
// afterwards. They also pin the half the fix must NOT break: a VANISHED fan (ENOENT) genuinely holds
// nothing and stays tolerated, since `heal` sweeps the whole tombstone set on the boot path and a fan
// removed while it walks is not a leak.
//
// TWO FIXTURE FACTS, both load-bearing:
//
//   - Every delta id begins `1e20` (the content address's multihash prefix), so every appended delta
//     addresses into fan `1e`. A second fan cannot be arranged by choosing deltas; it is hand-planted
//     as a MISFILED COPY — which is precisely the shape `purge` walks every fan to catch, so the
//     fixture is the real hazard rather than a contrivance.
//   - A permission cannot be arranged for everyone: root ignores mode bits and some mounts (Windows
//     DrvFs) do not honor them. The fixture PROBES that and skips loudly rather than passing
//     vacuously. ENOENT is not forceable by mode bits at all, so that one rail drives the seam through
//     a mocked `readdirSync`; every other rail runs against the real filesystem.
//
// Deliberately NOT here: the end-to-end `erase()` verdict, which is owned by `holds`/`heldAmong` and
// railed in `test/gateway/erase-tier-completeness.test.ts`. This file is about the purge REPORT.

import { describe, expect, it, vi } from "vitest";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";

// Armed per test: the fan whose listing raises ENOENT, as a directory removed between the root's
// listing and its own read would. Nothing else is intercepted.
const seam = vi.hoisted(() => ({ vanished: undefined as string | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    readdirSync: ((path: Parameters<typeof real.readdirSync>[0], options?: unknown) => {
      if (seam.vanished !== undefined && String(path).endsWith(seam.vanished)) {
        const err: NodeJS.ErrnoException = new Error(
          `ENOENT: no such file or directory, scandir '${String(path)}'`,
        );
        err.code = "ENOENT";
        throw err;
      }
      return (real.readdirSync as (p: unknown, o?: unknown) => unknown)(path, options);
    }) as typeof real.readdirSync,
  };
});

// Imported AFTER the mock so the driver binds the seam-aware readdirSync.
const { ArchiveBackend } = await import("../../src/store/archive.js");

// Can this user, on this filesystem, actually be denied a directory listing?
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

const denied = eaccesForceable ? it : it.skip;

const STRAY = "ab"; // the hand-planted fan, holding a misfiled copy of the dead delta

// One dead delta, on disk twice: at its canonical name in fan `1e`, and misfiled in fan `ab` which
// the caller then walls off. A purge that swallows the wall removes the reachable copy, counts the
// id as forgotten, and leaves the other legible.
async function vault(): Promise<{
  root: string;
  store: InstanceType<typeof ArchiveBackend>;
  id: string;
  canonical: string;
  misfiled: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "loam-t50-"));
  const store = new ArchiveBackend(root);
  const dead = observed(FERN, "height", 30, 1000, GARDENER_SEED);
  await store.append([dead]);
  const canonical = join(root, dead.id.slice(0, 2), `${dead.id}.json`);
  mkdirSync(join(root, STRAY), { recursive: true });
  const misfiled = join(root, STRAY, `${dead.id}.json`);
  copyFileSync(canonical, misfiled);
  return { root, store, id: dead.id, canonical, misfiled };
}

describe("T50: ArchiveBackend.purge over a fan it cannot read", () => {
  it("holds the fixture's premise: the dead delta is on disk twice, in two fans", async () => {
    const { store, id, canonical, misfiled } = await vault();
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(misfiled)).toBe(true);
    expect(id.slice(0, 2)).not.toBe(STRAY); // two distinct fans, or the fixture proves nothing
    expect(await store.holds(id)).toBe(true);
    await store.close();
  });

  denied("refuses rather than counting an id forgotten over a fan it never examined", async () => {
    const { root, store, id, canonical, misfiled } = await vault();
    chmodSync(join(root, STRAY), 0o000);
    try {
      // The report level: EACCES is not "this fan holds nothing". A resolved count here is §11
      // reported as kept over plaintext still legible on disk.
      await expect(store.purge([id])).rejects.toThrow(/EACCES|could not read/i);
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    // The byte level, both directions: the walled copy is exactly where it was, and the fan that
    // COULD be read was still swept — a refusal must not become licence to stop forgetting what
    // is in reach.
    expect(existsSync(misfiled)).toBe(true);
    expect(existsSync(canonical)).toBe(false);
    await store.close();
  });

  denied("leaves the byte verdict unprovable, never clean, for the retained id", async () => {
    const { root, store, id } = await vault();
    chmodSync(join(root, STRAY), 0o000);
    try {
      await store.purge([id]).catch(() => undefined);
      // The object level a caller weighing completeness actually reads (§11's verdict). `clean`
      // here would authorize "erased" over bytes nobody looked at; held or unprovable are both
      // honest answers. This half answers honestly on its own (`holds` closed H9 already) — it is
      // pinned beside the report so a purge that starts refusing is never mistaken FOR the verdict,
      // and so the two levels are asserted to agree.
      const verdict = await store.holds(id).then(
        (held) => (held ? "held" : "clean"),
        () => "unprovable",
      );
      expect(verdict).not.toBe("clean");
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    await store.close();
  });

  denied("hands the refusal to the tier above, which sweeps its own half regardless", async () => {
    // The contract `erase` and `heal` are built on: a tier's purge refusal is a FAULT the caller
    // collects (`MirrorBackend.purge` rejects only after both sides were attempted), never a
    // reason for the sibling tier to keep its copy.
    const { root, store, id } = await vault();
    const hot = new MemoryBackend();
    await hot.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const pair = new MirrorBackend(hot, store);
    chmodSync(join(root, STRAY), 0o000);
    try {
      await expect(pair.purge([id])).rejects.toThrow(/EACCES|could not read/i);
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    expect(await hot.holds(id)).toBe(false);
    await pair.close();
  });

  it("still tolerates a fan that VANISHED mid-walk — ENOENT holds nothing", async () => {
    const { store, id, canonical, misfiled } = await vault();
    seam.vanished = STRAY;
    try {
      // Absence is the one readdir failure that is genuinely an answer, and `heal` depends on it:
      // the boot-path sweep must not refuse because a fan was removed while it walked.
      await expect(store.purge([id])).resolves.toBe(1);
    } finally {
      seam.vanished = undefined;
    }
    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(misfiled)).toBe(true); // untouched: the walk was told it was gone
    await store.close();
  });
});
