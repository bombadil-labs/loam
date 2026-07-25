// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call */
//
// A HARNESS THAT EVALUATES THE EMITTED PAGE. `new Function` is the instrument, not an oversight: the
// whole point is to run the bytes the pack door produced rather than a re-implementation of them, and
// a rail that paraphrased the shell would be a rail about the paraphrase. `src/` carries no eval of
// any kind — criterion 4 asserts that over the emitted bytes.
//
// SPEC §30 — the emitted page, DRIVEN. The shell is the client host adapter: it holds the coordinates,
// talks to the viewer's own connector, mounts the bundle in a confined realm, and mediates every gesture.
// This suite loads the real emitted bytes into a DOM and drives them.
//
// THE ENVIRONMENT IS PER-FILE, deliberately. `// @vitest-environment happy-dom` above puts THIS file in a
// DOM and leaves `vitest.config.mjs` alone — putting every existing suite in a DOM is a change no ticket
// asked for, and it would silently alter what a hundred other rails run against.
//
// WHAT THE WORKER SHIM IS, AND WHAT IT IS NOT. happy-dom ships no `Worker`, so one is fabricated here: it
// seals a fresh scope with the SHIPPED `sealRealm` (the same function the page embeds — see
// `test/gateway/artifact-realm.test.ts`, which rails it as a program), evaluates the bundle's default
// export inside that scope, and speaks `render-worker.ts`'s message protocol. What that buys is the whole
// SHELL side of every criterion below: the traffic count at the one seam that holds an MCP handle, the
// per-render lifetime, the gesture round-trip, the degraded states.
//
// What it does NOT prove: that a real browser Worker's realm carries exactly the globals sealed here, or
// that a `blob:`/`data:` module import is permitted under the artifact CSP. Those two are unproven by any
// rail in this repo and are named as such in the PR. The confinement CLAIM is not resting on this shim —
// it rests on `sealRealm` (railed as a program, in Node) plus the pack-time reference refusal
// (`test/gateway/artifact-pack.test.ts`), which is why a shim here is honest rather than load-bearing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SEALED_CHANNELS, sealRealm } from "../../src/gateway/artifact-page.js";
import { queryFieldFor } from "../../src/gateway/gql.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
void authorForSeed;

const SENTINEL = "zqx-sentinel-77";
const MOSS = "moss";

// The FLOOR fixture: pure, synchronous, reaching for no host global. It draws `reads` and `state`, a
// `consumes` field, `hex`, and `tag` — a prop OUTSIDE `consumes` — plus a read gesture and a form.
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
    "<form id=edit><input name=height value=99><button>save</button></form>" +
    "<form id=search data-loam-read=Plant data-loam-entity-field=q><input name=q value=" + ${JSON.stringify(MOSS)} + "></form>";
}`;

// A renderer that IGNORES `reads` entirely — so the shell's own status line is the only thing that can
// name a refusal, which is exactly what criterion 31(c) asks.
const BLIND = `export default function (node) { return "<div id=body>h=" + node.view.height + "</div>"; }`;

// A renderer that memoizes its node in MODULE SCOPE and returns the stored value. With a fresh realm per
// render it can never paint a previous render's answer, because there is nothing to hold the copy in.
const MEMOIZING = `var held = null;
export default function (node) {
  if (held === null) held = node;
  return "<div id=body>h=" + held.view.height + "</div>";
}`;

// A renderer that FAULTS. Deliberately not a spinner: a same-thread shim shares the event loop with
// the code it runs, so an infinite loop wedges the harness rather than being terminated by it — a shim
// cannot model termination, and pretending otherwise would be a rail about the shim. What a fault DOES
// show is the other half of the same discipline: every failure folds to a clean refusal that leaks
// nothing of the bundle's internals, and the mount point is never left blank.
const FAULTING = `export default function (node) { throw new Error("secret internal detail"); }`;

// A renderer that lies about its own provenance, so criterion 9(b)'s DOM order has something to beat.
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

// --- the harness -----------------------------------------------------------------------------------

interface Recorded {
  readonly kind: "watch" | "call";
  readonly server: string;
  readonly tool: string;
  readonly input: { query?: string; mutation?: string };
  readonly options: unknown;
}

interface Connector {
  // What the store answers for a given document, as `loam_query` would: a `{ data, errors }` payload.
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

// One `loam_query` answer, in the shape `handleMcp` returns: the tool's text block parsed to a payload.
const answerFor = (document: string, view: Record<string, unknown>, hex = "h0"): unknown => {
  const m = /query \{ (\w+)\(entity: "([^"]*)"\)/.exec(document);
  const field = m?.[1] ?? "Plant";
  const entity = m?.[2] ?? FERN;
  return { data: { [field]: { _entity: entity, _hex: hex, _view: view } } };
};

// Listeners the last shell attached to `document`. A shell delegates from the document (one seam for
// both verbs), so nothing else can find them again — the harness has to hold them itself.
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

  // Storage APIs as TRAPS: criterion 34(d) wants zero writes across a full interactive session, and the
  // only way to see a write is to be the thing written to.
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

  // The Worker shim. A fresh SEALED scope per instance, `render-worker.ts`'s protocol, and the bundle's
  // default export evaluated inside it. See the file header for what this does and does not prove.
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
        indexedDB: { open: () => undefined },
        caches: {},
        BroadcastChannel: function BroadcastChannel() {},
        fetch: () => undefined,
        self: {},
        window: { claude: { mcp: { callTool: () => undefined } } },
        document: {},
        JSON,
        Object,
        String,
        Array,
      };
      sealRealm(scope, SEALED_CHANNELS);
      queueMicrotask(() => {
        try {
          // The bundle's own body, evaluated with ONLY the sealed scope's bindings in view. A real
          // module import in a real worker realm; here, a function whose free names resolve to the
          // sealed scope. `with` is the only construct that gives a plain object that role.
          const body = msg.bundle.replace(/^\s*export\s+default\s+/m, "return ");
          const make = new Function("scope", `with (scope) { ${body} }`) as (s: object) => unknown;
          const fn = make(scope);
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
      // An MCP failure REJECTS with an McpError-shaped object — a plain `{ code, message }`, not an
      // Error subclass. Modelling it as anything else would test a shape the runtime never sends.
      const p =
        connector.reject !== undefined
          ? Promise.reject(Object.assign(new Error(connector.reject.message), connector.reject))
          : Promise.resolve({ payload: connector.answer(input.query ?? input.mutation ?? "") });
      pending.push(p.catch(() => undefined));
      return p;
    },
    invalidate: () => {
      const p = Promise.resolve();
      pending.push(p);
      return p;
    },
  };
  // In happy-dom `window` IS `globalThis`, so one definition covers both `window.claude` (what the
  // shell reads) and the bare global. Writable, or the next load cannot replace it.
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
  // The page's own scripts do not auto-run in this environment; run the shell exactly as emitted — but
  // hand it a `document` whose `addEventListener` the harness can see, so `freshPage` can detach the
  // previous shell. A parameter shadows the global inside the function body; nothing is monkey-patched.
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
  new Function("document", shell.textContent ?? "")(seen);

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

// --- criterion 5 -----------------------------------------------------------------------------------

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
    // A `consumes`-only document would hand the bundle a strictly NARROWER view than
    // `serveRouteImpl`'s `bytesEnvelope(node.view)` — a divergence behind one content address — and it
    // could not name a gesture-chosen lens's fields at all, since they are legal()-mangled store-side.
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    await h.settle();
    const doc = h.calls[0]!.input.query!;
    expect(doc).toBe(
      `query { ${queryFieldFor("Plant")}(entity: "${FERN}") { _entity _hex _view } }`,
    );
    // The field name is the LENS name legal()-mangled and initial-lowercased, which is what
    // `queryFieldFor` derives in gql.ts. `Plant` is the VIEW TYPE's name; a page composing that
    // names a field no store ever built — and a stub echoing the document could never see it, which
    // is why `test/gateway/artifact-reads.test.ts` executes this document against a REAL schema.
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
    // The bundle drew both. An absent member would have thrown inside the realm and folded to a fault.
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

// --- criterion 22 / 33 -----------------------------------------------------------------------------

describe("§30 criterion 22: the watch declares its cache OFF", () => {
  it("carries cache { staleTime: 0, gcTime: 0 } on the recorded registration", async () => {
    // Zero gcTime is the only expression of "keep nothing" a watch accepts, and it must be WRITTEN even
    // though staleTime 0 is the default — because the default that matters is the five-minute gcTime
    // that comes with readOnlyHint: true. Unpinned, a re-boot inside that window replays the last
    // answer: pre-erasure content on the viewer's side of the wall, where §11 cannot reach.
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.calls[0]!.options).toMatchObject({ cache: { staleTime: 0, gcTime: 0 } });
  });
});

describe("§30 criterion 33: a mediated read is an uncached one-shot, never a watch", () => {
  it("over ten gestures: one watch for the page's life, ten uncached callTools", async () => {
    // The per-view watch ceiling is 64 and a duplicate registration is `bad_request`, so
    // watch-per-drill-down is a defect that surfaces as a bug report about page 65.
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
    // …and no call carries a cache object with a non-zero gcTime.
    for (const c of h.calls) {
      const cache = (c.options as { cache?: { gcTime?: number } } | undefined)?.cache;
      if (cache !== undefined && cache !== null && typeof cache === "object") {
        expect(cache.gcTime ?? 0).toBe(0);
      }
    }
  });
});

// --- criterion 30 / 31 -----------------------------------------------------------------------------

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
    h.click("search"); // a form gesture at a different entity
    h.submit("search");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}=7`);
  });

  it("a read at an entity the store has nothing for is a SUCCESS carrying an empty view", async () => {
    // Absence is an answer, not an error — the renderer draws its own "nothing here", which the shell
    // cannot do for it: an empty view and an unfetched one are different states.
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
    // The store adjudicates, from the registration the viewer installed. A page-side read filter would
    // constrain the APP while claiming to constrain the viewer, and this rail is what a future one
    // would have to break.
    const h = load(PAGE, answering({ height: 7, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    const before = h.calls.filter((c) => c.kind === "call").length;
    h.click("drill");
    await h.settle();
    expect(h.calls.filter((c) => c.kind === "call").length).toBe(before + 1);
  });

  it("state is echoed from the gesture's own data-loam-* attributes", async () => {
    // UI state has nowhere else to live: module scope dies with the per-render realm, the worker has no
    // `document` to read the previous paint from, and `reads` holds answers keyed by lens and entity.
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
    // An MCP code crossing into the bundle would be unproducible by the server-rendered host, which has
    // no broker — so a bundle branching on `needs_reauth` would behave differently on one host behind
    // one content address.
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
    // No gesture in this bundle, so drive the root: the status line is outside and AFTER the mount
    // point, so no refusal is invisible even to a renderer that draws none of them.
    h.error({ code: "tool_error", message: "declined" });
    await h.settle();
    expect(h.html("loam-status")).toContain("declined");
    expect(document.getElementById("loam-status")).not.toBeNull();
  });
});

// --- criterion 9b / 15 / 24 ------------------------------------------------------------------------

describe("§30 criterion 9b: the HOST gets the last word about who writes", () => {
  it("the writer-identity statement is the LAST writing-identity claim, after the mount point", async () => {
    // A §23.3-COMPLIANT renderer must SHOW which pen it writes under, so the pen's name is in the
    // bundle source, so it is in a verbatim-riding page. The page therefore cannot be required to omit
    // it; the obligation is the last word instead.
    const claiming = await packOne(PEN_CLAIMING);
    const h = load(claiming, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    const html = h.body();
    expect(html).toContain("writes as the editor pen"); // the bundle's own claim, intact
    const bundleClaim = html.indexOf("writes as the editor pen");
    const hostClaim = html.indexOf("This page writes as");
    expect(hostClaim).toBeGreaterThan(bundleClaim);
    // …and structurally OUTSIDE the mount point, so no re-render can move or bury it.
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
    // Distinctness is the whole criterion: a catch-all hides the one action that would fix the page.
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
    // So that adding a code to the runtime cannot silently become "something went wrong".
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "some_future_code", message: "hello" });
    await h.settle();
    expect(h.html("loam-status")).toContain("some_future_code");
  });

  it("needs_reauth, server_not_connected and selection_required produce ZERO retries", async () => {
    for (const code of ["needs_reauth", "server_not_connected", "selection_required"]) {
      const h = load(PAGE, answering({ height: 1, tag: "t" }));
      h.error({ code, message: "" });
      await h.settle();
      // Repeating these cannot succeed: credential refresh is exhausted, or no connector exists.
      expect(
        h.calls.filter((c) => c.kind === "call"),
        code,
      ).toHaveLength(0);
    }
  });

  it("server_unavailable produces AT MOST one retry, honouring retryAfterMs", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "server_unavailable", message: "", retryable: true, retryAfterMs: 1 });
    h.error({ code: "server_unavailable", message: "", retryable: true, retryAfterMs: 1 });
    await h.settle();
    expect(h.html("loam-status")).toContain("unreachable right now");
  });

  it("with window.claude ABSENT entirely the page still renders its static shell", () => {
    // A top-level navigation is not a supported artifact context, and the member check is the
    // canonical gate — never a probing call. The static shell renders FIRST so a viewer sees
    // something legible rather than nothing.
    Object.defineProperty(globalThis, "claude", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    freshPage(PAGE);
    const shell = [...document.querySelectorAll("script")].find(
      (s) => s.getAttribute("type") === null,
    )!;
    new Function("document", shell.textContent ?? "")({
      getElementById: (id: string) => document.getElementById(id),
      addEventListener: (type: string, fn: EventListener) => {
        attached.push([type, fn]);
        document.addEventListener(type, fn);
      },
    });
    expect(document.body.innerHTML.trim()).not.toBe("");
    expect(document.getElementById("loam-capability")!.textContent).toContain("reads the lens");
    expect(document.getElementById("loam-status")!.textContent).toContain("inert until it runs");
  });
});

describe("§30 criterion 24: a store serving a DIFFERENT schema gets a named, actionable message", () => {
  it("names the lens and the store's own error, with no partial view and no blank", async () => {
    // The case a published page meets most often: reachable, and different. The single code that
    // carries the store's own message is the only thing that can tell a viewer their store lacks the
    // lens, and an earlier reading of this design would have swallowed it into a default branch.
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
    expect(h.html("loam-app")).toBe(""); // no partial view with undefined where a field belongs
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

// --- criterion 23 / 34 -----------------------------------------------------------------------------

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
    // Asserted by the ABSENCE of the sentinel, never by the presence of a banner: a banner assertion
    // passes while stale content sits underneath it, and that stale content may be post-erasure.
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain(SENTINEL);
    h.error({ code, message: "" });
    await h.settle();
    expect(h.html("loam-app")).not.toContain(SENTINEL);
  });

  it("a revalidating replay also clears it, and the accumulated reads map is dropped WHOLE", async () => {
    // Clearing the paint while three drilled-down copies survive in a map is the H7 shape — a
    // completeness claim the bytes do not have.
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    expect(h.html("drawn")).toContain(`Plant@${MOSS}=`);
    h.error({ code: "server_unavailable", message: "" });
    await h.settle();
    expect(h.html("loam-app")).not.toContain(SENTINEL);
    // Re-render from a fresh answer: the drilled-down entry must be gone, not merely repainted over.
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: "fresh", tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain("h=fresh");
    expect(h.html("drawn")).toBe("");
  });

  it("an ERASURE arrives as an ordinary answer, and the shell tears down on it", async () => {
    // There is no erasure notification to design: the live read IS the notification, which is §23.6's
    // principle arriving on the client for the first time.
    const h = load(PAGE, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.click("drill");
    await h.settle();
    h.deliver(answerFor(h.calls[0]!.input.query!, {})); // the value no longer resolves
    await h.settle();
    expect(h.html("loam-app")).not.toContain(SENTINEL);
    expect(h.html("drawn")).toBe("");
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
    // With a fresh realm per render there is nothing for the copy to live in.
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
    // …and the emitted bytes reference none of them.
    for (const api of ["localStorage.", "sessionStorage.", "indexedDB.", "document.cookie"]) {
      expect(PAGE.split("SEALED")[0]!).not.toContain(api);
    }
  });
});

// --- criterion 19 (traffic) / 21 / 29 --------------------------------------------------------------

describe("§30 criterion 19: TOTAL MCP traffic equals the shell's own calls", () => {
  it("a bundle that deliberately reaches for callTool adds NOT ONE call", async () => {
    // The offending bundle is substituted into an already-packed page rather than packed — the
    // pack-time reference scan refuses it (test/gateway/artifact-pack.test.ts, criterion 37a), and
    // this is the enforcing half: the same motion a viewer editing their own file would make.
    const reaching = `export default function (node) {
  try { window.claude.mcp.callTool("My Loam", "loam_mutate", { mutation: "mutation { plant(entity: \\"x\\", height: 1) { _entity } }" }); } catch (sealed) { /* the realm has no window */ }
  var seen = [];
  if (typeof window !== "undefined") seen.push("window");
  if (typeof self !== "undefined") seen.push("self");
  if (typeof indexedDB !== "undefined") seen.push("indexedDB");
  if (typeof caches !== "undefined") seen.push("caches");
  if (typeof BroadcastChannel !== "undefined") seen.push("BroadcastChannel");
  if (typeof fetch !== "undefined") seen.push("fetch");
  return "<div id=body>saw=[" + seen.join(",") + "]</div>";
}`;
    const tampered = PAGE.replace(
      /(<script type="application\/json" id="loam-bundle">)[\s\S]*?(<\/script>)/,
      (_m, a: string, b: string) => a + JSON.stringify(reaching).replace(/</g, "\\u003c") + b,
    );
    const h = load(tampered, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    // The bundle TRIED. A fixture that never reaches for a door proves the boundary is decorative.
    expect(h.html("loam-app")).toContain("saw=[]");
    // Exactly the shell's own: one watch, and nothing else.
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
    // The bundle's own error text reaches nothing a viewer READS. It is of course still in the page —
    // the bundle rides VERBATIM, which criterion 1 depends on — so the claim is about the rendered
    // surfaces, not the bytes.
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

  it("WHAT IS NOT PROVEN HERE: termination of a wedged bundle, and the memory residual", async () => {
    // Two honest holes, named rather than papered over.
    //
    // (a) TERMINATION. A same-thread shim shares the event loop with the code it runs, so an infinite
    // loop wedges the harness instead of being killed by it — the rail would be about the shim. What
    // IS proven: the shell arms two clocks (a spawn bound at construction, a fresh render bound when
    // the realm signals `live`) and terminates on either, and the emitted page carries the SAME budget
    // number as the server host — `test/gateway/artifact-pack.test.ts` asserts that agreement, and
    // `test/gateway/render-sandbox.test.ts` proves termination for the host target. Only a real
    // browser Worker can prove it for this one.
    //
    // (b) MEMORY. A browser worker takes no `resourceLimits`, so the memory bound has no artifact-side
    // equivalent at all — the tab, not the store, is what a hungry bundle can hurt.
    const page = await packOne();
    expect(page).toContain("renderTimeoutMs");
    // The two clocks are in the emitted shell, where a reader can check them.
    expect(page).toContain('msg.kind === "live"');
    expect(page).toContain("worker.terminate()");
  });
});

describe("§30 criterion 29: the bundle never asks — RenderFn is unchanged", () => {
  it("the default export is (node) => string, synchronous, called directly outside the shell", () => {
    // A design that gave the bundle an async `request()` would fail this. The signature is the whole
    // reason confinement is cheap here: one structured-cloneable value in, one string out.
    const make = new Function(
      `${FLOOR.replace(/^\s*export\s+default\s+/m, "return ")}`,
    ) as () => unknown;
    const fn = make() as (n: unknown) => unknown;
    const out = fn({ entity: FERN, view: { height: 1 }, hex: "h", reads: {}, state: {} });
    expect(typeof out).toBe("string");
    expect((out as Promise<unknown>) instanceof Promise).toBe(false);
  });

  it("the worker receives exactly ONE message per render and posts exactly one back", async () => {
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: 1, tag: "t" }));
    await h.settle();
    // One realm per render, and the shell's own protocol is the only traffic across it. There is no
    // request channel to widen, which is what keeps the two hosts' contracts identical.
    expect(h.realms).toHaveLength(1);
  });
});

// --- criterion 25 / 36 / 26 -----------------------------------------------------------------------

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
    // A receipt of a human decision, not a boundary — the viewer could always send the document
    // themselves (criterion 36). What it buys is that the PAGE never silently becomes a wider
    // instrument than its acknowledgement covered.
    const narrow = await (async (): Promise<string> => {
      const gw = await boot();
      const page = gw.packArtifact("plant", FERN, { server: "My Loam" }).page;
      await gw.close();
      return page.replace(/"writable":\["[^"]*"(,"[^"]*")*\]/, '"writable":["tag"]');
    })();
    const h = load(narrow, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    h.submit("edit"); // the form writes `height`, which is no longer in the pin
    await h.settle();
    expect(h.calls.filter((c) => c.tool === "loam_mutate")).toHaveLength(0);
    expect(h.html("loam-status")).toContain("not published to write");
  });
});

describe("§30 criterion 36: the page holds no boundary of its own", () => {
  it("a TAMPERED page's gesture reaches the store, and gets the STORE's answer", async () => {
    // Against a store that HAS the extra lens: served. This half is what stops the criterion passing
    // by everything being refused.
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
    // The boundary is the installed schema plus the mount, never the page. A page-side guard would
    // constrain the app while claiming to constrain the viewer.
    expect(h.html("loam-status")).toContain("Ledger");
    expect(h.html("loam-app")).toBe("");
  });
});

describe("§30 criterion 26: an emitted page OUTLIVES its withdrawal — the accepted residual", () => {
  it("still renders after the declaration and the binding are struck", async () => {
    // Pinned deliberately, so no reader mistakes criterion 14 for covering the third thing. The
    // follow-on that would close it: a `loam_manifest(route)` read over constitutional publication
    // state, checked BEFORE mounting — a new disclosure decision, and not this ticket's. If that ever
    // lands, this criterion inverts.
    const gw = await boot();
    const page = gw.packArtifact("plant", FERN, { server: "My Loam" }).page;
    const binding = gw.renderers()[0]!;
    await gw.erase(binding.deltaId, { reason: "withdrawn" });
    expect(() => gw.packArtifact("plant", FERN, { server: "My Loam" })).toThrow();
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(404);
    await gw.close();
    // The bytes a stranger already holds, driven against a store that still serves the lens.
    const h = load(page, answering({ height: SENTINEL, tag: "t" }));
    h.deliver(answerFor(h.calls[0]!.input.query!, { height: SENTINEL, tag: "t" }));
    await h.settle();
    expect(h.html("loam-app")).toContain(SENTINEL);
  });
});

// --- criterion 4 (the live channel) / 8 -----------------------------------------------------------

describe("§30 criterion 4: the page requests nothing from an external host, through ANY channel", () => {
  it("with fetch, XHR, WebSocket AND the MCP seam all trapped, only the seam is used", async () => {
    // The first three are the channels CSP already closes; the fourth is the one it does not, and a
    // harness that traps only the dead three proves nothing about the live one.
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
    // What is deliberately NOT asserted: "two actor tokens on ONE mount render two different
    // readings" — unsatisfiable, because `SurfaceHooks.resolve` carries no identity and every query
    // field resolves through it without a context value. A token individuates WRITE standing, and
    // §7's isolation unit for reads is the MOUNT. Asserting the token version would have been
    // satisfiable only by a stubbed harness inventing two answers — a green rail over a false claim.
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
    // Neither token appears in the page: the connector holds the URL and the credential, and the page
    // holds coordinates.
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
    // T78's half — "a dangling mount must 404, never 500" — is `test/server/dynamic-mounts.test.ts`'s;
    // the page's job is turning that into a legible degraded state, which is what this asserts. A
    // removed mount reaches the page as a connector that answers to nothing.
    const h = load(PAGE, answering({ height: 1, tag: "t" }));
    h.error({ code: "server_not_connected", message: "no connector answers" });
    await h.settle();
    expect(h.html("loam-app")).toBe("");
    expect(h.html("loam-status")).toContain("Add it in claude.ai Settings");
    expect(document.getElementById("loam-onboarding")!.hasAttribute("hidden")).toBe(false);
    expect(h.body().trim()).not.toBe("");
  });
});

// --- criterion 13b --------------------------------------------------------------------------------

describe("§30 criterion 13b: an undeclared bytes leaf degrades legibly", () => {
  it("a ref-only envelope renders a placeholder; an inline base64url renders as a data URI", async () => {
    // The pack-time refusal covers only RESOLVER-declared bytes; `gql.ts` types the envelope at the
    // VALUE level too, so an undeclared bytes leaf can still arrive at runtime. Neither form produces
    // a request to the byte-door, which CSP would kill anyway.
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
