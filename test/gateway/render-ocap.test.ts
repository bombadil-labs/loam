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
  rmSync(dir, { recursive: true, force: true });
});

const q = (s: string): string => JSON.stringify(s);

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
    const out = await rendered(
      `export default () => { try { const fs = globalThis.require(${q("node:fs")}); ` +
        `return "<p>" + fs.readFileSync(${q(secretPath)}, "utf8") + "</p>"; } ` +
        `catch (e) { return "<p>denied</p>"; } };`,
    );
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    expect(readFileSync(secretPath, "utf8")).toBe(SECRET);
  });

  it("`process` is not in the renderer's realm, so a render cannot read the host's environment", async () => {
    const out = await rendered(
      `export default () => { try { return "<p>" + process.env[${q(ENV_KEY)}] + "</p>"; } ` +
        `catch (e) { return "<p>denied</p>"; } };`,
    );
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    expect(process.env[ENV_KEY]).toBe(SECRET);
  });

  it("a render opens no socket: the listening server records nothing", async () => {
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
    expect(out.status).toBe(200);
    expect(out.body).not.toContain(SECRET);
    expect(out.body).toBe("<p>denied</p>");
    expect(readFileSync(secretPath, "utf8")).toBe(SECRET);
  });

  it('a STATIC `import fs from "node:fs"` never mounts, and publishing it is refused at the door', async () => {
    const gw = await store();
    await expect(
      publish(gw, "static", `import fs from ${q("node:fs")}; export default () => "<p>x</p>";`),
    ).rejects.toThrow(/did not load|node:fs/);
    expect(gw.renderers().some((r) => r.route === "static")).toBe(false);
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
    const names = [
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
      "crypto",
      "performance",
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
    expect(out.body).not.toContain("BroadcastChannel");
  });

  it("the realm's WHOLE inventory is a hand-written golden — nothing arrives unexamined", async () => {
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
    expect(out.body).toBe(`<p>0|${inventory}</p>`);
  });

  it("a bundle that patches the reply channel cannot kill the serving thread or forge a verdict", async () => {
    const patch = `const proto = Object.getPrototypeOf(new MessageChannel().port1);\n`;
    const silenced = await rendered(
      patch + `proto.postMessage = function () {};\nexport default () => "<p>alive</p>";`,
    );
    expect(silenced.status).toBe(200);
    expect(silenced.body).toBe("<p>alive</p>");

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
    expect(refusal).not.toContain(ESC);
    expect(refusal).not.toContain(RTL);
    expect(refusal.length).toBeLessThan(400);
    await gw.close();
  }, 30_000);

  it("a render cannot queue work onto the host's threadpool and outlive its own worker", async () => {
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
    const after = await latency();
    expect(after).toBeLessThan(Math.max(before, 50) * 20);
  }, 60_000);

  it("`console` writes nothing into the operator's log", async () => {
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
    expect((await serve(gw, "ok")).body).toBe("<p>height: 42</p>");
    expect(loadedEsm(OK)).toBeUndefined();
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
    const gw = await store({ renderTimeoutMs: 1500 });
    await publish(gw, "ok", OK);
    await expect(
      publish(gw, "spin", "while (true) {} export default () => '<p>x</p>';"),
    ).rejects.toThrow();
    expect((await serve(gw, "ok")).body).toBe("<p>height: 42</p>");
    expect(gw.renderers().some((r) => r.route === "spin")).toBe(false);
    await gw.close();
  }, 30_000);

  it("a renderer binding that FEDERATES in still mounts nothing the realm cannot confine", async () => {
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
    expect(out.status).toBe(404);
    expect(out.body).not.toContain(SECRET);

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
    const ESC = String.fromCharCode(0x1b);
    const RTL = String.fromCharCode(0x202e);
    const BEL = String.fromCharCode(0x07);
    const ZWSP = String.fromCharCode(0x200b);
    expect(plainText('a renderer may not import "node:fs"')).toBe(
      'a renderer may not import "node:fs"',
    );
    expect(plainText("héllo — ünicode is fine")).toBe("héllo — ünicode is fine");
    expect(plainText(`${ESC}[31mred${BEL}${RTL}${ZWSP}x`)).toBe(" [31mred   x");
    for (const bad of [ESC, RTL, BEL, ZWSP]) expect(plainText(`a${bad}b`)).not.toContain(bad);
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
    expect(ok.status).toBe(200);
    expect(ok.contentType).toBe("text/html; charset=utf-8");
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
    expect(out.contentType).toBe("text/plain; charset=utf-8");
    expect(out.body).not.toContain(SECRET);
    expect(gw.envelopeReports()[0]!.faulted).toBe(1);
    await pool.drop();
    await gw.close();
  });

  it("a pool admits on ITS OWN declared ceiling, even for bytes the primary already admitted", async () => {
    const slow =
      `const until = Date.now() + 600; while (Date.now() < until) {}\n` +
      `export default (n) => "<p>slow: " + n.view.height + "</p>";`;
    const gw = await store();
    await publish(gw, "slow", slow);
    expect((await serve(gw, "slow")).body).toBe("<p>slow: 42</p>");

    await gw.append([
      signClaims(envelopeClaims(ENVELOPE_ANY, { renderTimeoutMs: 100 }, OP, 3000), OP_SEED),
    ]);
    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.renderTimeoutMs).toBe(100);
    await expect(
      pool.gateway.publishRenderer({
        route: "slow",
        schema: "Plant",
        consumes: ["height"],
        bundle: slow,
      }),
    ).rejects.toThrow(/did not finish inside 100ms/);
    await pool.gateway.publishRenderer({
      route: "quick",
      schema: "Plant",
      consumes: ["height"],
      bundle: OK,
    });
    await gw.append([
      signClaims(envelopeClaims(ENVELOPE_ANY, { renderTimeoutMs: 10_000 }, OP, 4000), OP_SEED),
    ]);
    expect(gw.envelopeReports()[0]!.envelope.renderTimeoutMs).toBe(10_000);
    await pool.gateway.prepareRoute("quick");
    expect((await pool.gateway.serveRoute("quick", FERN, "full")).body).toContain(
      "<p>height: 42</p>",
    );
    await pool.drop();
    await gw.close();
  }, 30_000);

  it("a route the realm will not admit is refused FROM MEMORY, not re-attempted per request", async () => {
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

    expect((await serve(gw, "wedge")).status).toBe(404);
    expect(first).toBeGreaterThan(1000);
    expect(repeats).toBeLessThan(first / 4);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + TIMEOUT_MEMO_MS + 1_000);
      const t2 = performance.now();
      await gw.prepareRoute("wedge");
      const afterCooldown = performance.now() - t2;
      expect(afterCooldown).toBeGreaterThan(1000);
    } finally {
      vi.useRealTimers();
    }
    await gw.close();
  }, 60_000);

  it("a peer that cannot confine a renderer admits none — no confinement, no execution", async () => {
    const url = new URL("../../scripts/browser-render-worker-stub.mjs", import.meta.url).href;
    const stub = (await import(url)) as {
      admitInWorker: () => Promise<{ ok: boolean; why?: string }>;
    };
    const verdict = await stub.admitInWorker();
    expect(verdict.ok).toBe(false);
    expect((verdict as { settled?: boolean }).settled).toBe(false);
    expect(verdict.why).toContain("confine");

    const held = stub as unknown as { RENDER_TIMEOUT_MS: number };
    expect(held.RENDER_TIMEOUT_MS).toBe(RENDER_TIMEOUT_MS);
  });
});
