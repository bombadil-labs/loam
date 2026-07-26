// The bundle-reference scan, driven DIRECTLY — no door, no publication surface, nothing wired to it yet.
//
// WHAT IT IS FOR. A renderer bundle is `(node) => string`: a pure function of its argument, which needs no
// host global at all. So a bundle that REFERENCES one is either written for a single host, or reaching for
// a channel that outlives the realm it will run in, and both are decidable from source alone. This module
// answers only that question; who asks it, and what they do with the answer, is a later change.
//
// IT SCANS REFERENCES, NOT SUBSTRINGS, and that is the whole engineering. A substring scan refuses the
// bundles §23.2 names as the target shape — a React renderer's output routinely carries
// `process.env.NODE_ENV`, a `globalThis` polyfill, and `typeof document !== "undefined"` guards — and it
// also refuses `processNote`, `documentTitle`, and any of these tokens inside a comment or a string. A
// door that refuses nearly every real bundle is not a cheap guard; it is broken, and a rail that measures
// only true positives stays green while it happens.
//
// SAID HONESTLY IN THE OTHER DIRECTION: even a reference scan is defeated by construction
// (`globalThis["win" + "dow"]`), so this is the CHEAP half of a boundary and never the enforcing one. It
// proves what is decidable; something else has to confine what is not.
//
// WHAT IS DELIBERATELY NOT ASSERTED HERE: any consequence of a reference being found. Refusal, reporting,
// and who is allowed to override are a door's business.

import { describe, expect, it } from "vitest";
import { HOST_GLOBALS, scanHostReferences } from "../../src/gateway/artifact-scan.js";

// EVERY name the refusal set owes, written out here rather than read from `HOST_GLOBALS`. Deriving the
// expectation from the table under test is the failure this list exists to prevent: a rail that iterates
// the shipped set is satisfied by a set narrowed to one entry, so deleting a name would leave the suite
// green while a bundle reaching it scanned clean.
const MUST_REFUSE: Readonly<Record<string, readonly string[]>> = {
  // Browser reach — a page realm a confined renderer does not run in, plus a runtime's own affordances.
  browser: [
    "window",
    "document",
    "claude",
    "localStorage",
    "sessionStorage",
    "navigator",
    "location",
  ],
  // Node reach — a server host's realm, not a browser's. A bundle using these works where it was tested.
  node: ["require", "Buffer", "process", "module", "__dirname", "__filename"],
  // Worker-realm reach that SURVIVES a teardown, plus the doors to it. A worker global scope has no
  // `window` and no `localStorage`, which is what makes such a realm look sufficient at a glance; it does
  // have these, as bare identifiers, so discarding the realm does not discard what they hold.
  worker: [
    "indexedDB",
    "caches",
    "BroadcastChannel",
    "importScripts",
    "self",
    "globalThis",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
  ],
  // Code that is not the code that was signed. A bundle which evaluates a string it built has a
  // signed-vs-executed gap of its own making — the exact property a content-addressed attestation
  // exists to close. NOT one of the three families above: a widening, named out loud.
  eval: ["eval", "Function"],
};

describe("the refusal set covers every name it owes", () => {
  it("the shipped table names each one, in its own family", () => {
    for (const [family, names] of Object.entries(MUST_REFUSE)) {
      for (const name of names) {
        expect(HOST_GLOBALS[family], `${family}/${name}`).toContain(name);
      }
    }
  });

  it("and the scan reports each one, by name and family, from a bare reference", () => {
    for (const [family, names] of Object.entries(MUST_REFUSE)) {
      for (const name of names) {
        const found = scanHostReferences(
          `export default function (node) { var held = ${name}; return "<p>" + node.view.h + "</p>"; }`,
        );
        expect(
          found.map((r) => r.name),
          name,
        ).toContain(name);
        expect(found.find((r) => r.name === name)?.family, name).toBe(family);
      }
    }
  });

  it("a conforming pure RenderFn reaches NOTHING — the two-sided half", () => {
    // Without this, a scan that reported every identifier would satisfy the loop above.
    expect(scanHostReferences('export default (node) => "<p>" + node.view.h + "</p>";')).toEqual(
      [],
    );
  });
});

describe("the two SYNTAX forms no identifier rule covers", () => {
  it("a dynamic import is reported, because it fetches code the signature never attested", () => {
    const found = scanHostReferences('export default (n) => { import("./x.js"); return "a"; };');
    expect(found.map((r) => r.name)).toContain("import(");
  });

  it("a `node:` specifier is reported from a real import, and NOT from a comment", () => {
    // The specifier is tested against string LITERALS, which is where a real one lives — so prose
    // mentioning one is not a reach. Fail-closed on anything it does see.
    expect(
      scanHostReferences('import { readFileSync } from "node:fs";\nexport default (n) => "a";').map(
        (r) => r.name,
      ),
    ).toContain("node:");
    expect(scanHostReferences('// see node:fs for the shape\nexport default (n) => "a";')).toEqual(
      [],
    );
  });
});

describe("what is NOT a reference", () => {
  it("a token inside a comment or a string", () => {
    expect(
      scanHostReferences(`// this renderer does not touch window or document
export default (n) => "<p>" + "process".length + n.view.h + "</p>";`),
    ).toEqual([]);
  });

  it("a member name, and an object-literal key", () => {
    expect(
      scanHostReferences(`export default function (node) {
  var box = { window: 1, document: 2, fetch: 3 };
  return "<p>" + box.window + box.document + node.own.process + "</p>";
}`),
    ).toEqual([]);
  });

  it("a LOCALLY BOUND name, which shadows the global for the whole unit", () => {
    // Coarser than real scope analysis and deliberately so: it errs toward reporting nothing, which is
    // the direction an enforcing boundary covers. Refusing code that touches nothing is the worse error.
    expect(
      scanHostReferences(`export default function (node) {
  var process = { env: {} };
  function fetch(x) { return x; }
  return "<p>" + process.env.X + fetch(node.view.h) + "</p>";
}`),
    ).toEqual([]);
  });

  it("the OPERAND of `typeof` — feature detection reaches nothing", () => {
    // Load-bearing twice: it is how a bundler guards a browser-only path, and it is the only way a
    // conforming bundle can ASK what it can see without being reported for asking.
    expect(
      scanHostReferences(
        'export default (n) => typeof window !== "undefined" ? "a" : "<p>" + n.view.h + "</p>";',
      ),
    ).toEqual([]);
  });

  it("a reference inside the arm of a guard that cannot run in a realm lacking the name", () => {
    // `typeof X !== "undefined"` gates code that requires X to exist. In a realm where X is absent that
    // arm is dead, and this is precisely the shape a bundler emits.
    expect(
      scanHostReferences(`export default function (node) {
  if (typeof document !== "undefined") { document.title = "x"; }
  return "<p>" + node.view.h + "</p>";
}`),
    ).toEqual([]);
    // …and the mirrored form, where the ELSE arm is the dead one.
    expect(
      scanHostReferences(`export default function (node) {
  if (typeof indexedDB === "undefined") { return "<p>" + node.view.h + "</p>"; }
  else { indexedDB.open("keep"); }
  return "-";
}`),
    ).toEqual([]);
  });
});

describe("real bundler output PACKS — the half that makes the rail honest", () => {
  // A criterion measuring only true positives stays green while the door refuses nearly every real
  // bundle. This fixture is the shape §23.2 names as the target — "a React renderer bundles its own
  // React and returns renderToString(...)" — carrying every pattern such output routinely has: a
  // `globalThis` polyfill behind a typeof check, a `process.env.NODE_ENV` guard, a `typeof document`
  // branch, and the identifiers `processNote` / `documentTitle` that a substring scan refuses outright.
  //
  // ITS PROVENANCE IS WEAKER THAN IDEAL and T97 records that: this is hand-authored to carry the
  // patterns, not the output of a real `esbuild` run over a real React, which is not a dependency here.
  // The shape is right; what is unproven is that a real bundler emits nothing this fixture missed.
  const BUNDLED_REACT = `var __globalThis = typeof globalThis !== "undefined" ? globalThis : {};
var __dev = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
function processNote(text) { return "<em>" + text + "</em>"; }
function documentTitle(node) { return "plant " + node.entity; }
function h(tag, children) { return "<" + tag + ">" + children + "</" + tag + ">"; }
function renderToString(el) { return el; }
if (typeof document !== "undefined") { document.title = documentTitle({ entity: "boot" }); }
export default function (node) {
  return renderToString(h("section",
    h("h2", documentTitle(node)) + processNote("height " + node.view.height)));
}`;

  it("scans clean", () => {
    expect(scanHostReferences(BUNDLED_REACT)).toEqual([]);
  });

  it("and the identifiers a substring scan would have caught are really in it", () => {
    // So the rail above cannot pass by the fixture having quietly lost its hazards.
    for (const token of [
      "globalThis",
      "process.env.NODE_ENV",
      "processNote",
      "documentTitle",
      'typeof document !== "undefined"',
    ]) {
      expect(BUNDLED_REACT, token).toContain(token);
    }
  });
});

describe("the lexer survives what real source contains", () => {
  it("a regex literal is not read as code, and a division is not read as a regex", () => {
    // Getting this wrong swallows real code as a regex body or reads a regex body as code, and either
    // way every answer after it is meaningless.
    expect(
      scanHostReferences('export default (n) => /window|fetch/.test(n.view.h) ? "a" : "b";'),
    ).toEqual([]);
    expect(
      scanHostReferences("export default (n) => (n.view.a / n.view.b) + (n.view.c / 2) + '';"),
    ).toEqual([]);
  });

  it("a template literal's INTERPOLATION is code, and its text is not", () => {
    const held = scanHostReferences(
      "export default (n) => `held ${indexedDB.name} for ${n.view.h}`;",
    );
    expect(held.map((r) => r.name)).toContain("indexedDB");
    expect(
      scanHostReferences("export default (n) => `the word window is not a reach ${n.view.h}`;"),
    ).toEqual([]);
  });

  it("reports each name ONCE, in source order, however many times it appears", () => {
    const found = scanHostReferences(`export default function (node) {
  indexedDB.open("a"); caches.open("b"); indexedDB.open("c");
  return "-";
}`);
    expect(found.map((r) => r.name)).toEqual(["indexedDB", "caches"]);
  });

  it("does not throw on source it cannot fully lex — a crash would be a door that refuses everything", () => {
    for (const odd of ["export default (n) => 'unterminated", "\u0000\u0001", "/*", "`"]) {
      expect(() => scanHostReferences(odd), JSON.stringify(odd)).not.toThrow();
    }
  });
});
