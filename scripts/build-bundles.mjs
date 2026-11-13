import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { stubRenderWorker } from "./esbuild-stub-render-worker.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = {
  client: { in: "src/client/index.ts", out: "dist/client/index.js" },
  browser: { in: "src/browser/index.ts", out: "dist/browser/index.js" },
};

const wanted = process.argv.slice(2);
for (const name of wanted) {
  if (!(name in ENTRIES)) {
    console.error(`unknown bundle "${name}" — the entries are: ${Object.keys(ENTRIES).join(", ")}`);
    process.exit(1);
  }
}

for (const name of wanted.length > 0 ? wanted : Object.keys(ENTRIES)) {
  const entry = ENTRIES[name];
  await build({
    entryPoints: [resolve(root, entry.in)],
    outfile: resolve(root, entry.out),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    alias: { "node:http": resolve(root, "scripts/client-node-http-stub.mjs") },
    plugins: [stubRenderWorker()],
    legalComments: "none",
    logLevel: "silent",
  });
  console.log(`loam: built ${entry.out} (browser-safe, self-contained)`);
}
