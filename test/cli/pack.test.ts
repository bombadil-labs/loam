// The package surface, pinned: `npm pack` must ship the library entry and the `loam` bin, or a
// turnkey `npm i -g @bombadil/loam` installs a command that isn't there. This guards the
// files/bin/exports fields against silent regression.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("npm pack: the turnkey surface", () => {
  it("ships the library entry and the loam bin", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32", // npm is a .cmd on windows
    });
    type Manifest = { files: Array<{ path: string }> };
    // npm <= 11 emits a one-element array; npm 12 emits the manifest object itself.
    const parsed = JSON.parse(raw) as Manifest | [Manifest];
    const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain("dist/index.d.ts");
    expect(paths).toContain("dist/cli/bin.js"); // the bin package.json points at
    expect(paths).toContain("LICENSE-MIT"); // dual license: both texts ride the tarball
    expect(paths).toContain("LICENSE-APACHE");
  });
});
