// SPEC §30 — the confined realm, railed AS A PROGRAM.
//
// WHAT THIS PROVES. `sealRealm` is the second half of the compartment: the per-render realm handles what
// `terminate()` can reach, and this handles what it cannot. A Worker global scope has no `window` and no
// `localStorage`, which is what makes the realm look sufficient at a glance — but `indexedDB`, `caches`,
// and `BroadcastChannel` are bare identifiers there, so a bundle calling `indexedDB.open("keep")` holds a
// copy across every render and every teardown, in a store §11 cannot reach and the shell cannot
// enumerate. That is the one memory §11 was invoked to reach, so it is sealed here and refused at pack
// time (`test/gateway/artifact-pack.test.ts`) — both, not either.
//
// WHAT THIS DOES *NOT* PROVE, stated plainly because the gap is the interesting part. It does not prove
// that a REAL browser Worker's global scope carries exactly the channels fabricated below. The list is
// read off the WHATWG worker surface and from the spec's own account of it; if a runtime carries a
// thirteenth channel that outlives a realm, nothing here notices. Nor does it prove a real Worker's
// `self` or `globalThis` is configurable — the seal is written to survive that (a refusal is caught and
// the channel simply stays), and `globalThis` is deliberately NOT in the sealed set because it cannot be
// removed at all. What would close the first gap is running the emitted page in a real browser under the
// artifact CSP; that is beyond this suite and is named in the PR as unproven.
//
// WHY THIS UNIT AND NOT A SHIMMED WORKER. A shim would prove the shim. The realm program is embedded in
// the page as `sealRealm.toString()`, so the function exercised here is byte-for-byte the function that
// runs in the worker — asserted below, because a serialization that drifted from its source would make
// every assertion in this file about the wrong code.
//
// TWO-SIDED, the same discipline an erasure rail runs: the target is gone AND a named live bystander
// survives. A seal that took `postMessage`, `URL`, or `Blob` with it would leave a compartment that
// cannot answer, and "the bundle rendered nothing" reads identically to "the bundle was confined".

import { describe, expect, it } from "vitest";
import { SEALED_CHANNELS, realmProgram, sealRealm } from "../../src/gateway/artifact-page.js";

// The channels this criterion NAMES, written out here rather than read from `SEALED_CHANNELS`. Deriving
// the expectation from the list under test makes the rail self-referential: narrowing the shipped list to
// one entry would still satisfy "everything in the list is sealed". These are the twelve the design owes,
// and the list must contain every one of them.
const MUST_SEAL = [
  // the three the design was written for: they survive `terminate()` and §11 cannot reach them
  "indexedDB",
  "caches",
  "BroadcastChannel",
  // code the signature never attested
  "importScripts",
  // the doors to all of the above, and to a host the CSP already blocks
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  // storage a worker realm does not have today, sealed anyway: a runtime that grows one must not
  // silently become a place a copy can live
  "localStorage",
  "sessionStorage",
  // the realm's own handles, through which everything else is reachable
  "self",
  "window",
  "document",
] as const;

// A fabricated worker global. Every channel the seal is meant to reach, plus the three the realm program
// legitimately needs and one ordinary global a bundle may use, so over-sealing is visible.
const fabricate = (): Record<string, unknown> => ({
  // the sealed set, as bare identifiers a worker realm really does carry
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
  window: { claude: { mcp: { callTool: () => undefined } } },
  document: { title: "" },
  // the BYSTANDERS: what the realm program itself holds, and one ordinary global
  postMessage: () => undefined,
  URL: { createObjectURL: () => "blob:x" },
  Blob: function Blob() {},
  JSON,
});

describe("§30: the realm program embedded in the page IS the function railed here", () => {
  it("carries sealRealm's own source and calls it with the sealed set", () => {
    // If this drifts, every other assertion in this file is about code the page does not run.
    const program = realmProgram();
    expect(program).toContain(sealRealm.toString());
    expect(program).toContain(`sealRealm(globalThis, ${JSON.stringify(SEALED_CHANNELS)})`);
    // The seal runs BEFORE the bundle is imported — a seal after the import would let module-level
    // code in the bundle grab a reference first, and a surviving reference beats any later filter.
    expect(program.indexOf("sealRealm(globalThis")).toBeLessThan(
      program.indexOf("import(held.url"),
    );
  });

  it("does not seal globalThis, because it cannot be — the pack-time refusal owns that one", () => {
    expect(SEALED_CHANNELS).not.toContain("globalThis");
  });

  it("the shipped list covers every channel this criterion names", () => {
    // The rail that stops the one below from being self-referential: narrowing the shipped set would
    // pass "everything in the set is sealed" and fail here.
    for (const name of MUST_SEAL) expect(SEALED_CHANNELS, name).toContain(name);
  });
});

describe("§30 criterion 19: the compartment holds no channel that outlives it", () => {
  it("seals every channel, and reports each one it sealed", () => {
    const scope = fabricate();
    const sealed = sealRealm(scope, SEALED_CHANNELS);
    // Positive report first: a seal that silently sealed nothing is a guard that has stopped guarding,
    // and "everything is undefined" is indistinguishable from "the list was empty".
    expect([...sealed].sort()).toEqual([...SEALED_CHANNELS].sort());
    // Then the NAMED set, so the expectation does not come from the thing being measured.
    for (const name of MUST_SEAL) {
      expect(scope[name], name).toBeUndefined();
      expect(sealed, name).toContain(name);
    }
  });

  it("and a named live BYSTANDER survives — the compartment can still answer", () => {
    // The over-sealing side. Without these the realm cannot post its result, cannot build the module
    // URL the bundle rides in on, and renders nothing — which reads exactly like confinement working.
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
    // A writable `undefined` would be a speed bump: `indexedDB = realIndexedDB` and the copy lives
    // again. The seal is non-writable, so an assignment is a no-op (or a TypeError under strict mode).
    try {
      scope["indexedDB"] = { open: () => "restored" };
    } catch {
      /* strict-mode assignment to a non-writable property throws — either outcome is a seal */
    }
    expect(scope["indexedDB"]).toBeUndefined();
  });

  it("a channel the realm does not carry is skipped rather than invented", () => {
    // An empty scope must not gain twelve `undefined` properties: `"indexedDB" in scope` is how a
    // bundle feature-detects, and manufacturing the key would make an absent channel look present.
    const bare: Record<string, unknown> = {};
    expect(sealRealm(bare, SEALED_CHANNELS)).toEqual([]);
    expect(Object.keys(bare)).toEqual([]);
    expect("indexedDB" in bare).toBe(false);
  });

  it("refuses nothing loudly: a NON-CONFIGURABLE channel stays, and is not reported as sealed", () => {
    // The honest failure mode. If a runtime makes `self` non-configurable, the seal cannot take it —
    // so it must not CLAIM to have. Reporting a seal it did not achieve is H7 at this layer.
    const scope = fabricate();
    Object.defineProperty(scope, "self", {
      value: { name: "immovable" },
      writable: false,
      configurable: false,
    });
    const sealed = sealRealm(scope, SEALED_CHANNELS);
    expect(sealed).not.toContain("self");
    expect(scope["self"]).toEqual({ name: "immovable" });
    // …and every other channel is still sealed: one immovable global does not abort the seal.
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
    // The positive form the criterion asks for, run against the fabricated realm. A fixture bundle
    // reports what it can reach; `typeof` is how it must ask, and the pack-time scan suppresses a
    // `typeof` operand precisely so a bundle CAN ask without being refused for reaching.
    const scope = fabricate();
    sealRealm(scope, SEALED_CHANNELS);
    const seen = MUST_SEAL.filter((name) => scope[name] !== undefined);
    expect(seen).toEqual([]);
    // And the one that matters most, spelled out rather than inferred from the loop: there is no
    // handle to the viewer's MCP capability anywhere in this realm.
    expect(scope["window"]).toBeUndefined();
    expect((scope["window"] as { claude?: unknown } | undefined)?.claude).toBeUndefined();
  });
});
