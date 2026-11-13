import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20000 });

describe("npm pack: the stock shelf rides the tarball", () => {
  it("ships the stock module and the declaration its type re-export resolves through", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    type Manifest = { files: Array<{ path: string }> };
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/stock/index.js");
    expect(paths).toContain("dist/stock/index.d.ts");
  });
});
