// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SEALED_CHANNELS, sealRealm } from "../../src/gateway/artifact-realm.js";
import { legalNameFor, queryFieldFor } from "../../src/gateway/gql.js";
import { evalPageSource, evalPageValue } from "./eval-page.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
void authorForSeed;

const SENTINEL = "zqx-sentinel-77";
const MOSS = "moss";

const FLOOR = `export default function (node) {
  var keys = Object.keys(node.reads).sort();
  var drawn = keys.map(function (k) {
    var r = node.reads[k];
    return r.error ? "<span class=err>" + k + "!" + r.error.code + ":" + r.error.message + "</span>"
      : "<span class=hit>" + k + "=" + r.view.height + "</span>";
  }).join("");
  var st = Object.keys(node.state).sort().map(function (k) { return k + ":" + node.state[k]; }).join(",");
  return "<div id=body>h=" + node.view.height + " tag=" + node.view.tag + " hex=" + node.hex +
    " page=" + (node.state.page === undefined ? "0" : node.state.page) + " state=" + st + "</div>" +
    "<div id=drawn>" + drawn + "</div>" +
    "<a id=drill data-loam-read=Plant data-loam-entity=" + ${JSON.stringify(MOSS)} + " data-loam-page=2 href=#>more</a>" +
    "<a id=drillA data-loam-read=A data-loam-entity=" + ${JSON.stringify(MOSS)} + " href=#>short</a>" +
    "<form id=edit><input name=height value=99><button>save</button></form>" +
    "<form id=search data-loam-read=Plant data-loam-entity-field=q><input name=q value=" + ${JSON.stringify(MOSS)} + "></form>";
}`;

const BLIND = `export default function (node) { return "<div id=body>h=" + node.view.height + "</div>"; }`;

const MEMOIZING = `var held = null;
export default function (node) {
  if (held === null) held = node;
  return "<div id=body>h=" + held.view.height + "</div>";
}`;

const FAULTING = `export default function (node) { throw new Error("secret internal detail"); }`;

const PEN_CLAIMING = `export default function (node) {
  return "<div id=body>This app writes as the editor pen. h=" + node.view.height + "</div>";
}`;

const boot = async (over: Record<string, unknown> = {}): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [FERN, MOSS],
          writable: [...PLANT_WRITABLE],
        },
      ],
    }),
    { renderTimeoutMs: 2_000 },
  );
  await gw.append([
    observed(FERN, "height", SENTINEL, 1000, OP_SEED),
    observed(FERN, "tag", "outside-consumes", 1000, OP_SEED),
    observed(MOSS, "height", 7, 1000, OP_SEED),
  ]);
  await gw.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: FLOOR,
    ...over,
  });
  await gw.declareArtifact(["plant"]);
  return gw;
};

const packOne = async (bundle?: string): Promise<string> => {
  const gw = await boot(bundle === undefined ? {} : { bundle });
  const page = gw.packArtifact("plant", FERN, {
    server: "My Loam",
    storeAddress: "https://garden.test/garden/mcp",
  }).page;
  await gw.close();
  return page;
};

interface Recorded {
  readonly kind: "watch" | "call" | "invalidate";
  readonly server: string;
  readonly tool: string;
  readonly input: { query?: string; mutation?: string };
  readonly options: unknown;
}

interface Connector {
  answer(document: string): { data?: unknown; errors?: unknown[] };
  reject?: { code: string; message: string; retryable?: boolean; retryAfterMs?: number };
}

interface Harness {
  readonly calls: Recorded[];
  readonly realms: object[];
  readonly storageWrites: string[];
  deliver(payload: unknown): void;
  error(err: { code: string; message: string; retryable?: boolean; retryAfterMs?: number }): void;
  settle(): Promise<void>;
  html(id: string): string;
  body(): string;
  click(id: string): void;
  submit(id: string): void;
}

const answerFor = (document: string, view: Record<string, unknown>, hex = "h0"): unknown => {
  const m = /query \{ (\w+)\(entity: "([^"]*)"\)/.exec(document);
  const field = m?.[1] ?? "Plant";
  const entity = m?.[2] ?? FERN;
  return { data: { [field]: { _entity: entity, _hex: hex, _view: view } } };
};

let silentRealm = false;
let slowRealmMs = 0;

let attached: Array<[string, EventListener]> = [];

const freshPage = (page: string): void => {
  for (const [type, fn] of attached) document.removeEventListener(type, fn);
  attached = [];
  document.documentElement.innerHTML = page
    .replace(/^[\s\S]*?<body>/, "")
    .replace(/<\/body>[\s\S]*$/, "");
};

const load = (page: string, connector: Connector): Harness => {
  const calls: Recorded[] = [];
  const realms: object[] = [];
  const storageWrites: string[] = [];
  let watchHandler: ((ev: unknown) => void) | undefined;
  const pending: Array<Promise<unknown>> = [];

  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: {
        setItem: (k: string) => storageWrites.push(`${name}.setItem(${k})`),
        getItem: () => null,
        removeItem: (k: string) => storageWrites.push(`${name}.removeItem(${k})`),
      },
    });
  }
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open: (k: string) => storageWrites.push(`indexedDB.open(${k})`) },
  });

  class ShimWorker {
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    private live = true;
    constructor(url: string, opts?: unknown) {
      void url;
      void opts;
      realms.push(this);
      queueMicrotask(() => this.emit("message", { data: { kind: "live" } }));
    }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const held = this.listeners.get(type) ?? [];
      held.push(fn);
      this.listeners.set(type, held);
    }
    private emit(type: string, ev: unknown): void {
      if (!this.live) return;
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
    terminate(): void {
      this.live = false;
    }
    postMessage(msg: { bundle: string; node: unknown }): void {
      const scope: Record<string, unknown> = {
        JSON,
        Object,
        String,
        Array,
      };
      for (const name of SEALED_CHANNELS) {
        scope[name] = name === "window" ? { claude: { mcp: { callTool: () => undefined } } } : {};
      }
      sealRealm(scope, SEALED_CHANNELS);
      if (silentRealm) return;
      const later = (fn: () => void): void => {
        if (slowRealmMs > 0) setTimeout(fn, slowRealmMs);
        else queueMicrotask(fn);
      };
      later(() => {
        try {
          const body = msg.bundle.replace(/^\s*export\s+default\s+/m, "return ");
          const fn = evalPageSource<unknown>(`with (scope) { ${body} }`, ["scope"], [scope]);
          if (typeof fn !== "function") {
            this.emit("message", { data: { kind: "notHtml" } });
            return;
          }
          const html = (fn as (n: unknown) => unknown)(msg.node);
          if (typeof html !== "string") {
            this.emit("message", { data: { kind: "notHtml" } });
            return;
          }
          this.emit("message", { data: { kind: "ok", html } });
        } catch {
          this.emit("message", { data: { kind: "fault" } });
        }
      });
    }
  }

  const mcp = {
    watchTool: (
      server: string,
      tool: string,
      input: { query?: string },
      handler: (ev: unknown) => void,
      options: unknown,
    ) => {
      calls.push({ kind: "watch", server, tool, input, options });
      watchHandler = handler;
      return () => undefined;
    },
    callTool: (
      server: string,
      tool: string,
      input: { query?: string; mutation?: string },
      options: unknown,
    ) => {
      calls.push({ kind: "call", server, tool, input, options });
      const p =
        connector.reject !== undefined
          ? Promise.reject(Object.assign(new Error(connector.reject.message), connector.reject))
          : Promise.resolve({ payload: connector.answer(input.query ?? input.mutation ?? "") });
      pending.push(p.catch(() => undefined));
      return p;
    },
    invalidate: (server?: string, tool?: string) => {
      calls.push({
        kind: "invalidate",
        server: server ?? "",
        tool: tool ?? "",
        input: {},
        options: undefined,
      });
      const p = Promise.resolve();
      pending.push(p);
      return p;
    },
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

  freshPage(page);
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

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.all([...pending]);
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  return {
    calls,
    realms,
    storageWrites,
    deliver: (payload: unknown) => watchHandler?.({ type: "data", result: { payload } }),
    error: (err) => watchHandler?.({ type: "error", error: err }),
    settle,
    html: (id) => document.getElementById(id)?.innerHTML ?? "",
    body: () => document.body.innerHTML,
    click: (id) =>
      document.getElementById(id)?.dispatchEvent(new Event("click", { bubbles: true })),
    submit: (id) =>
      document.getElementById(id)?.dispatchEvent(new Event("submit", { bubbles: true })),
  };
};

const answering = (view: Record<string, unknown>, hex = "h0"): Connector => ({
  answer: (doc) => answerFor(doc, view, hex) as { data?: unknown },
});

let PAGE: string;
beforeEach(async () => {
  PAGE = await packOne();
  vi.useRealTimers();
});

describe("§30 criterion 5: the read is LIVE, it is a watch, and its projection is _view", () => {
  it("registers EXACTLY ONE watchTool, on (server, loam_query)", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    await h.settle();
    const watches = h.calls.filter((c) => c.kind === "watch");
    expect(watches).toHaveLength(1);
    expect(watches[0]!.server).toBe("My Loam");
    expect(watches[0]!.tool).toBe("loam_query");
  });

  it("its document is the FIXED selection set — no field list, no asOf", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    await h.settle();
    const doc = h.calls[0]!.input.query!;
    expect(doc).toBe(
      `query { ${queryFieldFor("Plant")}(entity: "${FERN}") { _entity _hex _view } }`,
    );
    expect(doc).not.toContain("Plant(");
    expect(doc).not.toContain("height");
    expect(doc).not.toContain("asOf");
  });

  it("a second data event with a changed value re-renders the mount point", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain(`h=${SENTINEL}`);
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: "grown", tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("h=grown");
    expect(h.html("loam-app")).not.toContain(SENTINEL);
  });

  it("the node carries reads AND state as present, EMPTY objects on the first paint", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("state=");
    expect(h.html("loam-app")).toContain('<div id="drawn"></div>');
  });

  it("hands the bundle the WHOLE resolved view, including a prop outside consumes", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "outside-consumes" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "outside-consumes" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("tag=outside-consumes");
  });
});

describe("§30 criterion 22: the watch declares its cache OFF", () => {
  it("carries cache { staleTime: 0, gcTime: 0 } on the recorded registration", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.calls[0]!.options).toMatchObject({ cache: { staleTime: 0, gcTime: 0 } });
  });
});

describe("§30 criterion 33: a mediated read is an uncached one-shot, never a watch", () => {
  it("over ten gestures: one watch for the page's life, ten uncached callTools", async () => {
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    for (let i = 0; i < 10; i += 1) {
      h.click("drill");
      await h.settle();
    }
    expect(h.calls.filter((c) => c.kind === "watch")).toHaveLength(1);
    const ones = h.calls.filter((c) => c.kind === "call" && c.tool === "loam_query");
    expect(ones).toHaveLength(10);
    for (const c of ones) expect(c.options).toEqual({ cache: false });
    for (const c of h.calls) {
      const cache = (c.options as { cache?: { gcTime?: number } } | undefined)?.cache;
      if (cache !== undefined && cache !== null && typeof cache === "object") {
        expect(cache.gcTime ?? 0).toBe(0);
      }
    }
  });
});

describe("§30 criterion 30: a gesture becomes exactly one query, with a fixed projection", () => {
  it("one data-loam-read click issues ONE loam_query for that lens and entity", async () => {
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    const before = h.calls.length;
    h.click("drill");
    await h.settle();
    const issued = h.calls.slice(before);
    expect(issued).toHaveLength(1);
    expect(issued[0]!.input.query).toBe(
      `query { ${queryFieldFor("Plant")}(entity: "${MOSS}") { _entity _hex _view } }`,
    );
  });

  it("the answer lands in reads[<lens>@<entity>], and a second entity leaves the first intact", async () => {
    const h = load(PAGE, {
      answer: (doc) =>
        answerFor(doc, { height: /moss/.test(doc) ? 7 : 42, tag: "t" }) as { data?: unknown },
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}=7`);
    h.click("search");
    h.submit("search");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}=7`);
  });

  it("a read at an entity the store has nothing for is a SUCCESS carrying an empty view", async () => {
    const h = load(PAGE, { answer: (doc) => answerFor(doc, {}) as { data?: unknown } });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}=undefined`);
    expect(h.html("drawn")).not.toContain("!not_served");
    expect(h.html("drawn")).not.toContain("!refused");
  });

  it("the shell refuses NO gesture of its own accord — there is no shadow allow-list", async () => {
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    const before = h.calls.filter((c) => c.kind === "call").length;
    h.click("drill");
    await h.settle();
    expect(h.calls.filter((c) => c.kind === "call").length).toBe(before + 1);
  });

  it("state is echoed from the gesture's own data-loam-* attributes", async () => {
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("page=0");
    h.click("drill");
    await h.settle();
    expect(h.html("loam-app")).toContain("page=2");
  });
});

describe("§30 criterion 31: a refusal is legible INSIDE the app, in the FLOOR's vocabulary", () => {
  it("a store refusal reaches the node as a floor code, never an MCP code", async () => {
    const h = load(PAGE, {
      answer: () => ({}),
      reject: { code: "needs_reauth", message: "the connector lapsed" },
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}!needs_connection`);
    expect(h.html("drawn")).not.toContain("needs_reauth");
  });

  it.each([
    ["needs_reauth", "needs_connection"],
    ["server_not_connected", "needs_connection"],
    ["selection_required", "needs_connection"],
    ["not_granted", "needs_connection"],
    ["capability_disabled", "needs_connection"],
    ["server_unavailable", "unavailable"],
    ["rate_limited", "unavailable"],
    ["cancelled", "unavailable"],
    ["tool_error", "refused"],
    ["not_in_manifest", "refused"],
    ["blocked_by_policy", "refused"],
    ["approval_required", "refused"],
    ["bad_request", "refused"],
    ["upstream_error", "refused"],
  ])("maps the MCP code %s onto the floor's %s", async (mcpCode, floorCode) => {
    const h = load(PAGE, { answer: () => ({}), reject: { code: mcpCode, message: "why" } });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).toContain(`!${floorCode}`);
  });

  it("a refused drill-down does NOT blank the page — the previous content is still painted", async () => {
    const h = load(PAGE, {
      answer: () => ({}),
      reject: { code: "tool_error", message: "declined" },
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("loam-app")).toContain(`h=${SENTINEL}`);
    expect(h.html("drawn")).toContain("declined");
  });

  it("with a renderer that IGNORES reads, the shell's own status line still names the refusal", async () => {
    const blind = await packOne(BLIND);
    const h = load(blind, {
      answer: () => ({}),
      reject: { code: "tool_error", message: "declined" },
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.error({ code: "tool_error", message: "declined" });
    await h.settle();
    expect(h.html("loam-status")).toContain("declined");
    expect(document.getElementById("loam-status")).not.toBeNull();
  });
});

describe("§30 criterion 9b: the HOST gets the last word about who writes", () => {
  it("the writer-identity statement is the LAST writing-identity claim, after the mount point", async () => {
    const claiming = await packOne(PEN_CLAIMING);
    const h = load(claiming, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    const html = h.body();
    expect(html).toContain("writes as the editor pen");
    const bundleClaim = html.indexOf("writes as the editor pen");
    const hostClaim = html.indexOf("This page writes as");
    expect(hostClaim).toBeGreaterThan(bundleClaim);
    expect(
      document.getElementById("loam-app")!.contains(document.getElementById("loam-writer")),
    ).toBe(false);
    expect(document.getElementById("loam-writer")!.textContent).toContain(
      "your own author standing",
    );
  });
});

describe("§30 criterion 15: degraded states branch on code, exhaustively, and never blank", () => {
  const CODES = [
    "server_not_connected",
    "selection_required",
    "needs_reauth",
    "not_granted",
    "capability_disabled",
    "server_unavailable",
    "tool_error",
    "not_in_manifest",
    "blocked_by_policy",
    "approval_required",
    "bad_request",
  ];

  it("every code in the table produces a DISTINCT rendering naming its own fix", async () => {
    const seen = new Map<string, string>();
    for (const code of CODES) {
      const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
      h.error({ code, message: `the store said ${code}` });
      await h.settle();
      const text = h.html("loam-status");
      expect(text, code).not.toBe("");
      seen.set(code, text);
    }
    expect(new Set(seen.values()).size).toBe(CODES.length);
  });

  it("selection_required and server_not_connected are DIFFERENT copy — they have different fixes", async () => {
    const a = load(PAGE, answering({ height: 1, tag: "t" }));
    a.error({ code: "server_not_connected", message: "" });
    await a.settle();
    const notConnected = a.html("loam-status");
    const b = load(PAGE, answering({ height: 1, tag: "t" }));
    b.error({ code: "selection_required", message: "" });
    await b.settle();
    const choose = b.html("loam-status");
    expect(notConnected).not.toBe(choose);
    expect(notConnected).toContain("Add it in claude.ai Settings");
    expect(choose).toContain("choose which one");
  });

  it("the connector name and the store address appear in the server_not_connected copy", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "server_not_connected", message: "" });
    await h.settle();
    expect(h.html("loam-status")).toContain("My Loam");
    expect(h.html("loam-status")).toContain("https://garden.test/garden/mcp");
  });

  it("tool_error surfaces the STORE's own reported message", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "tool_error", message: "no such field height2 on Plant" });
    await h.settle();
    expect(h.html("loam-status")).toContain("no such field height2 on Plant");
  });

  it("an UNKNOWN code names ITSELF rather than joining a catch-all", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "some_future_code", message: "hello" });
    await h.settle();
    expect(h.html("loam-status")).toContain("some_future_code");
  });

  it("needs_reauth, server_not_connected and selection_required produce ZERO retries", async () => {
    for (const code of ["needs_reauth", "server_not_connected", "selection_required"]) {
      const h = load(PAGE, answering({ height: 1, tag: "t" }));
      h.error({ code, message: "", retryable: true, retryAfterMs: 1 });
      await h.settle();
      expect(
        h.calls.filter((c) => c.kind === "invalidate"),
        code,
      ).toHaveLength(0);
      expect(h.calls.filter((c) => c.kind === "call")).toHaveLength(0);
    }
  });

  it("server_unavailable retries EXACTLY once however many times it arrives", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    for (let i = 0; i < 5; i += 1) {
      h.error({ code: "server_unavailable", message: "", retryable: true, retryAfterMs: 1 });
    }
    await h.settle();
    await h.settle();
    expect(h.calls.filter((c) => c.kind === "invalidate")).toHaveLength(1);
    expect(h.html("loam-status")).toContain("unreachable right now");
  });

  it("an error with NO retryable stamp is never retried, whatever its code", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "server_unavailable", message: "" });
    await h.settle();
    await h.settle();
    expect(h.calls.filter((c) => c.kind === "invalidate")).toHaveLength(0);
  });

  it("with window.claude ABSENT entirely the page still renders its static shell", () => {
    Object.defineProperty(globalThis, "claude", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    freshPage(PAGE);
    const shell = [...document.querySelectorAll("script")].find(
      (s) => s.getAttribute("type") === null,
    )!;
    evalPageSource<void>(
      shell.textContent ?? "",
      ["document"],
      [
        {
          getElementById: (id: string) => document.getElementById(id),
          addEventListener: (type: string, fn: EventListener) => {
            attached.push([type, fn]);
            document.addEventListener(type, fn);
          },
        },
      ],
    );
    expect(document.body.innerHTML.trim()).not.toBe("");
    expect(document.getElementById("loam-capability")!.textContent).toContain("reads the lens");
    expect(document.getElementById("loam-status")!.textContent).toContain("inert until it runs");
  });
});

describe("§30 criterion 24: a store serving a DIFFERENT schema gets a named, actionable message", () => {
  it("names the lens and the store's own error, with no partial view and no blank", async () => {
    const h = load(PAGE, {
      answer: () => ({
        errors: [{ message: `Cannot query field "${queryFieldFor("Plant")}" on type "Query".` }],
      }),
    });
    h.deliver({
      errors: [{ message: `Cannot query field "${queryFieldFor("Plant")}" on type "Query".` }],
    });
    await h.settle();
    const status = h.html("loam-status");
    expect(status).toContain("Plant");
    expect(status).toContain("Cannot query field");
    expect(h.html("loam-app")).toBe("");
    expect(h.body().trim()).not.toBe("");
  });

  it("and a prop-name mismatch after legal() mangling lands on the same path", async () => {
    const h = load(PAGE, { answer: () => ({}) });
    h.deliver({ data: { SomeOtherLens: { _entity: FERN, _hex: "h", _view: {} } } });
    await h.settle();
    expect(h.html("loam-status")).toContain("Plant");
    expect(h.html("loam-app")).toBe("");
  });
});

describe("§30 criterion 23: no non-data event leaves a previous view painted", () => {
  it.each([
    "server_not_connected",
    "selection_required",
    "needs_reauth",
    "not_granted",
    "capability_disabled",
    "server_unavailable",
    "tool_error",
    "not_in_manifest",
    "blocked_by_policy",
    "approval_required",
    "bad_request",
  ])("on %s the sentinel is ABSENT from the mount point", async (code) => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain(SENTINEL);
    h.error({ code, message: "" });
    await h.settle();
    expect(h.html("loam-app")).not.toContain(SENTINEL);
  });

  it("a revalidating replay also clears it, and the accumulated reads map is dropped WHOLE", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}=`);
    h.error({ code: "server_unavailable", message: "" });
    await h.settle();
    expect(h.html("loam-app")).not.toContain(SENTINEL);
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: "fresh", tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("h=fresh");
    expect(h.html("drawn")).toBe("");
  });

  it("an ERASURE arrives as an ordinary answer, and the shell tears down on it", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    const before = h.calls.filter((c) => c.kind === "invalidate").length;
    h.deliver(answerFor(h.calls[0]!.input.query!, {}, "h-moved"));
    await h.settle();
    expect(h.html("loam-app")).not.toContain(SENTINEL);
    expect(h.html("drawn")).toBe("");
    expect(h.calls.filter((c) => c.kind === "invalidate").length).toBe(before + 1);
  });

  it("the teardown fires on a MOVED root, not only on a vanished key", async () => {
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }, "hex-1"));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).not.toBe("");
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: ["a"] }, "hex-2"));
    await h.settle();
    expect(h.html("drawn")).toBe("");
  });

  it("…and a poll that changes NOTHING keeps the drill-downs a viewer is looking at", async () => {
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }, "hex-1"));
    await h.settle();
    h.click("drill");
    await h.settle();
    const drawn = h.html("drawn");
    expect(drawn).not.toBe("");
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }, "hex-1"));
    await h.settle();
    expect(h.html("drawn")).toBe(drawn);
  });
});

describe("§30 criterion 23: the teardown is FINAL, not merely first", () => {
  it("a render that lands after a clearing event paints NOTHING", async () => {
    slowRealmMs = 40;
    try {
      const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
      h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }, "hex-1"));
      await new Promise((r) => setTimeout(r, 5));
      h.error({ code: "server_unavailable", message: "" });
      await new Promise((r) => setTimeout(r, 120));
      expect(h.html("loam-app")).not.toContain(SENTINEL);
      expect(h.html("loam-app")).toBe("");
    } finally {
      slowRealmMs = 0;
    }
  });

  it("…and a render that lands normally still paints — the guard is not a blanket refusal", async () => {
    slowRealmMs = 40;
    try {
      const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
      h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }, "hex-1"));
      await new Promise((r) => setTimeout(r, 120));
      expect(h.html("loam-app")).toContain(SENTINEL);
    } finally {
      slowRealmMs = 0;
    }
  });
});

describe("§30 criterion 31: not_served is ANCHORED, not a substring", () => {
  const subfieldError = { errors: [{ message: 'Cannot query field "_nope" on type "AView".' }] };
  const rootFieldError = { errors: [{ message: 'Cannot query field "a" on type "Query".' }] };

  it("a SUBfield error on a one-character lens maps to refused", async () => {
    const h = load(PAGE, {
      answer: (doc) =>
        /^query \{ a\(/.test(doc)
          ? subfieldError
          : (answerFor(doc, { height: 1 }) as { data?: unknown }),
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1 }));
    await h.settle();
    h.click("drillA");
    await h.settle();
    expect(h.html("drawn")).toContain("A@moss!refused");
    expect(h.html("drawn")).not.toContain("!not_served");
  });

  it("…while an unknown ROOT field on the same lens IS not_served", async () => {
    const h = load(PAGE, {
      answer: (doc) =>
        /^query \{ a\(/.test(doc)
          ? rootFieldError
          : (answerFor(doc, { height: 1 }) as { data?: unknown }),
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1 }));
    await h.settle();
    h.click("drillA");
    await h.settle();
    expect(h.html("drawn")).toContain("A@moss!not_served");
  });
});

describe("§30 criterion 34: the compartment retains nothing", () => {
  it("a bundle that memoizes in MODULE SCOPE cannot paint a previous render's value", async () => {
    const memo = await packOne(MEMOIZING);
    const h = load(memo, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain(SENTINEL);
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: "second", tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("second");
    expect(h.html("loam-app")).not.toContain(SENTINEL);
  });

  it("the realm the shell posts to is a DIFFERENT instance on every render", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 2, tag: "t" }));
    await h.settle();
    expect(h.realms.length).toBeGreaterThanOrEqual(2);
    expect(new Set(h.realms).size).toBe(h.realms.length);
  });

  it("the SHELL writes no storage either — zero writes across a full interactive session", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    h.submit("edit");
    await h.settle();
    h.error({ code: "server_unavailable", message: "" });
    await h.settle();
    expect(h.storageWrites).toEqual([]);
    for (const api of [
      "localStorage.setItem",
      "sessionStorage.setItem",
      "indexedDB.open",
      "document.cookie",
    ]) {
      expect(PAGE).not.toContain(api);
    }
  });
});

describe("§30 criterion 19: TOTAL MCP traffic equals the shell's own calls", () => {
  it("a bundle that deliberately reaches for callTool adds NOT ONE call", async () => {
    const probes = SEALED_CHANNELS.map(
      (n) => `if (typeof ${n} !== "undefined") seen.push(${JSON.stringify(n)});`,
    ).join("\n  ");
    const reaching = `export default function (node) {
  try { window.claude.mcp.callTool("My Loam", "loam_mutate", { mutation: "mutation { plant(entity: \\"x\\", height: 1) { _entity } }" }); } catch (sealed) { /* the realm has no window */ }
  var seen = [];
  ${probes}
  return "<div id=body>saw=[" + seen.join(",") + "]</div>";
}`;
    const tampered = PAGE.replace(
      /(<script type="application\/json" id="loam-bundle">)[\s\S]*?(<\/script>)/,
      (_m, a: string, b: string) => a + JSON.stringify(reaching).replace(/</g, "\\u003c") + b,
    );
    const h = load(tampered, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("saw=[]");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.kind).toBe("watch");
  });

  it("and the count still holds after INTERACTION: three gestures, three calls, no new watch", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    const before = h.calls.length;
    for (let i = 0; i < 3; i += 1) {
      h.click("drill");
      await h.settle();
    }
    const added = h.calls.slice(before);
    expect(added).toHaveLength(3);
    expect(added.every((c) => c.kind === "call" && c.tool === "loam_query")).toBe(true);
  });
});

describe("§30 criterion 21 (the fold half): a failing bundle refuses cleanly, never blankly", () => {
  it("a faulting bundle paints a legible refusal and leaks nothing of its internals", async () => {
    const faulting = await packOne(FAULTING);
    const h = load(faulting, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("the renderer faulted");
    expect(h.html("loam-app")).not.toContain("secret internal detail");
    expect(h.html("loam-status")).not.toContain("secret internal detail");
  });

  it("a bundle returning a NON-STRING is the notHtml fold, not a crash", async () => {
    const notHtml = await packOne("export default function (node) { return { markup: 1 }; }");
    const h = load(notHtml, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("did not return HTML");
  });

  it("a SILENT realm hits the render clock and paints the timeout fold", async () => {
    silentRealm = true;
    try {
      const h = load(PAGE, answering({ height: 1, tag: "t" }));
      h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
      const deadline = Date.now() + 15_000;
      while (!h.html("loam-app").includes("the renderer timed out") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(h.html("loam-app")).toContain("the renderer timed out");
    } finally {
      silentRealm = false;
    }
  }, 20_000);

  it("WHAT IS NOT PROVEN HERE: termination of a wedged bundle, and the memory residual", async () => {
    const page = await packOne();
    expect(page).toContain("renderTimeoutMs");
    expect(page).toContain('msg.kind === "live"');
    expect(page).toContain("worker.terminate()");
  });
});

describe("§30 criterion 29: the bundle never asks — RenderFn is unchanged", () => {
  it("the default export is (node) => string, synchronous, called directly outside the shell", () => {
    const fn = evalPageValue<(n: unknown) => unknown>(
      FLOOR.replace(/^\s*export\s+default\s+/m, "return "),
    );
    const out = fn({ entity: FERN, view: { height: 1 }, hex: "h", reads: {}, state: {} });
    expect(typeof out).toBe("string");
    expect((out as Promise<unknown>) instanceof Promise).toBe(false);
  });

  it("the worker receives exactly ONE message per render and posts exactly one back", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    expect(h.realms).toHaveLength(1);
  });
});

describe("§30 criterion 25: the write surface is pinned to the ACKNOWLEDGED writable set", () => {
  it("a field IN the set maps to loam_mutate", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.submit("edit");
    await h.settle();
    const writes = h.calls.filter((c) => c.tool === "loam_mutate");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.input.mutation).toContain('height: "99"');
  });

  it("a field OUTSIDE it produces ZERO loam_mutate calls, and says so", async () => {
    const narrow = await (async (): Promise<string> => {
      const gw = await boot();
      const page = gw.packArtifact("plant", FERN, { server: "My Loam" }).page;
      await gw.close();
      return page.replace(/"writable":\["[^"]*"(,"[^"]*")*\]/, '"writable":["tag"]');
    })();
    const h = load(narrow, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.submit("edit");
    await h.settle();
    expect(h.calls.filter((c) => c.tool === "loam_mutate")).toHaveLength(0);
    expect(h.html("loam-status")).toContain("not published to write");
  });
});

describe("§30 criterion 25: a REFUSED write is not silent", () => {
  it("a store refusal on the RESOLVED branch reaches the status line", async () => {
    const h = load(PAGE, {
      answer: (doc) =>
        /^mutation/.test(doc)
          ? { errors: ['field "height" is not writable'] }
          : (answerFor(doc, { height: SENTINEL, tag: "t" }) as { data?: unknown }),
    });
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.submit("edit");
    await h.settle();
    expect(h.calls.filter((c) => c.tool === "loam_mutate")).toHaveLength(1);
    expect(h.html("loam-status")).toContain("not writable");
    expect(h.calls.filter((c) => c.kind === "invalidate")).toHaveLength(0);
  });

  it("an ACCEPTED write says so, and refetches", async () => {
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.submit("edit");
    await h.settle();
    expect(h.html("loam-status")).toContain("saved");
    expect(h.calls.filter((c) => c.kind === "invalidate")).toHaveLength(1);
  });
});

describe("§30 criterion 36: the page holds no boundary of its own", () => {
  it("a TAMPERED page's gesture reaches the store, and gets the STORE's answer", async () => {
    const tampered = PAGE.replace(/"lens":"Plant"/, '"lens":"Ledger"');
    const served = load(tampered, answering({ height: 5, tag: "t" }));
    await served.settle();
    expect(served.calls[0]!.input.query).toContain(`${queryFieldFor("Ledger")}(entity:`);
    served.deliver({
      data: { [queryFieldFor("Ledger")]: { _entity: FERN, _hex: "h", _view: { height: 5 } } },
    });
    await served.settle();
    expect(served.html("loam-app")).toContain("h=5");
  });

  it("and against a store that does NOT serve it, the store's own refusal comes back", async () => {
    const tampered = PAGE.replace(/"lens":"Plant"/, '"lens":"Ledger"');
    const h = load(tampered, { answer: () => ({}) });
    h.deliver({
      errors: [{ message: `Cannot query field "${queryFieldFor("Ledger")}" on type "Query".` }],
    });
    await h.settle();
    expect(h.html("loam-status")).toContain("Ledger");
    expect(h.html("loam-app")).toBe("");
  });
});

describe("§30 criterion 26: an emitted page OUTLIVES its withdrawal — the accepted residual", () => {
  it("still renders after the declaration and the binding are struck", async () => {
    const gw = await boot();
    const page = gw.packArtifact("plant", FERN, { server: "My Loam" }).page;
    const binding = gw.renderers()[0]!;
    await gw.erase(binding.deltaId, { reason: "withdrawn" });
    expect(() => gw.packArtifact("plant", FERN, { server: "My Loam" })).toThrow();
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(404);
    await gw.close();
    const h = load(page, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain(SENTINEL);
  });
});

describe("§30 criterion 4: the page requests nothing from an external host, through ANY channel", () => {
  it("with fetch, XHR, WebSocket AND the MCP seam all trapped, only the seam is used", async () => {
    const touched: string[] = [];
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket"] as const) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: function trap() {
          touched.push(name);
          throw new Error(`${name} is not a channel this page has`);
        },
      });
    }
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(touched).toEqual([]);
    expect(h.calls.every((c) => c.server === "My Loam")).toBe(true);
  });
});

describe("§30 criterion 8: the STORE rides the connector, not the page", () => {
  it("the SAME bytes against two connectors pointing at different mounts render two readings", async () => {
    const here = load(PAGE, answering({ height: "the garden's own", tag: "t" }));
    here.deliver(answerFor(here.calls[0]!.input.query!, { height: "the garden's own", tag: "t" }));
    await here.settle();
    expect(here.html("loam-app")).toContain("the garden's own");

    const there = load(PAGE, answering({ height: "a stranger's store", tag: "t" }));
    there.deliver(
      answerFor(there.calls[0]!.input.query!, { height: "a stranger's store", tag: "t" }),
    );
    await there.settle();
    expect(there.html("loam-app")).toContain("a stranger's store");
    expect(PAGE).not.toContain(OP_SEED);
  });

  it("a connector pointing at a mount that does not serve the lens renders the refusal path", async () => {
    const h = load(PAGE, { answer: () => ({}) });
    h.deliver({
      errors: [{ message: `Cannot query field "${queryFieldFor("Plant")}" on type "Query".` }],
    });
    await h.settle();
    expect(h.html("loam-app")).toBe("");
    expect(h.html("loam-status")).toContain("Plant");
  });
});

describe("§30 criterion 18: a dangling mount degrades, never blanks", () => {
  it("renders the onboarding copy rather than a blank or partial view", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "server_not_connected", message: "no connector answers" });
    await h.settle();
    expect(h.html("loam-app")).toBe("");
    expect(h.html("loam-status")).toContain("Add it in claude.ai Settings");
    expect(document.getElementById("loam-onboarding")!.hasAttribute("hidden")).toBe(false);
    expect(h.body().trim()).not.toBe("");
  });
});

describe("§30 criterion 13b: an undeclared bytes leaf degrades legibly", () => {
  it("a ref-only envelope renders a placeholder; an inline base64url renders as a data URI", async () => {
    const drawing = `export default function (node) {
  var v = node.view.photo;
  var painted = v && v.base64url
    ? "<img src=\\"data:" + v.mime + ";base64," + v.base64url + "\\">"
    : v && v.ref ? "<span class=ref>an image this page cannot fetch: " + v.ref + "</span>" : "-";
  return "<div id=body>" + painted + "</div>";
}`;
    const page = await packOne(drawing);
    const refOnly = load(page, answering({ photo: { mime: "image/png", ref: "abc123" } }));
    refOnly.deliver(
      answerFor(refOnly.calls[0]!.input.query!, { photo: { mime: "image/png", ref: "abc123" } }),
    );
    await refOnly.settle();
    expect(refOnly.html("loam-app")).toContain("cannot fetch");
    expect(refOnly.html("loam-app")).not.toMatch(/src="https?:/);

    const inline = load(
      page,
      answering({ photo: { mime: "image/png", ref: "abc123", base64url: "AAAA" } }),
    );
    inline.deliver(
      answerFor(inline.calls[0]!.input.query!, {
        photo: { mime: "image/png", ref: "abc123", base64url: "AAAA" },
      }),
    );
    await inline.settle();
    expect(inline.html("loam-app")).toContain("data:image/png;base64,AAAA");
  });
});

describe("§30: the SHELL's own composed MUTATION executes against a real schema", () => {
  const writingStore = async (capitalProp: boolean): Promise<{ gw: Gateway; page: string }> => {
    const props = new Map(
      [...PLANT_POLICY.props].map(
        ([k, v]) => [capitalProp && k === "height" ? "Height" : k, v] as const,
      ),
    );
    const writable = capitalProp ? ["Height", "tag", "watered", "readings"] : [...PLANT_WRITABLE];
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          { hyperschema: PLANT, schema: { ...PLANT_POLICY, props }, roots: [FERN], writable },
        ],
      }),
      { renderTimeoutMs: 2_000 },
    );
    const field = capitalProp ? "Height" : "height";
    const bundle = `export default function (node) {
  return "<form id=edit><input name=${field} value=99></form>";
}`;
    await gw.publishRenderer({ route: "plant", schema: "Plant", consumes: [field], bundle });
    await gw.declareArtifact(["plant"]);
    return { gw, page: gw.packArtifact("plant", FERN, { server: "My Loam" }).page };
  };

  const composedMutation = async (page: string): Promise<string> => {
    const h = load(page, answering({ height: 1 }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1 }));
    await h.settle();
    h.submit("edit");
    await h.settle();
    const write = h.calls.find((c) => c.tool === "loam_mutate");
    expect(write, "the shell issued a loam_mutate").toBeDefined();
    return write!.input.mutation!;
  };

  it("a lowercase-initial writable prop: the shell's document is ACCEPTED by the store", async () => {
    const { gw, page } = await writingStore(false);
    const doc = await composedMutation(page);
    const result = await gw.query(doc);
    expect(result.errors, JSON.stringify(result.errors)).toBeUndefined();
    expect(JSON.stringify(result.data)).toContain("99");
    await gw.close();
  });

  it("a CAPITAL-initial writable prop: still accepted — the two manglings are kept apart", async () => {
    const { gw, page } = await writingStore(true);
    const doc = await composedMutation(page);
    expect(doc).toContain(`${queryFieldFor("Plant")}(`);
    expect(doc).toContain(`${legalNameFor("Height")}:`);
    const result = await gw.query(doc);
    expect(result.errors, JSON.stringify(result.errors)).toBeUndefined();
    expect(JSON.stringify(result.data)).toContain("99");
    const wrong = await gw.query(doc.replace("Height:", "height:"));
    expect(wrong.errors?.join(" ")).toMatch(/Unknown argument/);
    await gw.close();
  });
});

describe("the page's TWO manglings agree with the store's, function for function", () => {
  const shellFns = (
    page: string,
  ): { legalName: (s: string) => string; rootField: (s: string) => string } => {
    const m =
      /function legalName\(s\) \{[\s\S]*?\n {2}\}\n {2}function rootField\(s\) \{[\s\S]*?\n {2}\}/.exec(
        page,
      );
    expect(m, "the page carries BOTH manglings").not.toBeNull();
    return evalPageValue(`${m![0]}; return { legalName: legalName, rootField: rootField };`);
  };

  it("both agree over every shape, and DIVERGE on a capital initial", async () => {
    const gw = await boot();
    const { page } = gw.packArtifact("plant", FERN, { server: "My Loam" });
    const fns = shellFns(page);
    for (const name of ["Plant", "plant", "Height", "NotesByTag", "a-b c", "9lives", "_x", "A"]) {
      expect(fns.legalName(name), `legalName(${name})`).toBe(legalNameFor(name));
      expect(fns.rootField(name), `rootField(${name})`).toBe(queryFieldFor(name));
    }
    expect(fns.legalName("Height")).toBe("Height");
    expect(fns.rootField("Height")).toBe("height");
    expect(fns.legalName("Height")).not.toBe(fns.rootField("Height"));
    await gw.close();
  });
});
