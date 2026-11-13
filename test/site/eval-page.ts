import { compileFunction } from "node:vm";

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
    filename: "loam-artifact-page.js",
  }) as (...a: readonly unknown[]) => unknown;
  return compiled(...args) as T;
}

export const evalPageValue = <T>(source: string): T => evalPageSource<T>(source, [], []);
