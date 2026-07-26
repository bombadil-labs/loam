// The browser bundle's stand-in for the §23.9 renderer sandbox (`src/gateway/render-worker.ts`). That
// module runs each render in a Node `worker_threads` Worker — no browser analogue, and its Node-only
// internals (a worker-source string that names `worker_threads`) must not ride into a browser-safe,
// zero-`node:` bundle. The browser peer never serves a rendered route (the live React host, §23's deferred
// slice, paints them a different way), so this satisfies the import with a function that refuses loudly.
export function renderInWorker() {
  throw new Error("the renderer sandbox (worker_threads) is not part of the browser peer");
}

// The per-render wall-clock BUDGET, on the other hand, is a floor value rather than a mechanism: it is
// the number the artifact host adopts so the two hosts carry visibly the same clock (SPEC §30), and an
// emitted page must state it whether or not this peer can run a worker. Kept byte-equal to
// `render-worker.ts`'s export on purpose — two clocks that disagree would be a divergence behind one
// content address, which is the whole thing that export exists to prevent.
export const RENDER_TIMEOUT_MS = 500;
