// T247 — the tarball half of the compiled manual. `loam_docs` and `resources/read` serve from
// `dist/server/docs-content.js`, so a packaged install that dropped it would advertise a docs
// tool and refuse every topic. `docs/*.md` itself deliberately does NOT ship: it is the
// generator's source, and `node scripts/build-docs.mjs --check` (run by the build) pins the
// compiled module byte-identical to it — the tarball carries the compilation, never the tree.
//
// A NEW file rather than an extension of test/cli/pack.test.ts, which is T82's frozen rail
// (`test/cli/pack-slate.test.ts` set the precedent). Like its siblings, this is not
// red-first-able: `files` ships `dist` wholesale today, so the pin guards a future NARROWING
// of that glob.

import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

// `npm pack` is the heaviest external process in the suite — same hang-guard pack.test.ts carries.
vi.setConfig({ testTimeout: 20000 });

describe("npm pack: the compiled manual rides the tarball", () => {
  it("ships the docs module loam_docs serves from", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32", // npm is a .cmd on windows
    });
    type Manifest = { files: Array<{ path: string }> };
    // npm <= 11 emits a one-element array; npm 12 emits an object keyed by package name.
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/server/docs-content.js");
    expect(paths).not.toContain("docs/register-grammar.md"); // the source stays home
  });
});
