// @vitest-environment happy-dom
//
// T158 — THE PAGE'S TWO CLOCKS CARRY TWO NUMBERS.
//
// `paint()` bounds two different waits. The SPAWN wait runs from `new Worker(blob, {type:"module"})`
// to the realm's `live` signal: worker thread start plus a blob: module import, which is the viewer's
// DEVICE and not the bundle. The RENDER wait runs from `live` to the answer, and that one is the
// bundle. Arming both from `C.renderTimeoutMs` charged the device to the bundle's budget and painted
// "the renderer timed out" for a renderer that had not executed a line — a report that can be false,
// which is the H7 family. The measurement that earned this file is in the ticket and the PR: on a
// 16-core box, spawn-to-live was 4 ms idle, 91 ms at load average ~150, and 803 ms worst at ~550.
//
// TWO LEVELS, as P3 asks.
//   BYTES — what the emitted page carries: two distinct coordinate numbers, and a spawn message that
//   is not the timeout message.
//   BEHAVIOUR — what the shell DOES when driven in a DOM: a slow start still paints the render, a
//   real render overrun still says "timed out", and a start that never comes says "could not start".
//
// The shim here is deliberately smaller than `artifact-shell.test.ts`'s. That file's shim seals a
// realm and evaluates a bundle, because its subject is confinement; this file's subject is the two
// timers, so its shim only decides WHEN `live` and WHEN the answer arrive. It proves nothing about
// the seal and claims nothing about it.
//
// WHAT NO RAIL HERE PROVES, each with the reason and the direction that would close it.
//
//   (a) That a REAL browser Worker's spawn ever exceeds a real budget. No seam makes Chrome's thread
//       start slow on demand, and a rail that manufactured host load would be the flake it exists to
//       prevent. That direction is the load table in the PR, measured through CDP against the shipped
//       realm program.
//   (b) That the render window is now PURE bundle time. It is not, and the source says so: the realm
//       signals live when its OWN module has evaluated, so the bundle's blob: import and top-level
//       evaluation are still inside the render budget — measured at 127 ms median and 801 ms worst
//       under load 550, against a 500 ms default. It cannot be split further, because import()
//       resolves only after the bundle's top-level has run. Closing it is an operator budget decision.
//   (c) That the SERVER host's clocks are split the same way. `render-worker.ts` still arms both of
//       its windows from one number, and `test/gateway/render-sandbox.test.ts` pins the resulting
//       "the renderer timed out" for what can only be a spawn overrun. T139 is that ticket; this file
//       is deliberately the page half and asserts nothing about the server.
//   (d) That a coordinates object built BY HAND, without `renderSpawnTimeoutMs`, is refused. The field
//       is required on both `ArtifactCoordinates` declarations, so only a JS caller reaching the
//       exported `artifactPage` can omit it — and the damage is worse than it sounds: setTimeout
//       coerces undefined to 0, so the page would paint "the renderer could not start" on the next
//       macrotask for EVERY render, including a fast local one. `renderTimeoutMs` has carried the same
//       exposure since it was added. The rail is pack-time validation of coordinates, and no ticket has
//       asked for one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { ARTIFACT_SPAWN_TIMEOUT_MS } from "../../src/gateway/artifact-page.js";
import { evalPageSource } from "./eval-page.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

// The render budget these fixtures pack. Small on purpose: every rail below is about a wait that
// either does or does not get charged to THIS number.
const RENDER_MS = 120;

const BUNDLE = `export default function (node) { return "<div id=body>h=" + node.view.height + "</div>"; }`;

// How the shim behaves for the NEXT worker it constructs. `liveAfterMs < 0` means the realm never
// signals at all — a spawn that never completes.
let liveAfterMs = 0;
let answerAfterMs = 0;
// When true, the NEXT `new Worker` throws — the shell's mount-failure path, which a loaded device
// reaches for real when the tab hits its worker-thread limit.
let refuseNextWorker = false;
// When set, the realm answers with THIS kind instead of `ok` — the way to post a kind the shell's own
// bookkeeping uses, from the one channel a bundle can reach.
let answerKind = "";
// When > 0, the realm keeps re-posting `live` on this interval and NEVER answers. That models a bundle
// reaching a bare `postMessage` — `self` is sealed but the bare identifier is not in SEALED_CHANNELS —
// and it is the only way to hold the render clock open from inside the compartment.
let liveRepeatMs = 0;

let attached: Array<[string, EventListener]> = [];

interface Harness {
  /** Every worker the shell constructed, in order, so a rail can ask which ones were terminated. */
  readonly spawned: { terminated: boolean }[];
  deliver(): void;
  /** A non-data watch event — the shell's `degrade` path, which darkens the mount. */
  fail(): void;
  html(id: string): string;
  /** Poll until `text` is in the mount, or the deadline passes. Never sleeps a fixed span. */
  until(text: string, ms: number): Promise<boolean>;
  /** Poll until the mount is non-empty, or the deadline passes. */
  untilPainted(ms: number): Promise<boolean>;
}

const pack = async (over: { renderSpawnTimeoutMs?: number } = {}): Promise<string> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { renderTimeoutMs: RENDER_MS },
  );
  await gw.append([observed(FERN, "height", 7, 1000, OP_SEED)]);
  await gw.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: BUNDLE,
  });
  await gw.declareArtifact(["plant"]);
  const packed = gw.packArtifact("plant", FERN, {
    server: "My Loam",
    storeAddress: "https://garden.test/garden/mcp",
  });
  await gw.close();
  // The emitted bytes, with the spawn ceiling optionally re-written for a rail that needs a SHORT one.
  // Only the coordinates JSON is touched; the shell itself is the shipped text.
  return over.renderSpawnTimeoutMs === undefined
    ? packed.page
    : packed.page.replace(
        `"renderSpawnTimeoutMs":${packed.coordinates.renderSpawnTimeoutMs}`,
        `"renderSpawnTimeoutMs":${over.renderSpawnTimeoutMs}`,
      );
};

const answerFor = (document: string): unknown => {
  const m = /query \{ (\w+)\(entity: "([^"]*)"\)/.exec(document);
  return {
    data: { [m?.[1] ?? "plant"]: { _entity: m?.[2] ?? FERN, _hex: "h0", _view: { height: 7 } } },
  };
};

const load = (page: string): Harness => {
  let watchHandler: ((ev: unknown) => void) | undefined;
  let document_: string | undefined;
  const spawned: ShimWorker[] = [];

  class ShimWorker {
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    private alive = true;
    private readonly timers: ReturnType<typeof setTimeout>[] = [];
    terminated = false;
    constructor() {
      if (refuseNextWorker) {
        refuseNextWorker = false;
        throw new Error("no worker for you");
      }
      spawned.push(this);
      if (liveAfterMs >= 0) {
        this.timers.push(setTimeout(() => this.emit({ kind: "live" }), liveAfterMs));
      }
      if (liveRepeatMs > 0) {
        this.timers.push(setInterval(() => this.emit({ kind: "live" }), liveRepeatMs));
      }
    }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const held = this.listeners.get(type) ?? [];
      held.push(fn);
      this.listeners.set(type, held);
    }
    private emit(data: unknown): void {
      if (!this.alive) return;
      for (const fn of this.listeners.get("message") ?? []) fn({ data });
    }
    terminate(): void {
      this.alive = false;
      this.terminated = true;
      // Both kinds share one list; in Node a Timeout is cleared by either call, so this is exact.
      for (const t of this.timers) {
        clearTimeout(t);
        clearInterval(t);
      }
    }
    postMessage(msg: { node: { view: { height: unknown } } }): void {
      // The answer is scheduled relative to the SPAWN, exactly as a real realm's would be: the realm
      // cannot render before it is live, so the shim adds its render span to the live moment.
      const at = (liveAfterMs < 0 ? 0 : liveAfterMs) + answerAfterMs;
      if (liveRepeatMs > 0) return; // a realm that only re-arms never answers
      this.timers.push(
        setTimeout(() => {
          if (liveAfterMs < 0) return; // never went live: it cannot answer either
          if (answerKind !== "") {
            this.emit({ kind: answerKind });
            return;
          }
          this.emit({ kind: "ok", html: `<div id=body>h=${String(msg.node.view.height)}</div>` });
        }, at),
      );
    }
  }

  const mcp = {
    watchTool: (
      _s: string,
      _t: string,
      input: { query?: string },
      handler: (ev: unknown) => void,
    ) => {
      document_ = input.query;
      watchHandler = handler;
      return () => undefined;
    },
    callTool: () => Promise.resolve({ payload: {} }),
    invalidate: () => Promise.resolve(),
  };
  Object.defineProperty(globalThis, "claude", {
    configurable: true,
    writable: true,
    value: { mcp },
  });
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: ShimWorker });
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: Object.assign(globalThis.URL, { createObjectURL: () => "blob:realm" }),
  });

  for (const [type, fn] of attached) document.removeEventListener(type, fn);
  attached = [];
  document.documentElement.innerHTML = page
    .replace(/^[\s\S]*?<body>/, "")
    .replace(/<\/body>[\s\S]*$/, "");

  const seen: Record<string, unknown> = {
    getElementById: (id: string) => document.getElementById(id),
    addEventListener: (type: string, fn: EventListener) => {
      attached.push([type, fn]);
      document.addEventListener(type, fn);
    },
  };
  const shell = [...document.querySelectorAll("script")].find(
    (s) => s.getAttribute("type") === null,
  )!;
  evalPageSource<void>(shell.textContent ?? "", ["document"], [seen]);

  const html = (id: string): string => document.getElementById(id)?.innerHTML ?? "";
  const poll = async (ok: () => boolean, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (!ok() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    return ok();
  };
  return {
    spawned,
    fail: () =>
      watchHandler?.({
        type: "error",
        error: { code: "server_not_connected", message: "no connector" },
      }),
    deliver: () =>
      watchHandler?.({ type: "data", result: { payload: answerFor(document_ ?? "") } }),
    html,
    until: (text, ms) => poll(() => html("loam-app").includes(text), ms),
    untilPainted: (ms) => poll(() => html("loam-app").trim() !== "", ms),
  };
};

beforeEach(() => {
  vi.useRealTimers();
  liveAfterMs = 0;
  answerAfterMs = 0;
  liveRepeatMs = 0;
  refuseNextWorker = false;
  answerKind = "";
});

describe("T158 at the BYTES: the page carries two budgets, not one", () => {
  it("the coordinates carry a spawn ceiling DISTINCT from the render budget", async () => {
    const page = await pack();
    const coordinates = JSON.parse(
      /<script type="application\/json" id="loam-coordinates">([\s\S]*?)<\/script>/.exec(page)![1]!,
    ) as { renderTimeoutMs: number; renderSpawnTimeoutMs: number };
    expect(coordinates.renderTimeoutMs).toBe(RENDER_MS);
    expect(coordinates.renderSpawnTimeoutMs).toBe(ARTIFACT_SPAWN_TIMEOUT_MS);
    // The revert-probe at this level: one number on both clocks makes these equal.
    expect(coordinates.renderSpawnTimeoutMs).not.toBe(coordinates.renderTimeoutMs);
  });

  it("the shell arms the spawn window from the spawn number and the render window from the render number", async () => {
    const page = await pack();
    const shell = page.slice(page.indexOf("function paint(node)"));
    // Armed at construction: the spawn number. Re-armed on `live`: the render number. A shell that
    // read one number for both would fail whichever of these two it dropped.
    expect(shell).toContain('done({ kind: "noStart" }); }, C.renderSpawnTimeoutMs)');
    expect(shell).toContain('done({ kind: "timeout" }); }, C.renderTimeoutMs)');
  });

  it("a spawn overrun has its OWN sentence — it never claims the renderer ran", async () => {
    const page = await pack();
    expect(page).toContain("the renderer could not start");
    // The other two are pre-existing text, asserted here only to show the new sentence was ADDED
    // beside them rather than replacing one. That they behave distinctly is the behaviour rails' job.
    expect(page).toContain("the renderer timed out");
    expect(page).toContain("this renderer could not be mounted in this viewer");
  });
});

describe("T158: the spawn ceiling is the page's own constant, not an operator option", () => {
  it("artifact.ts fills the coordinate from the constant, with no gateway option in the path", () => {
    // The server host's spawn ceiling bounds how long one anonymous caller may hold a
    // `maxPublicRenders` slot, so it belongs to the operator. This clock holds nothing but the
    // viewer's own tab. Pinned at the SOURCE because no fixture can set an option that does not
    // exist: wiring one in later would leave every behaviour rail in this file green.
    const source = readFileSync(join(process.cwd(), "src", "gateway", "artifact.ts"), "utf8");
    expect(source).toContain("renderSpawnTimeoutMs: ARTIFACT_SPAWN_TIMEOUT_MS,");
  });
});

describe("T158 at the BEHAVIOUR: driving the emitted shell in a DOM", () => {
  it("a SLOW START does not report a budget overrun — the render still paints", async () => {
    // The whole defect, in one rail. Spawn takes longer than the render budget; the render itself is
    // fast. Before the split this painted "the renderer timed out" for a bundle that ran correctly.
    liveAfterMs = RENDER_MS * 2;
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.untilPainted(5_000)).toBe(true);
    expect(h.html("loam-app")).toContain("h=7");
    expect(h.html("loam-app")).not.toContain("timed out");
    expect(h.html("loam-app")).not.toContain("could not start");
  });

  it("a GENUINE render overrun still reports the timeout — the split did not widen the render window", async () => {
    // The other side. The realm goes live promptly and then takes longer than the render budget.
    // A shell that armed the 10 s spawn ceiling for BOTH windows would sit here painting nothing.
    liveAfterMs = 5;
    answerAfterMs = RENDER_MS * 8;
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer timed out", 5_000)).toBe(true);
    expect(h.html("loam-app")).not.toContain("could not start");
  });

  it("a start that NEVER comes is bounded, and says so without claiming the renderer ran", async () => {
    liveAfterMs = -1; // the realm never signals; nothing is ever rendered
    const page = await pack({ renderSpawnTimeoutMs: 200 });
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer could not start", 5_000)).toBe(true);
    expect(h.html("loam-app")).not.toContain("timed out");
  });

  it("a realm that keeps re-signalling LIVE cannot hold the render clock open", async () => {
    // The live re-arm fires ONCE. `self` is sealed in the realm, but a bare `postMessage` identifier
    // is not in SEALED_CHANNELS, so a bundle can reach the shell's own protocol. Without the guard
    // each `live` re-armed a fresh render budget and the fold never landed — an unbounded window,
    // and the worker running that bundle stayed alive for as long as it kept beating.
    liveAfterMs = 5;
    liveRepeatMs = 20;
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer timed out", 5_000)).toBe(true);
    expect(h.spawned[0]!.terminated).toBe(true);
  });

  it("a SUPERSEDED render that has not yet started is torn down at once, not at its own ceiling", async () => {
    // The cost of a generous spawn ceiling, paid down. A render the world has moved past must stop
    // when it is superseded; waiting out a 10 s ceiling would let a viewer clicking through gestures
    // on a slow device stack up worker threads and deepen the contention that made spawn slow.
    // The deadline is DERIVED, never a literal: the rail discriminates only while it is shorter than
    // the spawn ceiling, and a future ticket lowering that constant would otherwise turn this green
    // with the repair reverted and nothing would say so.
    const patience = Math.min(2_000, ARTIFACT_SPAWN_TIMEOUT_MS / 4);
    liveAfterMs = patience * 2; // this render can only be stopped by being superseded
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver(); // render 1 — spawned, not yet live
    h.deliver(); // render 2 — supersedes it
    const gone = await (async (): Promise<boolean> => {
      const deadline = Date.now() + patience;
      while (!(h.spawned[0]?.terminated ?? false) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      return h.spawned[0]?.terminated ?? false;
    })();
    expect(h.spawned.length).toBeGreaterThanOrEqual(2);
    expect(gone).toBe(true);
    // …and the superseded render paints NOTHING on its way out.
    expect(h.html("loam-app")).not.toContain("could not start");
    expect(h.html("loam-app")).not.toContain("timed out");
  });

  it("DARKENING tears down a render in flight — the teardown takes the worker, not just the markup", async () => {
    // The other discard site, and the one that matters most. `darken` drops `reads` and `state` whole,
    // and the shell's header calls that a completeness claim: no pre-erasure answer replayable from the
    // viewer's side. A render still in flight holds the PRE-teardown maps in its own closure, so a
    // teardown that clears the mount and leaves the worker running keeps exactly what it says it drops.
    const patience = Math.min(2_000, ARTIFACT_SPAWN_TIMEOUT_MS / 4);
    liveAfterMs = patience * 2;
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver(); // a render is in flight, not yet live
    h.fail(); // a non-data event: the mount darkens
    const deadline = Date.now() + patience;
    while (!(h.spawned[0]?.terminated ?? false) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(h.spawned[0]?.terminated ?? false).toBe(true);
    // …and the darkened mount stays darkened: the render that was in flight paints nothing at all.
    expect(h.html("loam-app")).toBe("");
  });

  it("a render that CANNOT be mounted keeps its refusal — no earlier render paints over it", async () => {
    // The mount-failure path is a teardown too, and a teardown has to be final rather than merely
    // first. The refusal is painted synchronously; a render still in flight would land afterwards and
    // overwrite it with markup composed from the PREVIOUS node — a stale view presented as current.
    liveAfterMs = 40;
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver(); // render 1 — in flight
    refuseNextWorker = true;
    h.deliver(); // render 2 — its worker cannot be constructed
    expect(h.html("loam-app")).toContain("could not be mounted");
    // Render 1's answer is due at 45 ms; wait past it and past a couple of macrotasks.
    await new Promise((r) => setTimeout(r, 300));
    expect(h.html("loam-app")).toContain("could not be mounted");
    expect(h.html("loam-app")).not.toContain("h=7");
    expect(h.spawned[0]!.terminated).toBe(true);
  });

  it("a realm posting the shell's OWN bookkeeping kind is a fault, not a silent blank", async () => {
    // `done` is called with whatever the worker posted, and a bundle can reach a bare postMessage, so
    // any kind the ladder handles specially is a kind a bundle can send. `superseded` is the shell's
    // internal word for a render the world moved past; if the ladder answered it, a bundle could
    // terminate itself into a blank mount with no diagnostic. It is not on the ladder — an unknown
    // kind is a fault — and the internal teardown takes no message at all.
    answerKind = "superseded";
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer faulted", 5_000)).toBe(true);
  });

  it("the spawn ceiling is HARD — a page with a tiny one refuses a slow start rather than waiting", async () => {
    // The pairing of the two rails above: the same slow start that paints fine under the shipped
    // ceiling is refused under a 20 ms one, which is what makes the first rail a property of the
    // NUMBER rather than of the shim's speed.
    liveAfterMs = 300;
    answerAfterMs = 5;
    const page = await pack({ renderSpawnTimeoutMs: 20 });
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer could not start", 5_000)).toBe(true);
  });
});
