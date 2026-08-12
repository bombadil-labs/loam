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
// WHAT NO RAIL HERE PROVES: that a REAL browser Worker's spawn ever exceeds a real budget. No seam
// makes Chrome's thread start slow on demand, and a rail that manufactured host load would be the
// flake it exists to prevent. That direction is the load table in the PR, measured through CDP
// against the shipped realm program.

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

let attached: Array<[string, EventListener]> = [];

interface Harness {
  deliver(): void;
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

  class ShimWorker {
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    private alive = true;
    private readonly timers: ReturnType<typeof setTimeout>[] = [];
    constructor() {
      if (liveAfterMs >= 0) {
        this.timers.push(setTimeout(() => this.emit({ kind: "live" }), liveAfterMs));
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
      for (const t of this.timers) clearTimeout(t);
    }
    postMessage(msg: { node: { view: { height: unknown } } }): void {
      // The answer is scheduled relative to the SPAWN, exactly as a real realm's would be: the realm
      // cannot render before it is live, so the shim adds its render span to the live moment.
      const at = (liveAfterMs < 0 ? 0 : liveAfterMs) + answerAfterMs;
      this.timers.push(
        setTimeout(() => {
          if (liveAfterMs < 0) return; // never went live: it cannot answer either
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
    // Distinct from every other fold's text, so a viewer can tell the device from the bundle.
    expect(page).toContain("the renderer timed out");
    expect(page).toContain("this renderer could not be mounted in this viewer");
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
