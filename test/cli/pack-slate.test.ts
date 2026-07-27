// T109 — the tarball half of the slate surface (the T82 contract, one arc later): the barrel
// re-exports slate TYPES, and a type re-export resolves through the declaration file it names, so
// a `files` field that stopped shipping `dist/gateway/slate.d.ts` would hand a consumer
// `SlateReport` and `CutReport` as unresolvable. A NEW file rather than an extension of
// `test/cli/pack.test.ts`, which is T82's frozen rail. Not red-first-able, honestly: `files`
// ships `dist` wholesale today, so this pin guards against a future NARROWING of that glob.

import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

// `npm pack` is the heaviest external process in the suite — same hang-guard pack.test.ts carries.
vi.setConfig({ testTimeout: 15000 });

describe("npm pack: the slate surface's declarations ride the tarball", () => {
  it("ships the .d.ts the slate re-exports resolve through", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32", // npm is a .cmd on windows
    });
    type Manifest = { files: Array<{ path: string }> };
    // npm <= 11 emits a one-element array; npm 12 emits an object keyed by package name.
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/gateway/slate.d.ts");
  });
});
