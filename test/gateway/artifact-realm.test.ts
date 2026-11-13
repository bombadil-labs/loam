import { describe, expect, it } from "vitest";
import { SEALED_CHANNELS, realmProgram, sealRealm } from "../../src/gateway/artifact-realm.js";
import { evalPageSource } from "../site/eval-page.js";

const MUST_SEAL = [
  "indexedDB",
  "caches",
  "BroadcastChannel",
  "importScripts",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "self",
  "window",
  "document",
  "navigator",
] as const;

const fabricate = (): Record<string, unknown> => ({
  indexedDB: { open: () => "a handle that would outlive the realm" },
  caches: { open: () => "a cache that would outlive the realm" },
  BroadcastChannel: function BroadcastChannel() {},
  importScripts: () => "code the signature never attested",
  fetch: () => "a request the CSP would refuse anyway",
  XMLHttpRequest: function XMLHttpRequest() {},
  WebSocket: function WebSocket() {},
  localStorage: { setItem: () => undefined },
  sessionStorage: { setItem: () => undefined },
  self: { name: "the realm's own handle" },
  navigator: { storage: { getDirectory: () => "an OPFS handle that survives terminate()" } },
  window: { claude: { mcp: { callTool: () => undefined } } },
  document: { title: "" },
  postMessage: () => undefined,
  URL: { createObjectURL: () => "blob:x" },
  Blob: function Blob() {},
  JSON,
});

describe("§30: the realm program embedded in the page IS the function railed here", () => {
  it("carries sealRealm's own source and calls it with the sealed set", () => {
    const program = realmProgram();
    expect(program).toContain(sealRealm.toString());
    expect(program).toContain(`sealRealm(globalThis, ${JSON.stringify(SEALED_CHANNELS)})`);
    expect(program.indexOf("sealRealm(globalThis")).toBeLessThan(
      program.indexOf("import(held.url"),
    );
  });

  it("does not seal globalThis, because it cannot be — the pack-time refusal owns that one", () => {
    expect(SEALED_CHANNELS).not.toContain("globalThis");
  });

  it("the shipped list covers every channel this criterion names", () => {
    for (const name of MUST_SEAL) expect(SEALED_CHANNELS, name).toContain(name);
  });
});

describe("§30 criterion 19: the compartment holds no channel that outlives it", () => {
  it("seals every channel, and reports each one it sealed", () => {
    const scope = fabricate();
    const sealed = sealRealm(scope, SEALED_CHANNELS);
    expect([...sealed].sort()).toEqual([...SEALED_CHANNELS].sort());
    for (const name of MUST_SEAL) {
      expect(scope[name], name).toBeUndefined();
      expect(sealed, name).toContain(name);
    }
  });

  it("and a named live BYSTANDER survives — the compartment can still answer", () => {
    const scope = fabricate();
    sealRealm(scope, SEALED_CHANNELS);
    expect(typeof scope["postMessage"]).toBe("function");
    expect(typeof scope["Blob"]).toBe("function");
    expect((scope["URL"] as { createObjectURL: unknown }).createObjectURL).toBeTypeOf("function");
    expect(scope["JSON"]).toBe(JSON);
  });

  it("the sealed channel cannot be written back — a bundle cannot restore its own reach", () => {
    const scope = fabricate();
    sealRealm(scope, SEALED_CHANNELS);
    try {
      scope["indexedDB"] = { open: () => "restored" };
    } catch {}
    expect(scope["indexedDB"]).toBeUndefined();
  });

  it("a channel the realm does not carry is skipped rather than invented", () => {
    const bare: Record<string, unknown> = {};
    expect(sealRealm(bare, SEALED_CHANNELS)).toEqual([]);
    expect(Object.keys(bare)).toEqual([]);
    expect("indexedDB" in bare).toBe(false);
  });

  it("refuses nothing loudly: a NON-CONFIGURABLE channel stays, and is not reported as sealed", () => {
    const scope = fabricate();
    Object.defineProperty(scope, "self", {
      value: { name: "immovable" },
      writable: false,
      configurable: false,
    });
    const sealed = sealRealm(scope, SEALED_CHANNELS);
    expect(sealed).not.toContain("self");
    expect(scope["self"]).toEqual({ name: "immovable" });
    expect(scope["indexedDB"]).toBeUndefined();
    expect(scope["window"]).toBeUndefined();
  });

  it("is idempotent — a second seal over a sealed realm reports the same set and breaks nothing", () => {
    const scope = fabricate();
    const first = sealRealm(scope, SEALED_CHANNELS);
    const second = sealRealm(scope, SEALED_CHANNELS);
    expect(second).toEqual(first);
    expect(typeof scope["postMessage"]).toBe("function");
  });
});

describe("§30 criterion 19: what a bundle can SEE after the seal", () => {
  it("a bundle's own feature detection reports every channel absent", () => {
    const scope = fabricate();
    sealRealm(scope, SEALED_CHANNELS);
    const seen = MUST_SEAL.filter((name) => scope[name] !== undefined);
    expect(seen).toEqual([]);
    expect(scope["window"]).toBeUndefined();
    expect((scope["window"] as { claude?: unknown } | undefined)?.claude).toBeUndefined();
  });
});

describe("§30: the realm program RUNS — capture-before-seal, and every fold", () => {
  const run = (
    bundleModule: unknown,
  ): { posted: unknown[]; scope: Record<string, unknown>; deliver: () => Promise<void> } => {
    const posted: unknown[] = [];
    let handler: ((ev: unknown) => void) | undefined;
    const proto: Record<string, unknown> = {};
    for (const name of SEALED_CHANNELS) proto[name] = { real: name };
    const scope: Record<string, unknown> = Object.create(proto) as Record<string, unknown>;
    const self = {
      postMessage: (msg: unknown) => posted.push(msg),
      addEventListener: (_type: string, fn: (ev: unknown) => void) => {
        handler = fn;
      },
    };
    scope["self"] = self;
    const URLStub = { createObjectURL: () => "blob:the-bundle" };
    function BlobStub(this: unknown) {}
    const src = realmProgram().replace(
      'import(held.url(new held.Blob([data.bundle], { type: "text/javascript" })))',
      '__import(held.url(new held.Blob([data.bundle], { type: "text/javascript" })))',
    );
    const __import = (url: string): Promise<unknown> => {
      expect(url).toBe("blob:the-bundle");
      return bundleModule instanceof Error
        ? Promise.reject(bundleModule)
        : Promise.resolve(bundleModule);
    };
    scope["globalThis"] = scope;
    scope["URL"] = URLStub;
    scope["Blob"] = BlobStub;
    scope["__import"] = __import;
    evalPageSource<void>(`with (scope) { ${src} }`, ["scope"], [scope]);
    return {
      posted,
      scope,
      deliver: async () => {
        handler?.({ data: { bundle: "export default () => 1;", node: { view: {} } } });
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
      },
    };
  };

  it("posts { kind: live } at construction — the second clock's start gun", () => {
    const r = run({ default: () => "<p>ok</p>" });
    expect(r.posted).toEqual([{ kind: "live" }]);
  });

  it("seals the realm on the message, walking the PROTOTYPE where a worker keeps its channels", async () => {
    const r = run({ default: () => "<p>ok</p>" });
    await r.deliver();
    for (const name of SEALED_CHANNELS) {
      if (name === "self") continue;
      expect(r.scope[name], name).toBeUndefined();
      const holder = Object.getPrototypeOf(r.scope) as Record<string, unknown>;
      expect(holder[name], `${name} on the prototype`).toBeUndefined();
    }
  });

  it("STILL ANSWERS after the seal — capture-before-seal is what makes that true", async () => {
    const r = run({
      default: (node: { view: Record<string, unknown> }) =>
        `<p>${Object.keys(node.view).length}</p>`,
    });
    await r.deliver();
    expect(r.posted).toHaveLength(2);
    expect((r.posted[1] as { kind: string }).kind).toBe("ok");
  });

  it("folds a non-function default export to notHtml", async () => {
    const r = run({ default: 7 });
    await r.deliver();
    expect(r.posted[1]).toEqual({ kind: "notHtml" });
  });

  it("folds a non-string return to notHtml", async () => {
    const r = run({ default: () => ({ markup: 1 }) });
    await r.deliver();
    expect(r.posted[1]).toEqual({ kind: "notHtml" });
  });

  it("folds a THROWING bundle to fault, leaking nothing of its own error", async () => {
    const r = run({
      default: () => {
        throw new Error("secret internal detail");
      },
    });
    await r.deliver();
    expect(r.posted[1]).toEqual({ kind: "fault" });
    expect(JSON.stringify(r.posted)).not.toContain("secret internal detail");
  });

  it("folds an UNIMPORTABLE bundle to fault", async () => {
    const r = run(new Error("the module would not load"));
    await r.deliver();
    expect(r.posted[1]).toEqual({ kind: "fault" });
    expect(JSON.stringify(r.posted)).not.toContain("would not load");
  });
});
