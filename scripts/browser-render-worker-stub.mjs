// The browser bundle's stand-in for the §23.9 renderer sandbox (`src/gateway/render-worker.ts`). That
// module runs each render in a Node `worker_threads` Worker — no browser analogue, and its Node-only
// internals (a worker-source string that names `worker_threads`) must not ride into a browser-safe,
// zero-`node:` bundle. The browser peer never serves a rendered route (the live React host, §23's deferred
// slice, paints them a different way), so this satisfies the import with a function that refuses loudly.
export function renderInWorker() {
  throw new Error("the renderer sandbox (worker_threads) is not part of the browser peer");
}
