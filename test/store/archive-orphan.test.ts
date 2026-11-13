import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (String(from).endsWith(".tmp")) throw new Error("simulated rename failure (EIO)");
      return real.rename(from, to);
    },
  };
});

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
