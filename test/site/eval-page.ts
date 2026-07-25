// THE ONE DOOR THROUGH WHICH A RAIL MAY EXECUTE PAGE-EXTRACTED CODE (SPEC §30's suites).
//
// Why this file exists. The artifact rails have to RUN what the pack door emitted — the shell, the realm
// program, the page's own name-mangling functions — because a rail that only reads a program as text
// proves nothing about it: the shell's `legalName` drift and the realm program's capture-before-seal were
// both invisible to every `toContain` in the suite and visible the moment the code was invoked.
//
// Why it uses `vm.compileFunction` and NOT the Function constructor. Compiling a string is the whole
// point here, so the honest question is which instrument leaves the least residue. The Function
// constructor trips `no-implied-eval`, and every way of quieting that rule is a lint-suppression marker
// — which `rails-guard` refuses inside a rail file, correctly: a marker turns a rule off for lines the
// file will gain later, written by somebody who does not know it is there, so the rail quietly stops
// asserting. `node:vm`'s own compiler is the same capability with no marker to leave behind, and it is
// a better fit besides: parameters are named explicitly rather than positionally spliced into a body,
// and a syntax error names this file instead of an anonymous eval frame.
//
// It compiles in THIS context, exactly as the Function constructor would, so a page script's free
// identifiers resolve against the harness's own globals — which is what the shell suites depend on
// (their fabricated `window.claude`, their storage traps, their `Worker` shim).
//
// What it deliberately does NOT do: reach outside `test/`. Nothing in `src/` compiles a string — no
// eval, no Function constructor, no `node:vm` — and criterion 4 asserts that over the emitted bytes.
// This capability is a property of the harness alone.

import { compileFunction } from "node:vm";

/**
 * Compile a fragment of page-extracted source into a callable, with named parameters bound at the call.
 *
 * `params` are the identifiers the source may reference; `args` are their values, in the same order. The
 * body is whatever was recovered from the page — a function declaration plus a `return`, a `with (scope)`
 * wrapper, or the shell's whole script.
 *
 * ASSERTS THE EXTRACTION FIRST, which is the other half of what this door is for: an empty or
 * whitespace-only body means the regex that pulled it out of the page matched nothing, and compiling it
 * yields a function that cheerfully does nothing at all — a green rail over a failed extraction. That is
 * the failure mode a single door can catch once for every caller.
 */
export function evalPageSource<T>(
  source: string,
  params: readonly string[],
  args: readonly unknown[],
): T {
  if (source.trim() === "") {
    throw new Error(
      "evalPageSource: the extracted source is empty — the page did not carry what the rail " +
        "expected, and an empty body would compile to a function that silently does nothing",
    );
  }
  if (params.length !== args.length) {
    throw new Error(
      `evalPageSource: ${params.length} parameter name(s) but ${args.length} argument(s)`,
    );
  }
  const compiled = compileFunction(source, [...params], {
    // A filename a stack trace can name, so a syntax error in an emitted page points here rather than
    // at an anonymous frame.
    filename: "loam-artifact-page.js",
  }) as (...a: readonly unknown[]) => unknown;
  return compiled(...args) as T;
}

/**
 * The common case: source that ends in a `return`, compiled and invoked with no parameters, yielding the
 * value it returns. Used for the page's own mangling functions and for a bundle's default export.
 */
export const evalPageValue = <T>(source: string): T => evalPageSource<T>(source, [], []);
