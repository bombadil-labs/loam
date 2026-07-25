// §11 through the places an archive sweep cannot go (ticket T50, hazard H9). `ArchiveBackend.purge`
// walks every fan and removes every file naming a dead id; a wall anywhere in that walk used to be
// silent. Three walls, all of them here:
//
//   - a fan whose LISTING fails (EACCES, EIO, EMFILE) contributed no names, so its copies survived
//     and the count came back as if they never existed;
//   - an entry readdir will not CLASSIFY (a symlink to a directory, a `DT_UNKNOWN` dirent) was
//     excluded before anything opened it — the same false clean, one step earlier;
//   - a file whose REMOVAL fails (EPERM on an immutable file or read-only mount, a Windows sharing
//     violation from a backup agent) threw out of the whole loop, stranding every fan behind it in an
//     order readdir does not fix, so a retry met the same locked file forever.
//
// The rails ask both levels at each wall: what the CALL reports, and what the BYTES and the byte
// verdicts (`holds`, `heldAmong`) say afterwards. They also pin the two halves that must NOT move —
// the failures that genuinely ANSWER (ENOENT: the fan is gone; ENOTDIR: the entry is porch, where a
// README lives) stay tolerated, since `heal` sweeps the whole tombstone set on the boot path and must
// not refuse to start over a fan removed mid-walk.
//
// AND THE DELETE IS DELIBERATELY NOT WIDENED. A dead byte behind a symlinked fan makes purge REFUSE;
// it does not make purge follow the link and delete. `rm` through a link destroys what the link points
// at, so a vault entry aimed at a home directory would turn forgetting one delta into erasing a life.
// The rail asserts the file behind the link is STILL THERE after the refusal. Reading through the link
// is fine and is asserted too — a copy you can see is a copy you must report.
//
// THREE FIXTURE FACTS, all load-bearing:
//
//   - Every delta id begins `1e20` (the content address's multihash prefix), so every appended delta
//     addresses into fan `1e`. A second fan cannot be arranged by choosing deltas; it is hand-planted
//     as a MISFILED COPY — precisely the shape purge walks every fan to catch.
//   - `chmod 000` is unforceable as root and on mounts that ignore mode bits (Windows DrvFs, which CI
//     runs), and a symlink needs a privilege there too. Those rails PROBE their precondition and skip
//     loudly rather than pass vacuously — but a skip proves nothing, so every discrimination that IS
//     this change is ALSO railed through the mocked `node:fs` seam below, which runs everywhere.
//   - The seam matches paths EXACTLY. Matching a suffix would fire on any temp root whose own name
//     happened to end in the fan's name, and the root's own listing is not inside the caller's try.
//
// Deliberately NOT here: the end-to-end `erase()` verdict, which is owned by `holds`/`heldAmong` and
// railed in `test/gateway/erase-tier-completeness.test.ts`.

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

// The filesystem walls a mode bit cannot arrange, armed per test on exact paths.
const seam = vi.hoisted(() => ({
  // A fan whose listing fails with this code — unreadable, vanished, or not a directory.
  blocked: undefined as { path: string; code: string } | undefined,
  // A file whose removal fails — an immutable file, a read-only mount, a backup agent's lock.
  locked: undefined as { path: string; code: string } | undefined,
  // Force this name to the front of every listing that contains it, so a rail can put the wall
  // FIRST and prove the sweep continues past it instead of depending on readdir's arbitrary order.
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

// Imported AFTER the mock so the driver binds the seam-aware fs.
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

// Can it create a symlink to a directory? (Windows wants a privilege for that.)
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

const STRAY = "ab"; // the hand-planted fan, holding a misfiled copy of the dead delta

interface Vault {
  root: string;
  store: InstanceType<typeof ArchiveBackend>;
  id: string;
  canonical: string;
  misfiled: string;
  other: string;
  otherFile: string;
}

// Two dead deltas in the canonical fan, one of them ALSO misfiled into a hand-planted fan a rail can
// wall off. Two ids because the question at a wall is what happened to the OTHER bytes; the misfiled
// copy because that is what a fan-swallowing purge counts as forgotten.
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
    expect(id.slice(0, 2)).not.toBe(STRAY); // two distinct fans, or the fixture proves nothing
    expect(await store.holds(id)).toBe(true);
    await store.close();
  });

  // The discrimination that IS this change, at each code that matters. ENOENT and ENOTDIR ANSWER the
  // question — the fan is gone, or it was never a directory — so the sweep may report its count.
  // EACCES and EIO leave bytes unexamined, so the count is not a completeness and must not pose as
  // one. Both directions in one place, because a fix that refuses over everything would break
  // `heal`'s boot-path sweep just as surely as swallowing everything breaks §11.
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
      // Either way the reachable copy is gone: a refusal is not licence to stop forgetting what is
      // in reach, and a toleration is not licence to skip the sweep.
      expect(existsSync(canonical)).toBe(false);
      expect(existsSync(misfiled)).toBe(true); // never examined, never removed
      await store.close();
    });
  }

  it("finishes the sweep past a file it cannot remove, then refuses", async () => {
    // `force: true` suppresses only "already gone". A lock thrown from the middle of the walk used
    // to discard the rest of it, so the erasure could never converge — every retry met the same
    // locked file first. The wall is forced FIRST here, deliberately.
    const { store, id, canonical, other, otherFile } = await vault();
    seam.locked = { path: canonical, code: "EPERM" };
    seam.first = `${id}.json`;
    try {
      await expect(store.purge([id, other])).rejects.toThrow(/EPERM|could not be removed/);
    } finally {
      seam.locked = undefined;
      seam.first = undefined;
    }
    expect(existsSync(canonical)).toBe(true); // the wall held, and is named in the refusal
    expect(existsSync(otherFile)).toBe(false); // everything behind it was still swept
    await store.close();
  });

  it("answers the batch verdict from the canonical name when the walk cannot run", async () => {
    // `heldAmong` is the verdict on the boot, health and settle paths, and its comment claims
    // `holds`'s reach. `holds` has a canonical `existsSync` probe, which FOLLOWS a symlink where a
    // dirent does not; without the same probe here the two disagree, and this is the one whose empty
    // set reads as a clean bill of health.
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
      // The report level: EACCES is not "this fan holds nothing". A resolved count here is §11
      // reported as kept over plaintext still legible on disk.
      await expect(store.purge([id])).rejects.toThrow(/EACCES|could not be read/i);
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    // The byte level, both directions: the walled copy is exactly where it was, and the fan that
    // COULD be read was still swept.
    expect(existsSync(misfiled)).toBe(true);
    expect(existsSync(canonical)).toBe(false);
    await store.close();
  });

  denied("leaves both byte verdicts unprovable, never clean, for the retained id", async () => {
    const { root, store, id } = await vault();
    chmodSync(join(root, STRAY), 0o000);
    try {
      await store.purge([id]).catch(() => undefined);
      // The object level a caller weighing completeness reads (§11's verdict), in both its forms.
      // `clean` would authorize "erased" over bytes nobody looked at; held or unprovable are both
      // honest. These answer honestly on their own — pinned beside the report so a purge that
      // refuses is never mistaken FOR the verdict, and so the two levels are asserted to agree.
      expect(await verdict(store.holds(id))).not.toBe("clean");
      expect(await verdict(store.heldAmong([id]).then((h) => h.has(id)))).not.toBe("clean");
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
      await expect(pair.purge([id])).rejects.toThrow(/EACCES|could not be read/i);
    } finally {
      chmodSync(join(root, STRAY), 0o755);
    }
    expect(await hot.holds(id)).toBe(false);
    await pair.close();
  });

  linked("refuses over a symlinked fan and does NOT delete through it", async () => {
    // An entry readdir will not classify as a directory is not an entry that holds nothing. It is
    // READ — the copy behind it is real, and both verdicts must see it — and it is not deleted
    // through, because `rm` follows the link to whatever it points at. Refusing to claim
    // completeness is the honest half; widening the delete would be a decision, not a repair.
    const { root, store, id, canonical } = await vault();
    const outside = mkdtempSync(join(tmpdir(), "loam-t50-outside-"));
    copyFileSync(canonical, join(outside, `${id}.json`));
    symlinkSync(outside, join(root, "cd"), "dir");

    await expect(store.purge([id])).rejects.toThrow(/will not delete through/);
    expect(existsSync(join(outside, `${id}.json`))).toBe(true); // the delete was not widened
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(canonical)).toBe(false); // and the real fan was still swept

    // Both verdicts read THROUGH the link, and they agree — a copy that can be seen is reported.
    expect(await store.holds(id)).toBe(true);
    expect((await store.heldAmong([id])).has(id)).toBe(true);
    await store.close();
  });
});
