// Bounded AND CONFINED renderer execution (SPEC §23.9; the ocap half is §24.5's open flag, T172). A
// renderer bundle is author-provided code, and §23 v1 ran it SYNCHRONOUSLY on the event loop with no
// timeout — so an infinite-loop bundle wedged EVERY mount (the capability-security panel's headline
// residual on #99, on the anonymous door with an attacker-chosen entity). Each render runs in a Node
// `worker_threads` Worker with a HARD timeout (terminate on overrun — which `node:vm`'s timeout cannot
// guarantee against an async escape) and `resourceLimits` (which bound the V8 HEAP, and only that — see
// the residuals below). A second route keeps answering while a bundle spins.
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
// WHAT IS STILL NOT BOUNDED, stated so no one over-trusts this either.
//
//   MEMORY IS NOT ACTUALLY BOUNDED, and this file used to say it was. `resourceLimits` caps V8's
//   HEAP; an `ArrayBuffer`'s backing store is allocated outside it, so a bundle reaches whatever the
//   host has: measured, a body allocating 600MB under a declared 128MB old-generation ceiling ran to
//   completion and took the host's RSS from 45MB to 665MB. §24.5's `maxMemoryMb` is translated into
//   exactly those two knobs, so a pool prints a ceiling it does not enforce — and this slice makes
//   that worse, because untrusted module bodies now run at publish, bind and bless, at routes nobody
//   requested. A real bound needs an rlimit or a cgroup around the process, or a periodic sample of
//   the worker's own usage; neither is here. The claim was softened rather than the code fixed
//   because a false bound is worse than a named one — this is a §23.9/§24.5 widening and its own
//   ticket. What resourceLimits DOES still do is bound heap growth, which is the OOM shape a runaway
//   JS object graph takes.
//
//   CPU and wall clock inside the realm are the timeout's and the envelope's, unchanged.
//
//   §22 RESOLVERS are not confined at all — a derived function is called synchronously by the
//   resolution program and cannot cross a thread — so they keep §22's in-process floor (`esm.ts`
//   states it precisely).
//
// A function cannot cross the thread boundary, so we pass the bundle SOURCE + the (already §23.7-enveloped,
// so JSON/structured-clone-safe) node; the worker imports the bundle from a `data:` URL and calls
// `default(node)`. v1 spawns a worker per render (~ms) — acceptable, and noted; a small warm pool is the
// obvious follow-on. §24.5 (envelope.ts) took the CONCURRENCY half of that follow-on: a quarantine's
// renders run against a per-pool slot count, wall clock, and memory ceiling the operator declares as
// data. Warming the threads themselves is still unbuilt. Every failure — timeout, throw, crash, non-string — folds into a CLEAN refusal that
// leaks nothing of the bundle's internals (serveRoute's own discipline, now enforced across the boundary).

import { runInNewContext } from "node:vm";
import { plainText } from "./plain-text.js";
import { Worker } from "node:worker_threads";

// Tunable ceilings (exported so a host may tighten them). The timeout bounds a hanging bundle; the memory
// limits bound its V8 HEAP and not its whole appetite (see the residual in the header). Conservative
// defaults for a single v1 render.
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

// EVERY PRIMORDIAL THE BOOTSTRAP USES AFTER THE BUNDLE CAN RUN, CAPTURED NOW. The bootstrap shares a
// realm with the bundle, so any prototype method it reaches for LATER is a method the bundle can
// replace first. Two of these were measured escapes and neither was theoretical:
//
//   \`MessagePort.prototype.postMessage\` — the reply channel itself. Patched, the bootstrap posted
//   \`null\`, the parent read \`.kind\` off it, and the SERVING PROCESS died on an uncaught TypeError:
//   one unauthenticated GET, because \`prepareRoute\` runs ahead of every cap. The same patch returning
//   \`{kind:'ok'}\` forged an ADMISSION for a bundle with no default export, which is §23.4's
//   "proven at push" defeated. Dropping \`MessagePort\` from the allowlist does NOT close it — the
//   prototype is still reachable through \`Object.getPrototypeOf(new MessageChannel().port1)\`.
//
//   \`String.prototype.replace\` / \`.slice\` — the refusal sanitiser, which a bundle could turn into
//   the identity function and write escapes straight to the operator's terminal.
//
// The parent re-does both jobs on its own side regardless (a total read of the message, and its own
// scrub of the text), because a worker's copy of anything is never the trustworthy one. This capture
// is what keeps the WORKER honest; that is what keeps the PARENT safe.
const __apply = Reflect.apply;
const __startsWith = String.prototype.startsWith;
const __replace = String.prototype.replace;
const __slice = String.prototype.slice;
const __post = MessagePort.prototype.postMessage;
const __ownNames = Object.getOwnPropertyNames;
const __ownSymbols = Object.getOwnPropertySymbols;
const __from = Buffer.from;
const __reply = (msg) => __apply(__post, __parentPort, [msg]);
const __isData = (s) => typeof s === 'string' && __apply(__startsWith, s, ['data:']);
__hooks({
  resolve(specifier, context, next) {
    if (__isData(specifier)) return next(specifier, context);
    throw new Error('this renderer may not import "' + specifier + '"');
  },
});

const __allowed = new Set(${JSON.stringify([...pureIntrinsics(), ...PURE_PLATFORM])});
for (const __name of __ownNames(globalThis)) {
  if (__allowed.has(__name)) continue;
  try { delete globalThis[__name]; } catch (e) { /* verified below, never assumed */ }
}
// SYMBOL KEYS TOO. \`getOwnPropertyNames\` returns string keys only, so a symbol-keyed global would
// survive a scrub that reports itself complete. Node puts \`Symbol.toStringTag\` here today and nothing
// authority-bearing — but "today" is exactly the word the receipt below exists to remove.
for (const __sym of __ownSymbols(globalThis)) {
  try { delete globalThis[__sym]; } catch (e) { /* verified below, never assumed */ }
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
for (const __name of __ownNames(globalThis)) {
  if (!__allowed.has(__name)) throw new Error('the renderer realm did not close: ' + __name);
}
if (__ownSymbols(globalThis).length !== 0) throw new Error('the renderer realm kept a symbol global');
for (const __name of ${JSON.stringify(MUST_BE_GONE)}) {
  if (__name in globalThis) throw new Error('the renderer realm did not close: ' + __name);
}
if ('Console' in globalThis.console) throw new Error('the renderer realm kept the host console');

__parentPort.on('message', async ({ bundle, node, admit }) => {
  try {
    const url = 'data:text/javascript;base64,' + __apply(__from, Buffer, [bundle, 'utf8']).toString('base64');
    const mod = await import(url);
    const fn = mod && mod.default;
    if (typeof fn !== 'function') { __reply({ kind: 'notHtml' }); return; }
    if (admit === true) { __reply({ kind: 'ok' }); return; }
    const html = fn(node);
    if (typeof html !== 'string') { __reply({ kind: 'notHtml' }); return; }
    __reply({ kind: 'ok', html });
  } catch (e) {
    // \`why\` is read ONLY on the admission path, where the reader is the operator publishing the
    // bundle. The render path drops it: a serve refusal leaks nothing of a bundle's internals.
    //
    // BUNDLE-AUTHORED TEXT ON ITS WAY TO AN OPERATOR'S TERMINAL, so the characters that REPAINT go —
    // a refusal must not be able to read as its own opposite. Reading \`.message\` can itself run a
    // getter the bundle wrote, so even that is inside a try. This scrub is BEST EFFORT and the parent
    // repeats it: everything here runs in the bundle's own realm and is advisory by construction.
    let raw = 'the bundle did not evaluate';
    try { if (e && typeof e.message === 'string') raw = e.message; } catch (ignored) { /* a hostile getter */ }
    const repaint = /[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]/g;
    __reply({ kind: 'fault', why: __apply(__slice, __apply(__replace, raw, [repaint, ' ']), [0, 300]) });
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
      // `noStart`, not `fault`. This catch's own subject is ERR_WORKER_INIT_FAILED under fd or thread
      // exhaustion — the HOST failing, which is the exact condition the two verdicts exist to tell
      // apart. Calling it `fault` told an operator the module body ran and told the admission cache
      // the answer was settled, so one bout of fd exhaustion darkened a route for the process's life.
      opts.onOutcome?.("fault");
      resolve({ stage: "noStart" });
      return;
    }
    // Did the thread ever begin executing? An `error` or `exit` BEFORE `online` is the host failing to
    // start it; the same events AFTER `online` are the bundle (a resourceLimits reclaim arrives this
    // way). One flag separates two verdicts that the events themselves cannot.
    let started = false;
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
      started = true;
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish({ stage: "timeout" }), budget);
    });
    // THE READ IS TOTAL, and that is a security property rather than tidiness. The bootstrap replies
    // through a captured primordial precisely so a bundle cannot choose what lands here — but this
    // side must survive being wrong about that, because THIS runs on the serving thread. Reading
    // `.kind` off a value a bundle chose threw an uncaught TypeError and killed the whole process on
    // one request. Anything not recognised is a fault, and nothing is dereferenced unguarded.
    worker.on("message", (raw: unknown) => {
      const msg: { kind?: unknown; html?: unknown; why?: unknown } =
        typeof raw === "object" && raw !== null ? raw : {};
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
    worker.on("error", () => finish({ stage: started ? "fault" : "noStart" }));
    // Exited before posting: after `online` that is the bundle (an OOM reclaim lands here); before it,
    // the host never ran a line. Either way a clean refusal — but not the same verdict.
    worker.on("exit", () => finish({ stage: started ? "fault" : "noStart" }));
    // Outside the constructor's catch and inside the executor, so a throw here would REJECT a promise
    // this function's contract says never rejects — and the door would leak a Node error instead of a
    // refusal. It folds like everything else.
    try {
      worker.postMessage(message);
    } catch {
      finish({ stage: "noStart" });
    }
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
  // Is this verdict a property of the BUNDLE, or of the moment? A refused import, a syntax error, an
  // export that is not a function — those are the bundle, and the same bytes answer the same way, so
  // a caller may remember them for good. Anything the HOST decided is the moment: a thread that could
  // not start, and A TIMEOUT.
  //
  // The timeout belongs on this side of the line and the first draft had it on the other, which was
  // measured wrong: the same bytes under the same 100ms ceiling answered ok, refused, refused, ok, ok
  // across eight attempts, because a module body's wall clock includes whatever else the box is
  // doing. Remembering that verdict darkened a healthy federated route until the process restarted,
  // with no republish available to clear it. So a timeout is remembered only briefly (see
  // `TIMEOUT_MEMO_MS`), never for good.
  readonly settled: boolean;
  // May a caller remember this refusal FOREVER, or only for a while? Absent means forever.
  readonly memoMs?: number;
}

// How long a TIMEOUT refusal is remembered. It exists to bound a cost, not to record a fact: without
// a memo an unadmittable body costs a confined worker and its whole budget on EVERY request, and with
// a permanent one a bundle that was slow once is dark until restart. A cooldown pays a bounded price
// for both — at most one attempt per bundle per minute, and a route that recovers on its own.
export const TIMEOUT_MEMO_MS = 60_000;

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
  // SETTLED, BUT ONLY FOR A WHILE. A wall clock measures the box as much as the bundle, so a verdict
  // that a body was too slow is worth remembering to bound the cost and not worth keeping to record a
  // fact. See `Admission.settled` for the measurement that moved this.
  if (answer.stage === "timeout") {
    return {
      ok: false,
      settled: true,
      memoMs: TIMEOUT_MEMO_MS,
      why: `its module body did not finish inside ${timeoutMs ?? RENDER_ADMIT_TIMEOUT_MS}ms`,
    };
  }
  // The HOST, not the bundle — never remembered at all. See `Admission.settled`.
  if (answer.stage === "noStart") {
    return { ok: false, settled: false, why: "the host could not start a confined thread" };
  }
  // The reason came from the worker, so the parent does its own scrub: the worker's copy ran in the
  // bundle's realm, through prototype methods the bundle could have replaced.
  return {
    ok: false,
    settled: true,
    why: plainText(answer.why ?? "its module body did not evaluate"),
  };
}
