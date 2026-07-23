// One rail, in its own file because it mocks the filesystem seam and the mock is file-wide: a
// failed rename in `ArchiveBackend.append` must unlink its temp file. Left behind, the orphan is a
// FULL delta at a name no read returns — the byte-at-rest shape §11 hunts — and wherever the write
// landed, the next `git add -A` offers it to history, where no purge reaches. A mutation run once
// committed this repo's own erasure canary exactly that way (T67, prosecution round 7).

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      if (String(from).endsWith(".tmp")) throw new Error("simulated rename failure (EIO)");
      return real.renameSync(from, to);
    },
  };
});

// Imported AFTER the mock so the driver binds the throwing renameSync.
const { ArchiveBackend } = await import("../../src/store/archive.js");

describe("ArchiveBackend.append never strands its temp file", () => {
  it("a failed rename unlinks the orphan instead of leaving a full delta on disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "loam-orphan-"));
    const store = new ArchiveBackend(root);
    const delta = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    await expect(store.append([delta])).rejects.toThrow(/simulated rename failure/);
    const fan = readdirSync(join(root, delta.id.slice(0, 2)));
    expect(fan.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await store.close();
  });
});
