// Build the tutorial site (SPEC §16) into `site-dist/` — never committed; CI deploys it to
// GitHub Pages. The page imports `@bombadil/loam/browser` and this build aliases that name to
// the SAME-COMMIT source entry, so the tutorial can never skew from the library it teaches.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { stubRenderWorker } from "./esbuild-stub-render-worker.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The output directory is a PARAMETER, defaulting to the deployed one. This build begins by
// deleting whatever stands at `out`, so two callers sharing one path race: the browser rail
// serves a built site while `test/site/build.test.ts` rebuilds it, and a page vanishes
// mid-suite. `--out <dir>` gives each caller its own directory, which removes the race rather
// than serializing it. CI and Pages pass nothing and keep `site-dist/`.
const outFlag = process.argv.indexOf("--out");
if (outFlag !== -1 && process.argv[outFlag + 1] === undefined) {
  console.error("loam: --out needs a directory");
  process.exit(1);
}
const out = outFlag === -1 ? join(root, "site-dist") : resolve(process.argv[outFlag + 1]);

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

// The capabilities book (T95). Bundled rather than copied, because the page renders from the same
// `chapters.mjs` the anti-rot rail imports — the identity is the guarantee, so the page must not get
// a hand-maintained second copy of the text.
await build({
  entryPoints: [join(root, "demos", "capabilities", "page.mjs")],
  outfile: join(out, "capabilities.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "silent",
});

// The ROOT is a landing page (Myk, 2026-07-26), and the tutorial is one of its three doors. The
// landing is deliberately claim-free — the thesis and the doors, nothing that can rot — because the
// last front door aged badly by carrying content the code outgrew. Anything checkable lives in the
// book, which goes red when stale.
cpSync(join(root, "demos", "site", "index.html"), join(out, "index.html"));
cpSync(join(root, "demos", "tutorial", "index.html"), join(out, "tutorial.html"));
cpSync(join(root, "demos", "tutorial", "style.css"), join(out, "style.css"));
cpSync(join(root, "demos", "tutorial", "packets"), join(out, "packets"), { recursive: true });
// The concept deck: a self-contained standalone page the landing links to, no bundling needed.
cpSync(join(root, "demos", "tutorial", "intro.html"), join(out, "intro.html"));
cpSync(join(root, "demos", "capabilities", "index.html"), join(out, "capabilities.html"));

console.log(`loam: built ${out} (the landing, the tutorial, the deck, the book)`);
