// THE ONE DOOR THROUGH WHICH A RAIL MAY EXECUTE PAGE-EXTRACTED CODE (SPEC §30's suites).
//
// Why this file exists at all. The artifact rails have to RUN what the pack door emitted — the shell, the
// realm program, the page's own name-mangling functions — because a rail that only reads a program as
// text proves nothing about it: the shell's `legalName` drift and the realm program's capture-before-seal
// were both invisible to every `toContain` in the suite and visible the moment the code was invoked. So
// `new Function` is the instrument, not an oversight.
//
// Why it is a HELPER rather than three file-scope suppressions. A file-scope `/* eslint-disable */` turns
// the rule off for every line the file will EVER gain, including lines written by somebody who does not
// know the suppression is there — a rail that quietly stops asserting, which is the same shape as the
// bugs these suites exist to catch. `rails-guard` refuses a file-scope marker for exactly that reason and
// it is right to. Narrowing it to one named line means: there is exactly ONE suppressed line in this
// change, it says why, and any future `new Function` in these suites has to come through this door.
//
// What it deliberately does NOT do: reach outside `test/`. Nothing in `src/` evaluates a string — no
// `eval`, no `new Function` — and criterion 4 asserts that over the emitted bytes. This capability is a
// property of the harness alone.

/**
 * Compile a fragment of page-extracted source into a callable, with named parameters bound at the call.
 *
 * `params` are the identifiers the source may reference; `args` are their values, in the same order. The
 * body is whatever was recovered from the page — a function declaration plus a `return`, a `with (scope)`
 * wrapper, or the shell's whole script.
 *
 * ASSERTS THE EXTRACTION FIRST, which is the other half of what this door is for: an empty or whitespace
 * body means the regex that pulled it out of the page matched nothing, and `new Function("")` would
 * cheerfully return a function that does nothing at all — a green rail over a failed extraction. That is
 * the failure mode a helper can catch once for every caller.
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
  // The ONE narrow suppression in this change. Executing page-extracted source is this module's entire
  // purpose; every other line in every artifact suite stays linted.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the rails must RUN the emitted page, not paraphrase it; see this file's header
  const compiled = new Function(...params, source) as (...a: readonly unknown[]) => unknown;
  return compiled(...args) as T;
}

/**
 * The common case: source that ends in a `return`, compiled and invoked with no parameters, yielding the
 * value it returns. Used for the page's own mangling functions and for a bundle's default export.
 */
export const evalPageValue = <T>(source: string): T => evalPageSource<T>(source, [], []);
