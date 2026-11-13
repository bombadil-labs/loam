import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20000 });

describe("npm pack: the compiled manual rides the tarball", () => {
  it("ships the docs module loam_docs serves from", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    type Manifest = { files: Array<{ path: string }> };
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/server/docs-content.js");
    expect(paths).not.toContain("docs/register-grammar.md");
  });
});
