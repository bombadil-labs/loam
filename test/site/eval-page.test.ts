// @vitest-environment happy-dom
//
// The eval door's own rails, and the `happy-dom` environment's smoke test — the two halves of the test
// INFRASTRUCTURE that the artifact suites will stand on, landed before anything depends on them.
//
// WHY THE DOOR EXISTS. Some rails must RUN code recovered from a generated artifact rather than read it
// as text: a rail that only greps a program proves nothing about what the program DOES, which is how a
// name-mangling drift and a capture-ordering bug can both sit inside a green suite. `eval-page.ts` is
// the single place that capability lives.
//
// WHY IT USES `vm.compileFunction`. Compiling a string is the point, so the question is which instrument
// leaves the least residue. The Function constructor trips `no-implied-eval`, and every way of quieting
// that rule is a lint-suppression marker — which `rails-guard` refuses inside a rail file, correctly: a
// marker turns a rule off for lines the file will gain LATER, written by somebody who does not know it
// is there, so the rail quietly stops asserting. `node:vm`'s compiler is the same capability with no
// marker to leave behind.
//
// WHY THE ENVIRONMENT IS PER-FILE. The docblock above puts THIS file in a DOM and leaves
// `vitest.config.mjs` alone. Putting a hundred existing suites in a DOM is a change no ticket asked for,
// and it would silently alter what every other rail runs against.

import { describe, expect, it } from "vitest";
import { evalPageSource, evalPageValue } from "./eval-page.js";

describe("the eval door refuses a bad extraction", () => {
  // These guards are the last thing standing between a regex that stopped matching and a green rail
  // over a failed extraction: compiling an empty body yields a function that cheerfully does nothing,
  // so every comparison downstream would pass vacuously.
  it("refuses an EMPTY body rather than compiling a silent no-op", () => {
    expect(() => evalPageValue("")).toThrow(/the extracted source is empty/);
    expect(() => evalPageValue("   \n\t ")).toThrow(/the extracted source is empty/);
  });

  it("refuses a parameter/argument mismatch, which would bind undefined silently", () => {
    expect(() => evalPageSource("return a;", ["a", "b"], [1])).toThrow(/parameter/);
    expect(() => evalPageSource("return a;", [], [1])).toThrow(/parameter/);
  });

  it("…and compiles and runs a real extraction — the two-sided half", () => {
    // Without this, a door that threw on everything would satisfy the two refusals above.
    expect(evalPageValue<number>("return 6 * 7;")).toBe(42);
    expect(evalPageSource<number>("return a + b;", ["a", "b"], [40, 2])).toBe(42);
  });

  it("binds parameters POSITIONALLY, by the names given", () => {
    // The property a caller depends on when it hands a fabricated scope in: the name in the source
    // resolves to the argument in the same position, and nothing else leaks in under that name.
    expect(evalPageSource<string>("return String(scope.tag);", ["scope"], [{ tag: "held" }])).toBe(
      "held",
    );
  });

  it("compiles in THIS context, so a free identifier resolves against the harness's globals", () => {
    // The behaviour the DOM suites depend on: a recovered page script's free names must find the
    // harness's own fabricated globals (its stubbed capability object, its traps, its shims). A
    // compiler that used a fresh context would silently give every one of them `undefined`.
    (globalThis as unknown as { __loamProbe?: string }).__loamProbe = "reached";
    try {
      expect(evalPageValue<string>("return __loamProbe;")).toBe("reached");
    } finally {
      delete (globalThis as unknown as { __loamProbe?: string }).__loamProbe;
    }
  });

  it("names a filename a stack trace can carry, rather than an anonymous frame", () => {
    // A syntax error in a generated page should point somewhere. Asserted through the thrown error so
    // the option cannot be dropped without this going red.
    let message = "";
    try {
      evalPageValue("return (;");
    } catch (err) {
      message = err instanceof Error ? `${err.stack ?? ""}${err.message}` : String(err);
    }
    expect(message).toContain("loam-artifact-page.js");
  });
});

describe("the per-file happy-dom environment is actually a DOM", () => {
  // A docblock typo (`@vitest-environment happydom`) is silently ignored and the file runs in Node,
  // where every DOM rail would fail confusingly rather than at the cause. This is the one assertion
  // that names the cause.
  it("has a document, and an element round-trips through it", () => {
    expect(typeof document).toBe("object");
    document.body.innerHTML = '<div id="probe">held</div>';
    expect(document.getElementById("probe")?.textContent).toBe("held");
  });

  it("and `window` IS `globalThis`, which the DOM harnesses rely on", () => {
    // happy-dom aliases them, so one `defineProperty` covers both `window.x` and a bare `x`. A future
    // environment that separated them would break every capability stub in the artifact suites.
    expect(window as unknown).toBe(globalThis);
  });
});
