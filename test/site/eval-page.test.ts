// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { evalPageSource, evalPageValue } from "./eval-page.js";

describe("the eval door refuses a bad extraction", () => {
  it("refuses an EMPTY body rather than compiling a silent no-op", () => {
    expect(() => evalPageValue("")).toThrow(/the extracted source is empty/);
    expect(() => evalPageValue("   \n\t ")).toThrow(/the extracted source is empty/);
  });

  it("refuses a parameter/argument mismatch, which would bind undefined silently", () => {
    expect(() => evalPageSource("return a;", ["a", "b"], [1])).toThrow(/parameter/);
    expect(() => evalPageSource("return a;", [], [1])).toThrow(/parameter/);
  });

  it("…and compiles and runs a real extraction — the two-sided half", () => {
    expect(evalPageValue<number>("return 6 * 7;")).toBe(42);
    expect(evalPageSource<number>("return a + b;", ["a", "b"], [40, 2])).toBe(42);
  });

  it("binds parameters POSITIONALLY, by the names given", () => {
    expect(evalPageSource<string>("return String(scope.tag);", ["scope"], [{ tag: "held" }])).toBe(
      "held",
    );
  });

  it("compiles in THIS context, so a free identifier resolves against the harness's globals", () => {
    (globalThis as unknown as { __loamProbe?: string }).__loamProbe = "reached";
    try {
      expect(evalPageValue<string>("return __loamProbe;")).toBe("reached");
    } finally {
      delete (globalThis as unknown as { __loamProbe?: string }).__loamProbe;
    }
  });

  it("names a filename a stack trace can carry, rather than an anonymous frame", () => {
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
  it("has a document, and an element round-trips through it", () => {
    expect(typeof document).toBe("object");
    document.body.innerHTML = '<div id="probe">held</div>';
    expect(document.getElementById("probe")?.textContent).toBe("held");
  });

  it("and `window` IS `globalThis`, which the DOM harnesses rely on", () => {
    expect(window as unknown).toBe(globalThis);
  });
});
