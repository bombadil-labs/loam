// Build `dist/client/index.js` — the `@bombadil/loam/client` artifact: one self-contained,
// browser-safe ESM file with rhizomatic's crypto inlined and ZERO `node:` specifiers.
// Runs after tsc in `npm run build`, overwriting tsc's module-by-module emit for this one
// entry (the .d.ts beside it stays tsc's). test/client/bundle.test.ts holds the line.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "src/client/index.ts")],
  outfile: resolve(root, "dist/client/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  alias: { "node:http": resolve(root, "scripts/client-node-http-stub.mjs") },
  legalComments: "none",
  logLevel: "silent",
});

console.log("loam: built dist/client/index.js (browser-safe, self-contained)");
