// The shipped client artifact, pinned (SPEC §12): `dist/client/index.js` is a self-contained
// browser-safe ESM bundle — rhizomatic's crypto inlined, zero `node:` specifiers, zero bare
// imports for a bundler to trip on. The build aliases rhizomatic's peer transport
// (`node:http`) to a throwing stub; this suite proves the stub left no trace and the bundle
// actually signs.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyDelta } from "@bombadil/rhizomatic";
import { fromWire, type WireDelta } from "../../src/federation/wire.js";

const BUNDLE = join(process.cwd(), "dist", "client", "index.js");

interface ClientModule {
  mintSeed(): string;
  authorForSeed(seed: string): string;
  loamClient(options: { url: string; seed?: string }): {
    author?: string;
    sign(pointers: Array<Record<string, unknown>>): WireDelta;
  };
}

beforeAll(() => {
  execFileSync(process.execPath, [join("scripts", "build-client.mjs")], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});

describe("the browser bundle", () => {
  it("is self-contained: no node: specifiers, no imports left to resolve", () => {
    const text = readFileSync(BUNDLE, "utf8");
    expect(text).not.toMatch(/["']node:/);
    expect(text).not.toMatch(/^import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
  });

  it("executes: mints, derives, signs — and the server-side library verifies it", async () => {
    const client = (await import(pathToFileURL(BUNDLE).href)) as ClientModule;
    const seed = client.mintSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    const author = client.authorForSeed(seed);

    const page = client.loamClient({ url: "http://localhost:0/nowhere", seed });
    expect(page.author).toBe(author);
    const wire = page.sign([
      { role: "subject", at: "plant:fern", context: "note" },
      { role: "value", value: "signed in the bundle's world" },
    ]);
    const delta = fromWire(wire); // recomputes the id — a mismatch would throw
    expect(verifyDelta(delta)).toBe("verified");
    expect(delta.claims.author).toBe(author);
  });
});
