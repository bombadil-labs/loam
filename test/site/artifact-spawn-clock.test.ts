// @vitest-environment happy-dom

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

const RENDER_MS = 120;

const BUNDLE = `export default function (node) { return "<div id=body>h=" + node.view.height + "</div>"; }`;

let liveAfterMs = 0;
let answerAfterMs = 0;
let refuseNextWorker = false;
let answerKind = "";
let liveRepeatMs = 0;

let attached: Array<[string, EventListener]> = [];

interface Harness {
  readonly spawned: { terminated: boolean }[];
  deliver(): void;
  fail(): void;
  html(id: string): string;
  until(text: string, ms: number): Promise<boolean>;
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
      for (const t of this.timers) {
        clearTimeout(t);
        clearInterval(t);
      }
    }
    postMessage(msg: { node: { view: { height: unknown } } }): void {
      const at = (liveAfterMs < 0 ? 0 : liveAfterMs) + answerAfterMs;
      if (liveRepeatMs > 0) return;
      this.timers.push(
        setTimeout(() => {
          if (liveAfterMs < 0) return;
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
    expect(coordinates.renderSpawnTimeoutMs).not.toBe(coordinates.renderTimeoutMs);
  });

  it("the shell arms the spawn window from the spawn number and the render window from the render number", async () => {
    const page = await pack();
    const shell = page.slice(page.indexOf("function paint(node)"));
    expect(shell).toContain('done({ kind: "noStart" }); }, C.renderSpawnTimeoutMs)');
    expect(shell).toContain('done({ kind: "timeout" }); }, C.renderTimeoutMs)');
  });

  it("a spawn overrun has its OWN sentence — it never claims the renderer ran", async () => {
    const page = await pack();
    expect(page).toContain("the renderer could not start");
    expect(page).toContain("the renderer timed out");
    expect(page).toContain("this renderer could not be mounted in this viewer");
  });
});

describe("T158: the spawn ceiling is the page's own constant, not an operator option", () => {
  it("artifact.ts fills the coordinate from the constant, with no gateway option in the path", () => {
    const source = readFileSync(join(process.cwd(), "src", "gateway", "artifact.ts"), "utf8");
    expect(source).toContain("renderSpawnTimeoutMs: ARTIFACT_SPAWN_TIMEOUT_MS,");
  });
});

describe("T158 at the BEHAVIOUR: driving the emitted shell in a DOM", () => {
  it("a SLOW START does not report a budget overrun — the render still paints", async () => {
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
    liveAfterMs = 5;
    answerAfterMs = RENDER_MS * 8;
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer timed out", 5_000)).toBe(true);
    expect(h.html("loam-app")).not.toContain("could not start");
  });

  it("a start that NEVER comes is bounded, and says so without claiming the renderer ran", async () => {
    liveAfterMs = -1;
    const page = await pack({ renderSpawnTimeoutMs: 200 });
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer could not start", 5_000)).toBe(true);
    expect(h.html("loam-app")).not.toContain("timed out");
  });

  it("a realm that keeps re-signalling LIVE cannot hold the render clock open", async () => {
    liveAfterMs = 5;
    liveRepeatMs = 20;
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer timed out", 5_000)).toBe(true);
    expect(h.spawned[0]!.terminated).toBe(true);
  });

  it("a SUPERSEDED render that has not yet started is torn down at once, not at its own ceiling", async () => {
    const patience = Math.min(2_000, ARTIFACT_SPAWN_TIMEOUT_MS / 4);
    liveAfterMs = patience * 2;
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver();
    h.deliver();
    const gone = await (async (): Promise<boolean> => {
      const deadline = Date.now() + patience;
      while (!(h.spawned[0]?.terminated ?? false) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      return h.spawned[0]?.terminated ?? false;
    })();
    expect(h.spawned.length).toBeGreaterThanOrEqual(2);
    expect(gone).toBe(true);
    expect(h.html("loam-app")).not.toContain("could not start");
    expect(h.html("loam-app")).not.toContain("timed out");
  });

  it("DARKENING tears down a render in flight — the teardown takes the worker, not just the markup", async () => {
    const patience = Math.min(2_000, ARTIFACT_SPAWN_TIMEOUT_MS / 4);
    liveAfterMs = patience * 2;
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver();
    h.fail();
    const deadline = Date.now() + patience;
    while (!(h.spawned[0]?.terminated ?? false) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(h.spawned[0]?.terminated ?? false).toBe(true);
    expect(h.html("loam-app")).toBe("");
  });

  it("a render that CANNOT be mounted keeps its refusal — no earlier render paints over it", async () => {
    liveAfterMs = 40;
    answerAfterMs = 5;
    const page = await pack();
    const h = load(page);
    h.deliver();
    refuseNextWorker = true;
    h.deliver();
    expect(h.html("loam-app")).toContain("could not be mounted");
    await new Promise((r) => setTimeout(r, 300));
    expect(h.html("loam-app")).toContain("could not be mounted");
    expect(h.html("loam-app")).not.toContain("h=7");
    expect(h.spawned[0]!.terminated).toBe(true);
  });

  it("a realm posting the shell's OWN bookkeeping kind is a fault, not a silent blank", async () => {
    answerKind = "superseded";
    const page = await pack();
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer faulted", 5_000)).toBe(true);
  });

  it("the spawn ceiling is HARD — a page with a tiny one refuses a slow start rather than waiting", async () => {
    liveAfterMs = 300;
    answerAfterMs = 5;
    const page = await pack({ renderSpawnTimeoutMs: 20 });
    const h = load(page);
    h.deliver();
    expect(await h.until("the renderer could not start", 5_000)).toBe(true);
  });
});
