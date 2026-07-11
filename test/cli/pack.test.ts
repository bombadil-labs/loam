// The package surface, pinned: `npm pack` must ship the library entry and the `loam` bin, or a
// turnkey `npm i -g @bombadil/loam` installs a command that isn't there. This guards the
// files/bin/exports fields against silent regression.

import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

// This spawns `npm pack` (npm is a .cmd through a shell on Windows) — the heaviest external
// process in the suite, ~1s idle. Under `npm run check` load (a build plus a dozen parallel
// workers running real HTTP servers) it can blow vitest's 5s default. The same generous
// hang-guard every other heavy test file here carries, applied to the one that needed it most.
vi.setConfig({ testTimeout: 15000 });

describe("npm pack: the turnkey surface", () => {
  it("ships the library entry and the loam bin", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32", // npm is a .cmd on windows
    });
    type Manifest = { files: Array<{ path: string }> };
    // npm <= 11 emits a one-element array; npm 12 emits an object keyed by package name
    // (lib/utils/tar.js: `output.buffer({ [key]: tarball })`). Take the manifest either way.
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain("dist/index.d.ts");
    expect(paths).toContain("dist/cli/bin.js"); // the bin package.json points at
    expect(paths).toContain("dist/client/index.js"); // the ./client subpath: the browser bundle
    expect(paths).toContain("dist/client/index.d.ts");
    expect(paths).toContain("LICENSE-MIT"); // dual license: both texts ride the tarball
    expect(paths).toContain("LICENSE-APACHE");
  });
});
