// T85 — the tarball half of the stock shelf. `loam register --stock note` is a promise made to
// somebody who ran `npm i -g @bombadil/loam`, so the shelf has to be IN the tarball; and the
// barrel re-exports `StockSchema` as a type, which resolves through the declaration file it names.
// A `files` field that stopped shipping `dist/stock/` would install a flag with nothing behind it.
//
// THIS FILE PINS THE TARBALL ONLY. That the barrel re-export EXISTS is a separate rail, in
// test/cli/stock.test.ts, which imports the shelf and its type through `src/index.ts`. Neither
// half is worth much without the other: a shipped file nobody exports, or an export in no tarball.
//
// A NEW file rather than an extension of test/cli/pack.test.ts, which is T82's frozen rail
// (`test/cli/pack-slate.test.ts` set the precedent). Like that one, this is not red-first-able:
// `files` ships `dist` wholesale today, so the pin guards a future NARROWING of that glob.

import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

// `npm pack` is the heaviest external process in the suite — same hang-guard pack.test.ts carries.
vi.setConfig({ testTimeout: 15000 });

describe("npm pack: the stock shelf rides the tarball", () => {
  it("ships the stock module and the declaration its type re-export resolves through", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32", // npm is a .cmd on windows
    });
    type Manifest = { files: Array<{ path: string }> };
    // npm <= 11 emits a one-element array; npm 12 emits an object keyed by package name.
    const parsed = JSON.parse(raw) as [Manifest] | Record<string, Manifest>;
    const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths).toContain("dist/stock/index.js");
    expect(paths).toContain("dist/stock/index.d.ts");
  });
});
