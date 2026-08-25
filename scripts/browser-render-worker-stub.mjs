// The browser bundle's stand-in for the §23.9 renderer sandbox (`src/gateway/render-worker.ts`). That
// module runs each render in a Node `worker_threads` Worker — no browser analogue, and its Node-only
// internals (a worker-source string that names `worker_threads`) must not ride into a browser-safe,
// zero-`node:` bundle. The browser peer never serves a rendered route (the live React host, §23's deferred
// slice, paints them a different way), so this satisfies the import with a function that refuses loudly.
export function renderInWorker() {
  throw new Error("the renderer sandbox (worker_threads) is not part of the browser peer");
}

// Admission is the OTHER half of the same boundary (T172): a renderer's module body is evaluated in the
// confined worker realm, never on the thread that serves. This peer has no such realm, so it admits no
// renderer — and that refusal is the rule stated exactly, not a gap: no confinement, no execution.
//
// It answers a VERDICT rather than throwing, and the two callers then part company, which is worth
// stating because only one of them is quiet. `admitRenderers` (bind, boot, prepareRoute) is tolerant:
// the route stays unmounted, a uniform 404, and the browser peer boots exactly as before. But
// `admitRenderer` — the publish door — turns any refusal into a throw, so `publishRenderer` on this
// peer now FAILS where it used to succeed and only broke later at serve time. That is deliberate: a
// peer that cannot confine a renderer must not record one as published. `settled: false` says the
// verdict is about this host rather than about the bundle, so no caller memoises it.
export function admitInWorker() {
  return Promise.resolve({
    ok: false,
    settled: false,
    why: "this peer cannot confine a renderer, so it admits none",
  });
}

// The per-render wall-clock BUDGET, on the other hand, is a floor value rather than a mechanism: it is
// the number the artifact host adopts so the two hosts carry visibly the same clock (SPEC §30), and an
// emitted page must state it whether or not this peer can run a worker. Kept byte-equal to
// `render-worker.ts`'s export on purpose — two clocks that disagree would be a divergence behind one
// content address, which is the whole thing that export exists to prevent.
export const RENDER_TIMEOUT_MS = 500;
