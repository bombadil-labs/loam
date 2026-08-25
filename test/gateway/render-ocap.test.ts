// THE OCAP HALF OF THE RENDERER SANDBOX (SPEC §23.9 / §24.5's open flag, ticket T172). §23.9's Worker
// bounds the HANG, the CRASH and the MEMORY. It does not bound REACH: measured at base 9a06d26, a
// renderer bundle read any file, wrote any file, read `process.env`, called `globalThis.require`,
// called `fetch`, and ran `node:child_process.execSync("id -u")` — and its MODULE BODY did all of that
// a second time on the SERVING THREAD, at `isMainThread === true`, under the server's own pid.
//
// These rails assert the reach half, on BOTH call classes, because confining one leaves the other open:
//
//   - THE RENDER CALL — `default(node)` inside the worker. Every bundle here loads cleanly and reaches
//     only when it is CALLED, so a rail that passed because the route never mounted would be vacuous.
//   - THE MODULE BODY — top-level code, which ran on the serving thread at publish / bind / bless.
//     Its rails report what the body learned INTO the rendered HTML, so a denial is observed rather
//     than inferred from an absent side effect.
//
// TWO-SIDED throughout, in the shape the reach question needs: the target is denied AND the fixture is
// proven real — the secret file the renderer cannot read is read by the test process in the same
// assertion, the server the renderer cannot dial answers the test process, and the bystander file a
// renderer never wrote still exists. A rail that only shows an absence cannot tell confinement from a
// typo in a path.
//
// WHAT THESE RAILS DELIBERATELY DO NOT ASSERT. CPU and wall clock inside the realm belong to §23.9 and
// §24.5 and are unchanged here (`render-sandbox`, `render-spawn-clock`, `render-cap`, and the three
// `quarantine-envelope` files still own them). §22 resolvers are NOT confined — a derived function is
// called synchronously by the resolution program and cannot cross a thread — so they keep §22's
// in-process floor, and `esm.ts` says so; the rail that would close that gap is a resolver protocol
// that survives a thread boundary, which does not exist.
//
// ONE RAIL FAILS AS A HANG, not as an assertion: "an unterminating module body is bounded". An
// unconfined module body evaluates on the serving thread and blocks the event loop, so no timer this
// process owns can fire to fail it politely. That is what the wedge IS, and the honest red for it is a
// worker that never answers.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { loadedEsm } from "../../src/gateway/esm.js";
import { rendererBindingClaims } from "../../src/gateway/renderers.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import { plainText } from "../../src/gateway/plain-text.js";
import { RENDER_TIMEOUT_MS, TIMEOUT_MEMO_MS } from "../../src/gateway/render-worker.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

// A per-file fixture directory. Nothing outside it is ever named by a bundle, and nothing outside it
// is ever removed — every path a renderer reaches for below is one this file created.
let dir: string;
let secretPath: string;
let SECRET: string;
let markerPath: string;
let bystanderPath: string;
let server: Server;
let serverUrl: string;
let hits: number;

const ENV_KEY = "LOAM_T172_OCAP_PROBE";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "loam-t172-"));
  secretPath = join(dir, "operator.secret");
  markerPath = join(dir, "written-by-a-renderer.txt");
  bystanderPath = join(dir, "bystander.txt");
  SECRET = `SECRET-${Math.random().toString(36).slice(2)}`;
  writeFileSync(secretPath, SECRET, "utf8");
  writeFileSync(bystanderPath, "a file no renderer touched", "utf8");
  // Set BEFORE any worker spawns: a worker copies `process.env` at construction, so a key added
  // afterwards would be absent for a reason that is not confinement.
  process.env[ENV_KEY] = SECRET;
  hits = 0;
  server = createServer((_req, res) => {
    hits += 1;
    res.end("reached");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  serverUrl = `http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/`;
});

afterAll(async () => {
  delete process.env[ENV_KEY];
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true }); // this file's own mkdtemp, and nothing else
});

const q = (s: string): string => JSON.stringify(s);

// A store with one lens, one fact, and no renderer yet — every rail publishes its own.
async function store(options: { renderTimeoutMs?: number } = {}): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { renderTimeoutMs: 5000, ...options },
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  return gw;
}

const publish = (gw: Gateway, route: string, bundle: string): Promise<void> =>
  gw.publishRenderer({ route, schema: "Plant", consumes: ["height"], bundle });

const serve = (
  gw: Gateway,
  route: string,
): Promise<{ status: number; contentType: string; body: string }> =>
  gw.serveRoute(route, FERN, "full");

// Publish and render in one breath, for the rails whose whole question is what the HTML says.
async function rendered(
  bundle: string,
  gw?: Gateway,
): Promise<{ status: number; contentType: string; body: string }> {
  const own = gw ?? (await store());
  try {
    await publish(own, "probe", bundle);
    return await serve(own, "probe");
  } finally {
    if (gw === undefined) await own.close();
  }
}

const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";

describe("T172 — the RENDER CALL reaches nothing ambient", () => {
  it("`globalThis.require` is not in the renderer's realm, so a render cannot open a file", async () => {
    // The bundle LOADS cleanly — its module body is inert — and reaches only when called. Measured
    // at base: `require` is a property of an eval worker's globalThis, so this returned the secret.
    const out = await rendered(
      `export default () => { try { const fs = globalThis.require(${q("node:fs")}); ` +
        `return "<p>" + fs.readFileSync(${q(secretPath)}, "utf8") + "</p>"; } ` +
        `catch (e) { return "<p>denied</p>"; } };`,
    );
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    // The other side: the file really does hold the secret, so the denial above is confinement and
    // not a path that never resolved.
    expect(readFileSync(secretPath, "utf8")).toBe(SECRET);
  });

  it("`process` is not in the renderer's realm, so a render cannot read the host's environment", async () => {
    const out = await rendered(
      `export default () => { try { return "<p>" + process.env[${q(ENV_KEY)}] + "</p>"; } ` +
        `catch (e) { return "<p>denied</p>"; } };`,
    );
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    expect(process.env[ENV_KEY]).toBe(SECRET); // the host really is carrying it
  });

  it("a render opens no socket: the listening server records nothing", async () => {
    // A control request first, so "zero hits" cannot mean "the server was never up".
    const before = hits;
    expect(await (await fetch(serverUrl)).text()).toBe("reached");
    expect(hits).toBe(before + 1);
    const baseline = hits;

    const out = await rendered(
      `export default () => { let r = "denied"; ` +
        `try { fetch(${q(serverUrl)}); r = "dialled"; } catch (e) { r = "denied"; } ` +
        `return "<p>" + r + "</p>"; };`,
    );
    expect(out.body).toBe("<p>denied</p>");
    // A dial that DID start would land after the render returned, so give the loop a moment before
    // reading the count — otherwise this rail could pass on timing rather than on confinement.
    await new Promise((r) => setTimeout(r, 250));
    expect(hits).toBe(baseline);
  });
});

describe("T172 — the MODULE BODY reaches nothing ambient", () => {
  it('a dynamic `import("node:fs")` in the module body is refused, and the secret stays unread', async () => {
    const out = await rendered(
      `let reached = "denied";\n` +
        `try { const fs = await import(${q("node:fs")}); reached = fs.readFileSync(${q(secretPath)}, "utf8"); }\n` +
        `catch (e) { reached = "denied"; }\n` +
        `export default () => "<p>" + reached + "</p>";`,
    );
    expect(out.status).toBe(200); // the bundle is well-formed; only its REACH was refused
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    expect(readFileSync(secretPath, "utf8")).toBe(SECRET);
  });

  it('a STATIC `import fs from "node:fs"` never mounts, and publishing it is refused at the door', async () => {
    // A static import cannot be caught by the bundle, so the module fails to evaluate at all. The
    // door refuses it (nothing is appended) rather than mounting a renderer that would 500 later.
    const gw = await store();
    await expect(
      publish(gw, "static", `import fs from ${q("node:fs")}; export default () => "<p>x</p>";`),
    ).rejects.toThrow(/did not load|node:fs/);
    expect(gw.renderers().some((r) => r.route === "static")).toBe(false);
    // Two-sided: the SAME door, same store, still takes an ordinary renderer.
    await publish(gw, "ok", OK);
    expect((await serve(gw, "ok")).body).toBe("<p>height: 42</p>");
    await gw.close();
  });

  it("a renderer writes no file — and the bystander file it never named survives", async () => {
    expect(existsSync(markerPath)).toBe(false);
    const out = await rendered(
      `let wrote = "denied";\n` +
        `try { const fs = await import(${q("node:fs")}); fs.writeFileSync(${q(markerPath)}, "a renderer wrote this", "utf8"); wrote = "wrote"; }\n` +
        `catch (e) { wrote = "denied"; }\n` +
        `export default () => "<p>" + wrote + "</p>";`,
    );
    expect(out.body).toBe("<p>denied</p>");
    // The whole point of the two-sided shape here: nothing new appeared, and nothing that was
    // already there went missing. A confinement that over-reached would fail the second line.
    expect(existsSync(markerPath)).toBe(false);
    expect(readFileSync(bystanderPath, "utf8")).toBe("a file no renderer touched");
  });

  it("`node:child_process` is refused, so no command runs", async () => {
    const spawned = join(dir, "spawned-by-a-renderer.txt");
    const out = await rendered(
      `let ran = "denied";\n` +
        `try { const cp = await import(${q("node:child_process")}); cp.execFileSync("touch", [${q(spawned)}]); ran = "ran"; }\n` +
        `catch (e) { ran = "denied"; }\n` +
        `export default () => "<p>" + ran + "</p>";`,
    );
    expect(out.body).toBe("<p>denied</p>");
    expect(existsSync(spawned)).toBe(false);
  });

  it("the module gate's own test cannot be made to lie by a patched prototype", async () => {
    // The escape THIS FIX SUGGESTS. The gate runs in the same realm as the bundle, so a gate that
    // asks `specifier.startsWith("data:")` can be defeated by patching `String.prototype.startsWith`
    // before importing. Measured: against a gate using the live prototype this returned the secret.
    const out = await rendered(
      `const real = String.prototype.startsWith;\n` +
        `String.prototype.startsWith = function () { return true; };\n` +
        `let reached = "denied";\n` +
        `try { const fs = await import(${q("node:fs")}); reached = fs.readFileSync(${q(secretPath)}, "utf8"); }\n` +
        `catch (e) { reached = "denied"; }\n` +
        `String.prototype.startsWith = real;\n` +
        `export default () => "<p>" + reached + "</p>";`,
    );
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    expect(readFileSync(secretPath, "utf8")).toBe(SECRET);
  });

  it("a nested `data:` module inherits the denial — the gate is not skin-deep", async () => {
    // `data:` is the ONE specifier the gate allows (it is how the bundle itself arrives), so a bundle
    // that smuggles its reach into a second data: module must meet the same refusal one level down.
    const inner = `export const secret = (await import("node:fs")).readFileSync(${q(secretPath)}, "utf8");`;
    const b64 = Buffer.from(inner, "utf8").toString("base64");
    const out = await rendered(
      `let reached = "denied";\n` +
        `try { const m = await import("data:text/javascript;base64," + ${q(b64)}); reached = m.secret; }\n` +
        `catch (e) { reached = "denied"; }\n` +
        `export default () => "<p>" + reached + "</p>";`,
    );
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
  });

  it("the realm's inventory is PINNED — every reaching name absent, every pure name present", async () => {
    // The one rail here that asserts the MECHANISM rather than an effect, and it earns its place: the
    // allowlist is a judgement about which names carry authority, and a judgement drifts. Widening it
    // by one line — `fetch` restored to make a bundle work, `BroadcastChannel` mistaken for the
    // `MessageChannel` beside it — is a silent hole that no effect rail above would name, because the
    // effect rails each test ONE reach. This names the whole set, both directions.
    const names = [
      // must be absent — each is a door out of the realm
      "process",
      "require",
      "module",
      "fetch",
      "WebSocket",
      "EventSource",
      "XMLHttpRequest",
      "BroadcastChannel",
      "navigator",
      "Request",
      "Response",
      "Headers",
      "FormData",
      "Blob",
      "ReadableStream",
      // `crypto` and `performance` are ABSENT, and they are the two that look pure. `crypto.subtle`
      // dispatches to libuv's process-wide threadpool, which `terminate()` cannot recall — see the
      // rail below, which measures what admitting it costs.
      "crypto",
      "performance",
      // must be present — pure computation a renderer may legitimately want
      "JSON",
      "Math",
      "TextEncoder",
      "URL",
      "Buffer",
      "structuredClone",
      "setTimeout",
      "MessageChannel",
      "console",
    ];
    const out = await rendered(
      `const names = ${JSON.stringify(names)};\n` +
        `const seen = names.filter((n) => n in globalThis);\n` +
        `export default () => "<p>" + seen.join(",") + "</p>";`,
    );
    expect(out.body).toBe(
      "<p>JSON,Math,TextEncoder,URL,Buffer,structuredClone,setTimeout,MessageChannel,console</p>",
    );
    // `BroadcastChannel` is the one worth stating twice: it is REACHABLE BY NAME from any thread in
    // the process, so admitting it would hand a confined bundle a channel to the serving thread — and
    // it sits one letter-group away from the `MessageChannel` this realm does keep.
    expect(out.body).not.toContain("BroadcastChannel");
  });

  it("the realm's WHOLE inventory is a hand-written golden — nothing arrives unexamined", async () => {
    // H10: an expected value must not be derived from the subject. The list above names 24 chosen
    // names, but the allowlist's LARGER half is computed at runtime from a fresh `vm` context — so
    // most of what survives was asserted by nothing, and a future V8 that puts an authority-carrying
    // name in a bare context would land it on the allowlist automatically, where the realm's own
    // self-check cannot see it BECAUSE IT IS ON THE ALLOWLIST.
    //
    // So the golden is written out by hand, once, and any platform change reads as a red bar that a
    // person then judges. That is the intended cost: a Node upgrade should not widen what a
    // stranger's code can touch without somebody looking.
    const out = await rendered(
      `const seen = Object.getOwnPropertyNames(globalThis).sort().join(",");\n` +
        `const syms = Object.getOwnPropertySymbols(globalThis).length;\n` +
        `export default () => "<p>" + syms + "|" + seen + "</p>";`,
    );
    const inventory =
      "AggregateError,Array,ArrayBuffer,AsyncDisposableStack,Atomics,BigInt,BigInt64Array," +
      "BigUint64Array,Boolean,Buffer,DataView,Date,DisposableStack,Error,EvalError,Event," +
      "EventTarget,FinalizationRegistry,Float16Array,Float32Array,Float64Array,Function,Infinity," +
      "Int16Array,Int32Array,Int8Array,Intl,Iterator,JSON,Map,Math,MessageChannel,MessageEvent," +
      "MessagePort,NaN,Number,Object,Promise,Proxy,RangeError,ReferenceError,Reflect,RegExp,Set," +
      "SharedArrayBuffer,String,SuppressedError,Symbol,SyntaxError,TextDecoder,TextEncoder,TypeError," +
      "URIError,URL,URLSearchParams,Uint16Array,Uint32Array,Uint8Array,Uint8ClampedArray,WeakMap," +
      "WeakRef,WeakSet,WebAssembly,atob,btoa,clearImmediate,clearInterval,clearTimeout,console," +
      "decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,escape,eval,global,globalThis," +
      "isFinite,isNaN,parseFloat,parseInt,queueMicrotask,setImmediate,setInterval,setTimeout," +
      "structuredClone,undefined,unescape";
    // The leading `0` is the symbol count: `getOwnPropertyNames` is string-keyed, so a symbol-keyed
    // global would survive a scrub that reports itself complete.
    expect(out.body).toBe(`<p>0|${inventory}</p>`);
  });

  it("a bundle that patches the reply channel cannot kill the serving thread or forge a verdict", async () => {
    // THE WORST DEFECT THIS TICKET FOUND, and it was in the fix rather than in the code being fixed.
    // The bootstrap replies through `MessagePort.prototype.postMessage` — a method the bundle shares a
    // realm with. Patched to post `null`, the parent read `.kind` off it and the WHOLE PROCESS died on
    // an uncaught TypeError; `prepareRoute` runs ahead of every cap, so one unauthenticated GET was
    // enough. Patched to post `{kind:'ok'}`, it forged an ADMISSION for a bundle with no default
    // export — §23.4's "proven at push" defeated by the thing doing the proving.
    //
    // Removing `MessagePort` from the allowlist does NOT close this: the prototype stays reachable as
    // `Object.getPrototypeOf(new MessageChannel().port1)`. The close is the captured primordial, so
    // the patch is simply inert — which is why the first case below renders NORMALLY.
    const patch = `const proto = Object.getPrototypeOf(new MessageChannel().port1);\n`;
    const silenced = await rendered(
      patch + `proto.postMessage = function () {};\nexport default () => "<p>alive</p>";`,
    );
    expect(silenced.status).toBe(200);
    expect(silenced.body).toBe("<p>alive</p>"); // the patch reached nothing the bootstrap uses

    // The forged verdict: no default export at all, so an honest realm must refuse to mount it.
    const gw = await store();
    await expect(
      publish(
        gw,
        "forged",
        patch +
          `const real = proto.postMessage;\n` +
          `proto.postMessage = function () { return real.call(this, { kind: "ok" }); };\n` +
          `export const notDefault = 1;`,
      ),
    ).rejects.toThrow(/export default/);
    expect(gw.renderers().some((r) => r.route === "forged")).toBe(false);
    await gw.close();
  }, 30_000);

  it("a bundle cannot smuggle terminal escapes into the refusal an operator reads", async () => {
    // The refusal text is BUNDLE-AUTHORED and lands in an operator's terminal. The worker scrubs it —
    // through `String.prototype.replace`, which the bundle can replace with the identity function, so
    // that scrub is advisory. The parent repeats it, and the parent's copy is the one that counts.
    const ESC = String.fromCharCode(0x1b);
    const RTL = String.fromCharCode(0x202e);
    const gw = await store();
    const refusal = await publish(
      gw,
      "escapes",
      `String.prototype.replace = function () { return this; };\n` +
        `String.prototype.slice = function () { return this; };\n` +
        `throw new Error(${JSON.stringify(`${ESC}[31mADMITTED${RTL}`)} + "x".repeat(5000));\n` +
        `export default () => "<p>x</p>";`,
    ).then(
      () => "the door accepted it",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(refusal).toContain("the bundle did not load");
    expect(refusal).not.toContain(ESC); // cannot repaint
    expect(refusal).not.toContain(RTL); // cannot read as its own opposite
    expect(refusal.length).toBeLessThan(400); // cannot scroll a screen (300 + the door's own prefix)
    await gw.close();
  }, 30_000);

  it("a render cannot queue work onto the host's threadpool and outlive its own worker", async () => {
    // THE ESCAPE THAT LOOKED PURE. A name can open no file itself and still hand work to libuv's
    // process-wide threadpool, which the render clock, `resourceLimits` and `terminate()` all fail to
    // reach — the queued work outlives the thread that queued it and blocks the SERVING thread's own
    // filesystem I/O. Measured with `crypto` on the allowlist: one render bought 30 seconds of it.
    //
    // WHAT THIS RAIL IS AND IS NOT. It is the REGRESSION rail for the one name that did it: a bundle
    // reaching `crypto.subtle` is denied, and the serving thread is measurably unharmed afterwards.
    // It is NOT a guard on the CLASS — it only ever exercises `crypto`, so a different
    // threadpool-dispatching name joining the allowlist would leave it green. The class is held by
    // two other things and they are the ones to keep honest: the allowlist test stated in
    // `render-worker.ts` ("authority-free AND synchronous-or-cancellable"), and the golden-inventory
    // rail above, which turns any new surviving global into a red bar somebody has to read.
    const probe = join(dir, "latency-probe.txt");
    writeFileSync(probe, "x", "utf8");
    const latency = async (): Promise<number> => {
      const t0 = Date.now();
      for (let i = 0; i < 8; i += 1) await readFile(probe, "utf8");
      return Date.now() - t0;
    };
    const before = await latency();
    const out = await rendered(
      `let queued = "denied";\n` +
        `try {\n` +
        `  const key = await crypto.subtle.importKey("raw", new Uint8Array(8), "PBKDF2", false, ["deriveBits"]);\n` +
        `  for (let i = 0; i < 16; i++) {\n` +
        `    crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: new Uint8Array(8), iterations: 8000000 }, key, 256).catch(() => {});\n` +
        `  }\n` +
        `  queued = "queued";\n` +
        `} catch (e) { queued = "denied"; }\n` +
        `export default () => "<p>" + queued + "</p>";`,
    );
    expect(out.body).toBe("<p>denied</p>");
    // The serving thread's own I/O, after the render returned and its worker was terminated. The
    // measured breach was ~1000x this baseline, so the margin is generous enough not to flake on a
    // loaded box while still failing loudly on a real one.
    const after = await latency();
    expect(after).toBeLessThan(Math.max(before, 50) * 20);
  }, 60_000);

  it("`console` writes nothing into the operator's log", async () => {
    // The realm keeps a `console` binding so a bundle that logs does not throw, and it is a REPLACEMENT
    // rather than the host's: stdout is a channel out of the realm, and §23.9 already promises a
    // refusal leaks nothing of a bundle's internals. A bundle that could write the operator's log
    // could write the operator's log with the operator's own secrets in it.
    //
    // The assertion has to DISTINGUISH the two consoles, not merely find one: the host's `console.log`
    // also returns undefined, so "it returned undefined" would pass with the replacement deleted. Node's
    // global console carries `Console` and `dirxml`; the replacement carries neither, and a bundle that
    // logs still does not throw.
    const out = await rendered(
      `console.log("a renderer must not reach the operator's log");\n` +
        `const host = ("Console" in console) || (typeof console.dirxml === "function");\n` +
        `export default () => "<p>host=" + host + " logged=" + (console.log("x") === undefined) + "</p>";`,
    );
    expect(out.body).toBe("<p>host=false logged=true</p>");
  });
});

describe("T172 — no module body runs on the serving thread", () => {
  it("publishing a renderer leaves no renderer namespace in this process's ESM loader", async () => {
    const gw = await store();
    const RESOLVER = "export default (bucket) => bucket.length;";
    await publish(gw, "ok", OK);
    // The renderer's module body was evaluated SOMEWHERE (the route mounts and serves), and it was
    // not here: the shared loader's cache — the only path by which this thread imports a data: URL —
    // holds nothing for it.
    expect((await serve(gw, "ok")).body).toBe("<p>height: 42</p>");
    expect(loadedEsm(OK)).toBeUndefined();
    // The other side, and the reason this is not a vacuous check of a cache nobody fills: a §22
    // RESOLVER still loads in-process, deliberately (a derived function cannot cross a thread), and
    // the very same cache holds it.
    await gw.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
      { height: { rung: "a", type: "number", code: RESOLVER } },
    );
    expect(loadedEsm(RESOLVER)).toBeDefined();
    await gw.close();
  });

  it("an unterminating module body is bounded, not a wedge — the store keeps answering", async () => {
    // The behavioural proof that the body did not evaluate here: an unconfined body would block THIS
    // event loop forever and no assertion below could run. A regression therefore reads as a hung
    // worker rather than a failed expectation; that is what the wedge is.
    const gw = await store({ renderTimeoutMs: 1500 });
    await publish(gw, "ok", OK);
    await expect(
      publish(gw, "spin", "while (true) {} export default () => '<p>x</p>';"),
    ).rejects.toThrow();
    // Still answering, on the same gateway, after the refusal.
    expect((await serve(gw, "ok")).body).toBe("<p>height: 42</p>");
    expect(gw.renderers().some((r) => r.route === "spin")).toBe(false);
    await gw.close();
  }, 30_000);

  it("a renderer binding that FEDERATES in still mounts nothing the realm cannot confine", async () => {
    // The T209 shape exactly: a peer's binding arrives over the wire, past the publish door, and the
    // door admits it at serve time through `prepareRoute`. Federation — not `append` — is what makes
    // this rail load-bearing: an appended binding is admitted by the rebind that follows the append,
    // so `prepareRoute` would contribute nothing and its removal would go unnoticed. A federated
    // binding is a 404 until prepareRoute runs, which is asserted here in both states.
    const gw = await store();
    const reaching = `import fs from ${q("node:fs")}; export default () => "<p>" + fs.readFileSync(${q(secretPath)}, "utf8") + "</p>";`;
    const arrive = (route: string, bundle: string, ts: number): Promise<unknown> =>
      gw.federate(
        [
          signClaims(
            rendererBindingClaims(
              { route, schemaName: "Plant" as never, consumes: ["height"], bundle },
              undefined,
              OP,
              ts,
            ),
            OP_SEED,
          ),
        ],
        { admit: () => true },
      );

    await arrive("arrived", reaching, 2000);
    await gw.prepareRoute("arrived");
    const out = await serve(gw, "arrived");
    expect(out.status).toBe(404); // unmounted, not a 500 and not a leak
    expect(out.body).not.toContain(SECRET);

    // Two-sided, and it proves the DOOR still works rather than that federation is broken: the same
    // arrival path with an ordinary bundle is 404 before the door admits it and 200 after. The bundle
    // is SOURCE-UNIQUE to this rail on purpose — admission is keyed by content address and the set
    // spans the process, so reusing `OK` here would find it already admitted by an earlier rail and
    // the 404 would never be observed.
    const fresh = "export default (n) => `<p>federated: ${n.view.height}</p>`;";
    await arrive("arrived-ok", fresh, 2001);
    expect((await serve(gw, "arrived-ok")).status).toBe(404);
    await gw.prepareRoute("arrived-ok");
    expect((await serve(gw, "arrived-ok")).body).toBe("<p>federated: 42</p>");
    await gw.close();
  });
});

describe("T172 — the scrub that guards an operator's terminal", () => {
  it("`plainText` drops what repaints, keeps what reads, and caps the length exactly", () => {
    // A unit rail on a security control, beside the end-to-end one. The door rail proves the scrub is
    // WIRED; this proves it is CORRECT — and the two failures it catches are the ones an end-to-end
    // assertion is too coarse to see: an off-by-one in the cap, and a slice that quietly eats the
    // first character of every refusal an operator reads.
    const ESC = String.fromCharCode(0x1b);
    const RTL = String.fromCharCode(0x202e);
    const BEL = String.fromCharCode(0x07);
    const ZWSP = String.fromCharCode(0x200b);
    // Nothing ordinary is touched, INCLUDING the first character — `slice(1, max)` passes every test
    // that only asks whether the escapes are gone.
    expect(plainText('a renderer may not import "node:fs"')).toBe(
      'a renderer may not import "node:fs"',
    );
    expect(plainText("héllo — ünicode is fine")).toBe("héllo — ünicode is fine");
    // Every repainting class becomes ONE space, written out literally rather than computed — an
    // expected value derived from the subject asserts nothing (H10). Four characters go in (ESC, BEL,
    // RTL, ZWSP) and four spaces come out, in their places.
    expect(plainText(`${ESC}[31mred${BEL}${RTL}${ZWSP}x`)).toBe(" [31mred   x");
    for (const bad of [ESC, RTL, BEL, ZWSP]) expect(plainText(`a${bad}b`)).not.toContain(bad);
    // The cap is EXACT, and it is a cap on the output rather than a suggestion.
    expect(plainText("z".repeat(1000))).toHaveLength(300);
    expect(plainText("z".repeat(1000), 12)).toHaveLength(12);
    expect(plainText("short", 12)).toBe("short");
  });
});

describe("T172 — the confinement composes with the budget, and a good renderer is untouched", () => {
  it("a well-behaved renderer still renders, and the pure ambient it may use still works", async () => {
    const gw = await store();
    await publish(gw, "ok", OK);
    const ok = await serve(gw, "ok");
    expect(ok.body).toBe("<p>height: 42</p>");
    // The whole served answer, not just its body: a realm that changed what a good render RETURNS
    // would be a cost this slice never advertised, and `toContain("text/html")` cannot see a charset
    // move underneath it.
    expect(ok.status).toBe(200);
    expect(ok.contentType).toBe("text/html; charset=utf-8");
    // Pure computation is not authority, and confining reach must not cost a renderer its language.
    await publish(
      gw,
      "pure",
      `export default (n) => "<p>" + JSON.stringify({ h: n.view.height }) +
        new TextEncoder().encode("!").length + new URL("https://a/b").pathname +
        Buffer.from("hi").toString("hex") + "</p>";`,
    );
    expect((await serve(gw, "pure")).body).toBe('<p>{"h":42}1/b6869</p>');
    await gw.close();
  });

  it("a pool render is confined AND billed: the envelope still counts what the realm refused", async () => {
    const gw = await store();
    const pool = await gw.openQuarantine();
    await pool.gateway.publishRenderer({
      route: "reach",
      schema: "Plant",
      consumes: ["height"],
      bundle:
        `export default () => { try { const fs = globalThis.require(${q("node:fs")}); ` +
        `return "<p>" + fs.readFileSync(${q(secretPath)}, "utf8") + "</p>"; } ` +
        `catch (e) { throw new Error("denied"); } };`,
    });
    const out = await pool.gateway.serveRoute("reach", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.contentType).toBe("text/plain; charset=utf-8"); // a refusal is text, and stays text
    expect(out.body).not.toContain(SECRET);
    // §24.5's accounting is untouched by §23.9's new realm: the operator still reads which pool
    // spent what. A confinement that bypassed the envelope would leave this row at zero.
    expect(gw.envelopeReports()[0]!.faulted).toBe(1);
    await pool.drop();
    await gw.close();
  });

  it("a pool admits on ITS OWN declared ceiling, even for bytes the primary already admitted", async () => {
    // §24.5's undelegatable power, at the admission door. Admissibility LOOKS like a property of the
    // bytes and is not: the same module body is admissible under the primary's clock and not under a
    // pool's tighter declared one. A cache keyed by content address alone would hand the pool a verdict
    // the pool never asked for — the operator's one ceiling, waved through by a memo.
    const slow =
      `const until = Date.now() + 600; while (Date.now() < until) {}\n` +
      `export default (n) => "<p>slow: " + n.view.height + "</p>";`;
    const gw = await store();
    // The primary admits it: 600ms of module body, well inside the admission clock.
    await publish(gw, "slow", slow);
    expect((await serve(gw, "slow")).body).toBe("<p>slow: 42</p>");

    // The operator declares a 100ms ceiling for every pool, on the PARENT's ground, as data.
    await gw.append([
      signClaims(envelopeClaims(ENVELOPE_ANY, { renderTimeoutMs: 100 }, OP, 3000), OP_SEED),
    ]);
    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.renderTimeoutMs).toBe(100);
    // The SAME BYTES, already admitted on the primary, must still meet the pool's own number.
    await expect(
      pool.gateway.publishRenderer({
        route: "slow",
        schema: "Plant",
        consumes: ["height"],
        bundle: slow,
      }),
    ).rejects.toThrow(/did not finish inside 100ms/);
    // Two-sided: the pool is not simply refusing everything — an ordinary bundle publishes and serves
    // under the very same declared ceiling.
    await pool.gateway.publishRenderer({
      route: "quick",
      schema: "Plant",
      consumes: ["height"],
      bundle: OK,
    });
    // `toContain`, not `toBe`: a pool's 200 is wrapped in §24.7's probation chrome, which is a
    // different promise and belongs to its own rails.
    expect((await pool.gateway.serveRoute("quick", FERN, "full")).body).toContain(
      "<p>height: 42</p>",
    );
    await pool.drop();
    await gw.close();
  }, 30_000);

  it("a route the realm will not admit is refused FROM MEMORY, not re-attempted per request", async () => {
    // `prepareRoute` runs on every request for a route, AHEAD of the anonymous fan cap and ahead of a
    // pool's slot count. Without a memo, a binding that arrived past the publish door with an
    // unadmittable body buys one confined worker and its whole admit budget per GET — a fan cap of one
    // measured six concurrent workers. The observable is TIME: the first attempt pays the budget, and
    // every attempt after it is answered without a thread.
    //
    // NOT ASSERTED HERE: that two SIMULTANEOUS first requests share a single worker (the in-flight
    // map). Wall clock cannot see it — concurrent attempts finish together whether they share a thread
    // or spawn one each — and the rail that would see it needs a thread count this process cannot ask
    // for. The memo below is what bounds the repeated case; the map bounds the simultaneous one.
    const gw = await store();
    const spinning =
      `const until = Date.now() + 60000; while (Date.now() < until) {}\n` +
      `export default () => "<p>never</p>";`;
    await gw.federate(
      [
        signClaims(
          rendererBindingClaims(
            {
              route: "wedge",
              schemaName: "Plant" as never,
              consumes: ["height"],
              bundle: spinning,
            },
            undefined,
            OP,
            2100,
          ),
          OP_SEED,
        ),
      ],
      { admit: () => true },
    );
    const t0 = Date.now();
    await gw.prepareRoute("wedge");
    const first = Date.now() - t0;
    const t1 = Date.now();
    await gw.prepareRoute("wedge");
    await gw.prepareRoute("wedge");
    const repeats = Date.now() - t1;

    expect((await serve(gw, "wedge")).status).toBe(404); // never mounted, either way
    // The first attempt really did run the budget out — otherwise "the repeats were fast" would be
    // true of a code path that never attempts anything.
    expect(first).toBeGreaterThan(1000);
    // Two further attempts, together, cost a small fraction of one. A per-request re-attempt would
    // cost at least another whole budget.
    expect(repeats).toBeLessThan(first / 4);

    // AND THE MEMO LAPSES, which is the half that keeps it a COST BOUND rather than a verdict. A
    // wall clock measures the box as much as the module body, so remembering "too slow" for good
    // darkens a healthy federated route until the process restarts, with no republish available to
    // clear it. Only `Date` is faked — the worker's own timers stay real, and `performance.now()` is
    // the untouched clock this measurement reads.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + TIMEOUT_MEMO_MS + 1_000);
      const t2 = performance.now();
      await gw.prepareRoute("wedge");
      const afterCooldown = performance.now() - t2;
      // It paid a real budget again: the cooldown lapsed and the route was re-examined rather than
      // answered from a memory that had become permanent.
      expect(afterCooldown).toBeGreaterThan(1000);
    } finally {
      vi.useRealTimers();
    }
    await gw.close();
  }, 60_000);

  it("a peer that cannot confine a renderer admits none — no confinement, no execution", async () => {
    // The browser peer has no `worker_threads`, so `scripts/browser-render-worker-stub.mjs` stands in
    // for this module in every browser-safe bundle. It is the ONE place the rule could quietly invert:
    // a stub answering `ok: true` would mount routes on a peer that can confine nothing, and no rail
    // above would see it (they all drive the Node host). So the stub is asserted directly, and the
    // assertion is on the VERDICT, which is the field that would have to flip.
    // Imported through a computed URL because the stub is untyped plain ESM that only ever rides an
    // esbuild bundle; a literal specifier would want a declaration file it will never have.
    const url = new URL("../../scripts/browser-render-worker-stub.mjs", import.meta.url).href;
    const stub = (await import(url)) as {
      admitInWorker: () => Promise<{ ok: boolean; why?: string }>;
    };
    const verdict = await stub.admitInWorker();
    expect(verdict.ok).toBe(false);
    // `settled: false` is the OTHER field that must not flip. A peer that cannot confine is a
    // statement about the HOST, so no caller may memoise it — flipped, every route on that peer
    // would be permanently unmountable rather than unmountable-for-now.
    expect((verdict as { settled?: boolean }).settled).toBe(false);
    expect(verdict.why).toContain("confine");

    // While the stub is in hand: its `RENDER_TIMEOUT_MS` is required to stay byte-equal to this
    // module's, because §30 has the two hosts state visibly the same clock behind ONE content
    // address. Two files holding the same number is a promise nothing was checking, and a number
    // that drifts in one of them is exactly the divergence the export exists to prevent.
    const held = stub as unknown as { RENDER_TIMEOUT_MS: number };
    expect(held.RENDER_TIMEOUT_MS).toBe(RENDER_TIMEOUT_MS);
  });
});
