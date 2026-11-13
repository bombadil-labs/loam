import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20_000 });

describe("npm pack: the turnkey surface", () => {
  it("ships the library entry and the loam bin", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    type Manifest = { files: Array<{ path: string }> };
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain("dist/index.d.ts");
    expect(paths).toContain("dist/gateway/container.d.ts");
    expect(paths).toContain("dist/gateway/container-identity.d.ts");
    expect(paths).toContain("dist/gateway/adopt-law.d.ts");
    expect(paths).toContain("dist/cli/bin.js");
    expect(paths).toContain("dist/client/index.js");
    expect(paths).toContain("dist/client/index.d.ts");
    expect(paths).toContain("dist/browser/index.js");
    expect(paths).toContain("dist/browser/index.d.ts");
    expect(paths).toContain("LICENSE-MIT");
    expect(paths).toContain("LICENSE-APACHE");
  });
});
