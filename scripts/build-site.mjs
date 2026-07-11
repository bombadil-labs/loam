// Build the tutorial site (SPEC §16) into `site-dist/` — never committed; CI deploys it to
// GitHub Pages. The page imports `@bombadil/loam/browser` and this build aliases that name to
// the SAME-COMMIT source entry, so the tutorial can never skew from the library it teaches.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site-dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "site", "app.mjs")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  alias: {
    "@bombadil/loam/browser": join(root, "src", "browser", "index.ts"),
    "node:http": join(root, "scripts", "client-node-http-stub.mjs"),
  },
  legalComments: "none",
  logLevel: "silent",
});

cpSync(join(root, "site", "index.html"), join(out, "index.html"));
cpSync(join(root, "site", "style.css"), join(out, "style.css"));
cpSync(join(root, "site", "packets"), join(out, "packets"), { recursive: true });

console.log("loam: built site-dist/ (the tutorial, self-contained)");
