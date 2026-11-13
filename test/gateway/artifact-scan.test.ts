import { describe, expect, it } from "vitest";
import { HOST_GLOBALS, scanHostReferences } from "../../src/gateway/artifact-scan.js";

const MUST_REFUSE: Readonly<Record<string, readonly string[]>> = {
  browser: [
    "window",
    "document",
    "claude",
    "localStorage",
    "sessionStorage",
    "navigator",
    "location",
  ],
  node: ["require", "Buffer", "process", "module", "__dirname", "__filename"],
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
    expect(
      scanHostReferences(`export default function (node) {
  var process = { env: {} };
  function fetch(x) { return x; }
  return "<p>" + process.env.X + fetch(node.view.h) + "</p>";
}`),
    ).toEqual([]);
  });

  it("the OPERAND of `typeof` — feature detection reaches nothing", () => {
    expect(
      scanHostReferences(
        'export default (n) => typeof window !== "undefined" ? "a" : "<p>" + n.view.h + "</p>";',
      ),
    ).toEqual([]);
  });

  it("a reference inside the arm of a guard that cannot run in a realm lacking the name", () => {
    expect(
      scanHostReferences(`export default function (node) {
  if (typeof document !== "undefined") { document.title = "x"; }
  return "<p>" + node.view.h + "</p>";
}`),
    ).toEqual([]);
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
