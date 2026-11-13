export function renderInWorker() {
  throw new Error("the renderer sandbox (worker_threads) is not part of the browser peer");
}

export function admitInWorker() {
  return Promise.resolve({
    ok: false,
    settled: false,
    why: "this peer cannot confine a renderer, so it admits none",
  });
}

export const RENDER_TIMEOUT_MS = 500;
