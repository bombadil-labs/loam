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
