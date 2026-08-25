// Bounded AND CONFINED renderer execution (SPEC §23.9; the ocap half is §24.5's open flag, T172). A
// renderer bundle is author-provided code, and §23 v1 ran it SYNCHRONOUSLY on the event loop with no
// timeout — so an infinite-loop bundle wedged EVERY mount (the capability-security panel's headline
// residual on #99, on the anonymous door with an attacker-chosen entity). Each render runs in a Node
// `worker_threads` Worker with a HARD timeout (terminate on overrun — which `node:vm`'s timeout cannot
// guarantee against an async escape) and `resourceLimits` (a bundle cannot OOM the host). A second route
// keeps answering while a bundle spins.
//
// THE WORKER BOUNDS COST; THE CONFINED REALM BOUNDS REACH, and they are different questions. A bare
// Worker is not object-capability isolation: measured, a bundle in one read and wrote any file, read
// `process.env`, called `globalThis.require` (an eval worker carries it as a GLOBAL), called `fetch`, and
// ran `node:child_process`. So a realm is built inside the worker before any bundle byte evaluates, in
// two halves — neither sufficient alone:
//
//   THE MODULE GATE. `module.registerHooks` refuses every specifier that is not a `data:` URL, so
//   `node:fs`, a bare `fs`, `file:`, `http:` and anything a nested `data:` module names all fail to
//   resolve. Its predicate is built from PRIMORDIALS CAPTURED FIRST: the gate runs in the same realm as
//   the bundle, so a gate asking `specifier.startsWith("data:")` through the live prototype is defeated
//   by a bundle that patches `String.prototype.startsWith` before importing (measured, not theorised).
//
//   THE GLOBAL SCRUB, BY ALLOWLIST. The allowlist is the bare-JS global set of a fresh `vm` context plus
//   the authority-free platform names a `(node) => string` render may want; everything else on the
//   worker's `globalThis` is deleted. An allowlist rather than a denylist because the denylist is the
//   half that rots: `globalThis` grows with every Node release, and a name nobody thought of must be
//   DENIED by default rather than admitted by default. The scrub then VERIFIES itself and refuses to run
//   the bundle if a denied name survived — a confinement that reports success it did not achieve is H7
//   at the realm boundary. `console` is REPLACED (not kept) with in-realm no-ops: a bundle's writes into
//   the operator's log are a channel out of the realm, and §23.9 already leaks nothing of a bundle's
//   internals.
//
// This is §30's ENFORCING half for the server host — `artifact-scan.ts` is its cheap decidable half and
// `artifact-realm.ts` the browser sibling (a denylist SEAL there, because a Worker global scope is small
// and known; an allowlist here, because Node's is neither).
//
// WHAT IS STILL NOT BOUNDED, stated so no one over-trusts this either: CPU and wall clock inside the
// realm are the timeout's and the envelope's, unchanged. §22 RESOLVERS are not confined at all — a
// derived function is called synchronously by the resolution program and cannot cross a thread — so they
// keep §22's in-process floor (`esm.ts` states it precisely).
//
// A function cannot cross the thread boundary, so we pass the bundle SOURCE + the (already §23.7-enveloped,
// so JSON/structured-clone-safe) node; the worker imports the bundle from a `data:` URL and calls
// `default(node)`. v1 spawns a worker per render (~ms) — acceptable, and noted; a small warm pool is the
// obvious follow-on. §24.5 (envelope.ts) took the CONCURRENCY half of that follow-on: a quarantine's
// renders run against a per-pool slot count, wall clock, and memory ceiling the operator declares as
// data. Warming the threads themselves is still unbuilt. Every failure — timeout, throw, crash, non-string — folds into a CLEAN refusal that
// leaks nothing of the bundle's internals (serveRoute's own discipline, now enforced across the boundary).

import { runInNewContext } from "node:vm";
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
// The MODULE BODY's own clock, and a SEPARATE budget again for the same reason the spawn clock is: it
// bounds a different thing. Evaluating a bundle's top level happens at publish / bind / bless — never on
// a request — and a real bundle (a packed React renderer) legitimately spends longer parsing and
// evaluating than a warm render spends drawing. Charging it the render's 500ms would refuse honest law
// at the door. A pool's admission does NOT use this: an untrusted bundle is admitted on the ceiling its
// operator declared (§24.5), and fails closed against it.
export const RENDER_ADMIT_TIMEOUT_MS = 5_000;

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

// The platform names the realm KEEPS, beyond the language's own. Every one must be authority-free AND
// SYNCHRONOUS-OR-CANCELLABLE, and the second half of that test is the one that is easy to fail: a name
// can open no file itself and still DISPATCH WORK TO LIBUV'S SHARED THREADPOOL, which `terminate()`
// cannot recall. Measured: `crypto.subtle.deriveBits` with a large PBKDF2 iteration count, queued
// sixteen deep by a module body, kept running after its worker was terminated and blocked the SERVING
// thread's own filesystem I/O for 30 seconds — one anonymous GET, past every clock, past
// `resourceLimits`, past `maxPublicRenders`, past a pool's slot count. That is §23.9's wedge rebuilt
// out of a name that looked pure. So `crypto` and `performance` are NOT here; a `(node) => string`
// render needs neither, and `Math.random()` covers an id.
//
// `console` is listed because the scrub would otherwise remove the binding the preamble replaces.
// Timers are here because they run on the worker's OWN event loop, which dies with the thread.
//
// `MessageChannel` / `MessagePort` ARE here, and the distinction from `BroadcastChannel` is the one to
// read carefully. A BroadcastChannel is reachable BY NAME from any thread in the process: constructing
// one is opening a door outward, so it stays denied. A MessageChannel is a pair the bundle just made,
// connected to nothing — the only ways to hand a port to another thread are a port that is ALREADY
// connected to one (`parentPort`, absent from this realm) or the ability to start one
// (`node:worker_threads`, refused by the module gate). It is realm-local async plumbing, no more
// reaching than `queueMicrotask`. It is also what React's scheduler schedules on, so the measured cost
// of denying it was every real React renderer refused at the door.
//
// What is deliberately ABSENT is as load-bearing as what is present: no `fetch` kit (`Request` /
// `Response` / `Headers` / `FormData`), no `WebSocket`, no `BroadcastChannel`, no streams (a
// `(node) => string` render returns a string), no `navigator` (a dedicated worker's `navigator.storage`
// is persistent bytes).
const PURE_PLATFORM: readonly string[] = [
  "globalThis",
  "global",
  "console",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "structuredClone",
  "queueMicrotask",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "MessageChannel",
  "MessagePort",
  "MessageEvent",
  "Event",
  "EventTarget",
  "Buffer",
  "atob",
  "btoa",
];

// A FLOOR under the receipt, not the receipt itself. The receipt is universal — every surviving global
// must be on the allowlist — and this list adds nothing to it today. It is kept because the receipt
// tests a set that MOVES: widen `PURE_PLATFORM` by one careless line and the universal check goes on
// passing, while these names going missing from it would be the widening that matters. A named floor
// turns that into a red bar instead of a quiet one.
const MUST_BE_GONE: readonly string[] = [
  "process",
  "require",
  "module",
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "BroadcastChannel",
  "navigator",
  "indexedDB",
  "caches",
  "localStorage",
];

// The language's own globals, read from a FRESH `vm` context rather than written down: a hand-kept list
// of ECMAScript intrinsics goes stale on every V8 upgrade, and a stale one deletes something real. The
// context is bare JS — it carries no `process`, no `fetch`, no Node global — so it is exactly the "pure
// computation" half of the allowlist and nothing more. Memoised: one context per process, built on the
// first worker rather than at import, so a peer that never renders never pays for it.
let intrinsics: readonly string[] | undefined;
const pureIntrinsics = (): readonly string[] =>
  (intrinsics ??= runInNewContext("Object.getOwnPropertyNames(globalThis)") as string[]);

// The worker's entry, run via `{ eval: true }` so no separate file must ship in dist. Eval workers are
// CommonJS (so `require` + dynamic `import()` are both available, even in this `type: module` package).
// ORDER IS THE WHOLE DESIGN HERE: capture what the bootstrap needs, install the module gate, scrub the
// realm, verify the scrub, and only then listen for work. Everything the bootstrap keeps lives in
// `const`s of this module's own scope, which the imported bundle cannot name.
//
// TWO MODES over one realm, deliberately one worker source and not two: `render` calls the default
// export, `admit` only asks whether the bundle HAS one. If admission ran anywhere less confined than the
// render, the module body — the half that runs at publish, bind and bless — would be the unguarded one.
const workerSource = (): string => `
const __parentPort = require('worker_threads').parentPort;
const __hooks = require('module').registerHooks;

// Captured BEFORE any bundle code can patch a prototype the gate reads (measured escape).
const __apply = Reflect.apply;
const __startsWith = String.prototype.startsWith;
const __isData = (s) => typeof s === 'string' && __apply(__startsWith, s, ['data:']);
__hooks({
  resolve(specifier, context, next) {
    if (__isData(specifier)) return next(specifier, context);
    throw new Error('this renderer may not import "' + specifier + '"');
  },
});

const __allowed = new Set(${JSON.stringify([...pureIntrinsics(), ...PURE_PLATFORM])});
for (const __name of Object.getOwnPropertyNames(globalThis)) {
  if (__allowed.has(__name)) continue;
  try { delete globalThis[__name]; } catch (e) { /* verified below, never assumed */ }
}
const __noop = function () { return undefined; };
globalThis.console = {
  log: __noop, info: __noop, warn: __noop, error: __noop, debug: __noop, trace: __noop,
  dir: __noop, table: __noop, group: __noop, groupEnd: __noop, time: __noop, timeEnd: __noop,
  assert: __noop, count: __noop,
};

// THE RECEIPT, and it is UNIVERSAL rather than a list. An eval worker's bootstrap is SLOPPY-MODE
// CommonJS, where a failed \`delete\` returns false and an assignment to a non-writable property does
// nothing — both SILENTLY. So the scrub is re-asked as a question: is anything still here that the
// allowlist does not name? A hand-written denylist could only catch the names somebody thought of,
// which is the same rot the allowlist exists to avoid — and it is the FUTURE non-configurable global,
// in a Node nobody has shipped yet, that this has to catch. A realm that did not close throws before a
// single bundle byte is read (H7 at the realm boundary: the difference between confinement and a
// report of confinement).
for (const __name of Object.getOwnPropertyNames(globalThis)) {
  if (!__allowed.has(__name)) throw new Error('the renderer realm did not close: ' + __name);
}
for (const __name of ${JSON.stringify(MUST_BE_GONE)}) {
  if (__name in globalThis) throw new Error('the renderer realm did not close: ' + __name);
}
if ('Console' in globalThis.console) throw new Error('the renderer realm kept the host console');

__parentPort.on('message', async ({ bundle, node, admit }) => {
  try {
    const url = 'data:text/javascript;base64,' + Buffer.from(bundle, 'utf8').toString('base64');
    const mod = await import(url);
    const fn = mod && mod.default;
    if (typeof fn !== 'function') { __parentPort.postMessage({ kind: 'notHtml' }); return; }
    if (admit === true) { __parentPort.postMessage({ kind: 'ok' }); return; }
    const html = fn(node);
    if (typeof html !== 'string') { __parentPort.postMessage({ kind: 'notHtml' }); return; }
    __parentPort.postMessage({ kind: 'ok', html });
  } catch (e) {
    // \`why\` is read ONLY on the admission path, where the reader is the operator publishing the
    // bundle. The render path drops it: a serve refusal leaks nothing of a bundle's internals.
    // It is BUNDLE-AUTHORED text on its way to an operator's terminal and log, so the characters that
    // REPAINT go first — a refusal must not be able to read as its own opposite. C0/C1 covers ESC and
    // BEL; the bidi and format range is the half that a control-character filter misses, and U+202E
    // alone is enough to print a refusal backwards.
    const raw = e && e.message ? String(e.message) : 'the bundle did not evaluate';
    const repaint = /[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]/g;
    const why = raw.replace(repaint, ' ').slice(0, 300);
    __parentPort.postMessage({ kind: 'fault', why });
  }
});
`;

// How one confined run ENDED, before a caller decides what that means. `noStart` is kept distinct from
// `timeout` all the way out here for §23.9's own reason: a thread that never started ran no bundle, and
// telling an operator otherwise sends them to widen a clock that cannot help.
type Stage = "ok" | "notHtml" | "fault" | "timeout" | "noStart";
interface Answer {
  readonly stage: Stage;
  readonly html?: string;
  readonly why?: string;
}

// ONE confined run, shared by both call classes. Resolves, NEVER rejects — every failure folds into a
// stage, and the worker is always terminated (no leak of the thread on the timeout path). Both public
// entries below go through here, which is what keeps a bundle's MODULE BODY from ever meeting a weaker
// realm than its render does.
function inConfinedWorker(
  message: { bundle: string; node?: unknown; admit?: boolean },
  timeoutMs: number | undefined,
  opts: RenderWorkerOptions,
): Promise<Answer> {
  return new Promise<Answer>((resolve) => {
    // The thread may refuse to start at all (ERR_WORKER_INIT_FAILED, under fd or thread exhaustion) —
    // exactly the state a resource envelope exists for. An uncaught constructor throw would REJECT
    // this promise, which the header above promises never happens: the door would leak a Node error
    // instead of a clean refusal, and §24.5's accounting would record nothing for a render that
    // failed. So it folds like every other failure, and it counts.
    let worker: Worker;
    try {
      worker = new Worker(workerSource(), {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: opts.maxOldMb ?? RENDER_MAX_OLD_MB,
          maxYoungGenerationSizeMb: opts.maxYoungMb ?? RENDER_MAX_YOUNG_MB,
        },
      });
    } catch {
      opts.onOutcome?.("fault");
      resolve({ stage: "fault" });
      return;
    }
    let settled = false;
    const finish = (answer: Answer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      // `noStart` is the HOST failing, not the pool's clock firing on a render — §24.5 has no finer
      // bucket than `faulted`, and that contract already covers "the worker died".
      opts.onOutcome?.(answer.stage === "noStart" ? "fault" : answer.stage);
      resolve(answer);
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
    let timer = setTimeout(() => finish({ stage: "noStart" }), spawnBudget);
    worker.once("online", () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish({ stage: "timeout" }), budget);
    });
    worker.on("message", (msg: { kind?: string; html?: string; why?: string }) => {
      if (msg.kind === "ok") {
        finish(
          typeof msg.html === "string"
            ? { stage: "ok", html: msg.html }
            : message.admit === true
              ? { stage: "ok" }
              : { stage: "fault" },
        );
      } else if (msg.kind === "notHtml") {
        finish({ stage: "notHtml" });
      } else {
        finish({ stage: "fault", ...(typeof msg.why === "string" ? { why: msg.why } : {}) });
      }
    });
    worker.on("error", () => finish({ stage: "fault" }));
    worker.on("exit", () => finish({ stage: "fault" })); // exited before posting (e.g. OOM-reclaimed) → clean refusal
    worker.postMessage(message);
  });
}

// Run one render in a confined, bounded worker. Never rejects; every failure folds into a clean refusal
// that leaks nothing of the bundle's internals — `why` is deliberately dropped on this path.
export async function renderInWorker(
  bundle: string,
  node: unknown,
  timeoutMs: number | undefined = RENDER_TIMEOUT_MS,
  opts: RenderWorkerOptions = {},
): Promise<RenderResult> {
  const answer = await inConfinedWorker({ bundle, node }, timeoutMs, opts);
  if (answer.stage === "ok" && typeof answer.html === "string") {
    return { status: 200, contentType: HTML, body: answer.html };
  }
  if (answer.stage === "notHtml") return notHtml;
  if (answer.stage === "timeout") return timedOut;
  if (answer.stage === "noStart") return noStart;
  return faulted;
}

// What a bundle's MODULE BODY did, evaluated in the same confined realm its render will meet.
export interface Admission {
  readonly ok: boolean;
  readonly why?: string;
  // Is this verdict a property of the BUNDLE, or of the moment? A refused import, a syntax error, a
  // module body that overran its budget — those are the bundle, and the same bytes under the same
  // ceiling answer the same way, so a caller may remember them. A thread the HOST could not start is
  // the moment, and remembering it would darken a route for the life of the process over a transient
  // fd exhaustion. Only a settled verdict may be cached; the caller cannot tell them apart from `why`.
  readonly settled: boolean;
}

// EVALUATE a bundle's module body — the harder call class, and the one that used to run on the serving
// thread at publish, bind and bless. Nothing crosses back but a boolean and, on refusal, a reason: no
// namespace, no function, no source. The caller learns only whether the bundle IS a renderer.
//
// The reason IS returned here, unlike on the render path, because the reader is different: an operator
// publishing a bundle needs to know it named an import the realm refuses, or has a syntax error. A
// stranger asking for a route learns nothing.
export async function admitInWorker(
  bundle: string,
  timeoutMs: number | undefined = RENDER_ADMIT_TIMEOUT_MS,
  opts: RenderWorkerOptions = {},
): Promise<Admission> {
  // `onOutcome` is REBUILT rather than spread through: an admission is not a render, and §24.5's
  // counters mean renders. A pool that admits a bad bundle must not read as a pool whose renders
  // faulted, so the callback is dropped by naming the fields that DO cross rather than by subtracting
  // one — a later option added to the bag then defaults to not crossing.
  const answer = await inConfinedWorker({ bundle, admit: true }, timeoutMs, {
    spawnTimeoutMs: opts.spawnTimeoutMs,
    ...(opts.maxOldMb === undefined ? {} : { maxOldMb: opts.maxOldMb }),
    ...(opts.maxYoungMb === undefined ? {} : { maxYoungMb: opts.maxYoungMb }),
  });
  if (answer.stage === "ok") return { ok: true, settled: true };
  if (answer.stage === "notHtml") {
    return {
      ok: false,
      settled: true,
      why: "its `export default` is not a function (node) => html",
    };
  }
  if (answer.stage === "timeout") {
    return {
      ok: false,
      settled: true,
      why: `its module body did not finish inside ${timeoutMs ?? RENDER_ADMIT_TIMEOUT_MS}ms`,
    };
  }
  // The ONE unsettled verdict: the host, not the bundle. See `Admission.settled`.
  if (answer.stage === "noStart") {
    return { ok: false, settled: false, why: "the host could not start a confined thread" };
  }
  return { ok: false, settled: true, why: answer.why ?? "its module body did not evaluate" };
}
