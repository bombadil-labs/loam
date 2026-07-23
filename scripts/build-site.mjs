// Build the tutorial site (SPEC §16) into `site-dist/` — never committed; CI deploys it to
// GitHub Pages. The page imports `@bombadil/loam/browser` and this build aliases that name to
// the SAME-COMMIT source entry, so the tutorial can never skew from the library it teaches.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { stubRenderWorker } from "./esbuild-stub-render-worker.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site-dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "demos", "tutorial", "app.mjs")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  alias: {
    "@bombadil/loam/browser": join(root, "src", "browser", "index.ts"),
    "node:http": join(root, "scripts", "client-node-http-stub.mjs"),
  },
  plugins: [stubRenderWorker()],
  legalComments: "none",
  logLevel: "silent",
});

cpSync(join(root, "demos", "tutorial", "index.html"), join(out, "index.html"));
cpSync(join(root, "demos", "tutorial", "style.css"), join(out, "style.css"));
cpSync(join(root, "demos", "tutorial", "packets"), join(out, "packets"), { recursive: true });
// The concept deck: a self-contained standalone page the landing links to, no bundling needed.
cpSync(join(root, "demos", "tutorial", "intro.html"), join(out, "intro.html"));

console.log("loam: built site-dist/ (the tutorial, self-contained)");
