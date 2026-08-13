// Bounded renderer execution (SPEC §23.9). A renderer bundle is author-provided code, and §23 v1 ran it
// SYNCHRONOUSLY on the event loop with no timeout — so an infinite-loop bundle wedged EVERY mount (the
// capability-security panel's headline residual on #99, on the anonymous door with an attacker-chosen
// entity). This runs each render in a Node `worker_threads` Worker with a HARD timeout (terminate on
// overrun — which `node:vm`'s timeout cannot guarantee against an async escape) and `resourceLimits` (a
// bundle cannot OOM the host). A second route keeps answering while a bundle spins: the wedge is closed.
//
// HONEST SCOPE (stated so no one over-trusts it): a Worker bounds the HANG / crash / memory. It is NOT
// full object-capability isolation — a worker can still `import('node:fs')` or open a socket. True
// no-fs/no-net ocap (SES-in-worker or isolated-vm) is a FURTHER hardening, deferred to §24 / a deeper
// slice. This closes the wedge the panel named, not ambient authority.
//
// A function cannot cross the thread boundary, so we pass the bundle SOURCE + the (already §23.7-enveloped,
// so JSON/structured-clone-safe) node; the worker imports the bundle from a `data:` URL and calls
// `default(node)`. v1 spawns a worker per render (~ms) — acceptable, and noted; a small warm pool is the
// obvious follow-on. §24.5 (envelope.ts) took the CONCURRENCY half of that follow-on: a quarantine's
// renders run against a per-pool slot count, wall clock, and memory ceiling the operator declares as
// data. Warming the threads themselves is still unbuilt. Every failure — timeout, throw, crash, non-string — folds into a CLEAN refusal that
// leaks nothing of the bundle's internals (serveRoute's own discipline, now enforced across the boundary).

import { Worker } from "node:worker_threads";

// Tunable ceilings (exported so a host may tighten them). The timeout bounds a hanging bundle; the memory
// limits bound one that tries to exhaust the host. Conservative defaults for a single v1 render.
export const RENDER_TIMEOUT_MS = 500;
// The SPAWN ceiling is a SEPARATE clock with a separate job. It bounds thread start, isolate init and
// first schedule — host scheduling no bundle can reach, since a bundle cannot run before `online`. So it
// must not share the render budget: a busy host makes spawn slow, and spawn charged against the render's
// 500ms refuses a healthy render that never executed a line. It is sized to what it measures (a loaded
// 16-core box spawns in ~0.8s) and stays HARD, so a thread that never starts folds to a clean refusal
// rather than hanging.
export const RENDER_SPAWN_TIMEOUT_MS = 10_000;
export const RENDER_MAX_OLD_MB = 128;
export const RENDER_MAX_YOUNG_MB = 32;

// What a caller may learn about a render's fate WITHOUT reading its body. §24.5's envelope needs to
// tell an operator which limit a pool hit; comparing refusal strings would couple the accounting to
// prose that is free to change, so the outcome is reported explicitly instead.
export type RenderOutcome = "ok" | "timeout" | "fault" | "notHtml";

// Per-call overrides of §23.9's ceilings. The memory bound is a PARAMETER rather than a constant
// because §24.5 lets an operator declare a quarantine's own ceiling — a limit that never reached the
// Worker's `resourceLimits` would print in a report and bound nothing.
export interface RenderWorkerOptions {
  // §23.9's SPAWN ceiling (T139), an option rather than a positional parameter because §24.5's
  // options bag reached this signature first. Nothing below the operator sets it.
  readonly spawnTimeoutMs?: number | undefined;
  readonly maxOldMb?: number;
  readonly maxYoungMb?: number;
  readonly onOutcome?: (outcome: RenderOutcome) => void;
}

export interface RenderResult {
  status: number;
  contentType: string;
  body: string;
}

const TEXT = "text/plain; charset=utf-8";
const HTML = "text/html; charset=utf-8";
const timedOut: RenderResult = { status: 500, contentType: TEXT, body: "the renderer timed out" };
// A spawn overrun is the HOST failing to start a thread, not the bundle overrunning its budget. Reporting
// it as "timed out" would claim the renderer ran and was too slow, which is false: it never executed a
// line. The two refusals stay distinguishable so an operator reads the right cause.
const noStart: RenderResult = {
  status: 500,
  contentType: TEXT,
  body: "the renderer could not start",
};
const faulted: RenderResult = { status: 500, contentType: TEXT, body: "the renderer faulted" };
const notHtml: RenderResult = {
  status: 500,
  contentType: TEXT,
  body: "the renderer did not return HTML",
};

// The worker's entry, run via `{ eval: true }` so no separate file must ship in dist. Eval workers are
// CommonJS (so `require` + dynamic `import()` are both available, even in this `type: module` package): the
// async handler awaits the bundle import, calls its default export with the node, and posts the HTML — or a
// generic marker, never the bundle's own error text.
const WORKER_SRC = `
const { parentPort } = require('worker_threads');
parentPort.on('message', async ({ bundle, node }) => {
  try {
    const url = 'data:text/javascript;base64,' + Buffer.from(bundle, 'utf8').toString('base64');
    const mod = await import(url);
    const fn = mod && mod.default;
    if (typeof fn !== 'function') { parentPort.postMessage({ kind: 'notHtml' }); return; }
    const html = fn(node);
    if (typeof html !== 'string') { parentPort.postMessage({ kind: 'notHtml' }); return; }
    parentPort.postMessage({ kind: 'ok', html });
  } catch {
    parentPort.postMessage({ kind: 'fault' });
  }
});
`;

// Run one render in a bounded worker. Resolves to a RenderResult, NEVER rejects — every failure folds into
// a clean refusal, and the worker is always terminated (no leak of the thread on the timeout path).
export function renderInWorker(
  bundle: string,
  node: unknown,
  timeoutMs: number | undefined = RENDER_TIMEOUT_MS,
  opts: RenderWorkerOptions = {},
): Promise<RenderResult> {
  return new Promise((resolve) => {
    // The thread may refuse to start at all (ERR_WORKER_INIT_FAILED, under fd or thread exhaustion) —
    // exactly the state a resource envelope exists for. An uncaught constructor throw would REJECT
    // this promise, which the header above promises never happens: the door would leak a Node error
    // instead of a clean refusal, and §24.5's accounting would record nothing for a render that
    // failed. So it folds like every other failure, and it counts.
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SRC, {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: opts.maxOldMb ?? RENDER_MAX_OLD_MB,
          maxYoungGenerationSizeMb: opts.maxYoungMb ?? RENDER_MAX_YOUNG_MB,
        },
      });
    } catch {
      opts.onOutcome?.("fault");
      resolve(faulted);
      return;
    }
    let settled = false;
    const finish = (r: RenderResult, outcome: RenderOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      opts.onOutcome?.(outcome);
      resolve(r);
    };
    // TWO clocks, not one, AND TWO BUDGETS. Armed only at construction, the timer charged worker
    // SPAWN — thread start, isolate init, first schedule — against the render's budget, and under
    // host load spawn alone consumed most of it: legitimate renders timed out before executing a
    // line, and the memory bound could never win its race with the timer (the T73 flake — the §23.9
    // rail was right and the clock was wrong). Splitting the clocks was only half the repair: both
    // windows still read the render's number, so a host slow enough to spawn past 500ms refused a
    // healthy render anyway (T139). Spawn now carries its OWN budget, sized to host scheduling;
    // `online` — the moment the bundle can actually run — re-arms a fresh RENDER bound at the
    // operator's number. Both windows stay hard; no path is unbounded.
    const budget = timeoutMs ?? RENDER_TIMEOUT_MS;
    // The spawn window folds as `fault`, not `timeout`: the pool's `timedOut` counter means "the
    // pool's clock fired on a render", and a thread that never started ran no render to overrun.
    // Charging it there would send an operator to widen `renderTimeoutMs`, which cannot help. The
    // COUNTER is coarser than the BODY, and deliberately: `noStart` still names the host as the
    // cause where an operator reads a cause, while §24.5's report has no finer bucket than
    // `faulted` (whose own contract already covers a worker that died rather than a bundle that
    // threw). A fifth counter is a §24.5 report widening, and belongs to that section, not here.
    const spawnBudget = opts.spawnTimeoutMs ?? RENDER_SPAWN_TIMEOUT_MS;
    let timer = setTimeout(() => finish(noStart, "fault"), spawnBudget);
    worker.once("online", () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish(timedOut, "timeout"), budget);
    });
    worker.on("message", (msg: { kind?: string; html?: string }) => {
      if (msg.kind === "ok" && typeof msg.html === "string") {
        finish({ status: 200, contentType: HTML, body: msg.html }, "ok");
      } else if (msg.kind === "notHtml") {
        finish(notHtml, "notHtml");
      } else {
        finish(faulted, "fault");
      }
    });
    worker.on("error", () => finish(faulted, "fault"));
    worker.on("exit", () => finish(faulted, "fault")); // exited before posting (e.g. OOM-reclaimed) → clean refusal
    worker.postMessage({ bundle, node });
  });
}
