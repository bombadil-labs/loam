import { runInNewContext } from "node:vm";
import { plainText } from "./plain-text.js";
import { Worker } from "node:worker_threads";

export const RENDER_TIMEOUT_MS = 500;
export const RENDER_SPAWN_TIMEOUT_MS = 10_000;
export const RENDER_MAX_OLD_MB = 128;
export const RENDER_MAX_YOUNG_MB = 32;
export const RENDER_ADMIT_TIMEOUT_MS = 5_000;

export type RenderOutcome = "ok" | "timeout" | "fault" | "notHtml";

export interface RenderWorkerOptions {
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

let intrinsics: readonly string[] | undefined;
const pureIntrinsics = (): readonly string[] =>
  (intrinsics ??= runInNewContext("Object.getOwnPropertyNames(globalThis)") as string[]);

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

type Stage = "ok" | "notHtml" | "fault" | "timeout" | "noStart";
interface Answer {
  readonly stage: Stage;
  readonly html?: string;
  readonly why?: string;
}

function inConfinedWorker(
  message: { bundle: string; node?: unknown; admit?: boolean },
  timeoutMs: number | undefined,
  opts: RenderWorkerOptions,
): Promise<Answer> {
  return new Promise<Answer>((resolve) => {
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
      resolve({ stage: "noStart" });
      return;
    }
    let started = false;
    let settled = false;
    const finish = (answer: Answer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      opts.onOutcome?.(answer.stage === "noStart" ? "fault" : answer.stage);
      resolve(answer);
    };
    const budget = timeoutMs ?? RENDER_TIMEOUT_MS;
    const spawnBudget = opts.spawnTimeoutMs ?? RENDER_SPAWN_TIMEOUT_MS;
    let timer = setTimeout(() => finish({ stage: "noStart" }), spawnBudget);
    worker.once("online", () => {
      started = true;
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish({ stage: "timeout" }), budget);
    });
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
    worker.on("exit", () => finish({ stage: started ? "fault" : "noStart" }));
    try {
      worker.postMessage(message);
    } catch {
      finish({ stage: "noStart" });
    }
  });
}

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

export interface Admission {
  readonly ok: boolean;
  readonly why?: string;
  readonly settled: boolean;
  readonly memoMs?: number;
}

export const TIMEOUT_MEMO_MS = 60_000;

export async function admitInWorker(
  bundle: string,
  timeoutMs: number | undefined = RENDER_ADMIT_TIMEOUT_MS,
  opts: RenderWorkerOptions = {},
): Promise<Admission> {
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
      memoMs: TIMEOUT_MEMO_MS,
      why: `its module body did not finish inside ${timeoutMs ?? RENDER_ADMIT_TIMEOUT_MS}ms`,
    };
  }
  if (answer.stage === "noStart") {
    return { ok: false, settled: false, why: "the host could not start a confined thread" };
  }
  return {
    ok: false,
    settled: true,
    why: plainText(answer.why ?? "its module body did not evaluate"),
  };
}
