// A shared esbuild plugin: keep the §23.9 renderer sandbox (`src/gateway/render-worker.ts`, which runs
// each render in a Node `worker_threads` Worker) out of the browser-safe bundles. That module carries a
// worker-source string naming `worker_threads` — Node-only, and it must never ride into a zero-`node:`
// browser bundle (test/browser/bundle.test.ts holds that line). The browser peer never serves a rendered
// route (the live React host, §23's deferred slice, paints them a different way), so a stub that refuses
// loudly is the honest stand-in. Used by scripts/build-bundles.mjs and scripts/build-site.mjs.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const stubRenderWorker = () => ({
  name: "stub-render-worker",
  setup(b) {
    b.onResolve({ filter: /render-worker(\.js)?$/ }, () => ({
      path: resolve(scriptsDir, "browser-render-worker-stub.mjs"),
    }));
  },
});
