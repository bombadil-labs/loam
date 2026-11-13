import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findComments, strip, tokenStream } from "../../scripts/strip-comments.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/strip-comments.mjs");

const stripped = (source: string, file = "fixture.ts"): string => strip(source, file).text;

describe("strip-comments removes comments and nothing else", () => {
  it("keeps `//` and `/* */` inside strings, templates and regex literals", () => {
    const source = [
      `const a = "// not a comment" + '/* nor this */';`,
      "const b = `// in a template ${a /* gone */} /* still text */`;",
      "const c = /\\/\\/ x \\/\\* y \\*\\//g;",
      `const d = "http://example.test/*";`,
      "",
    ].join("\n");
    const out = stripped(source);
    expect(out).toContain(`"// not a comment"`);
    expect(out).toContain(`'/* nor this */'`);
    expect(out).toContain("`// in a template ${a} /* still text */`");
    expect(out).toContain("/\\/\\/ x \\/\\* y \\*\\//g");
    expect(out).toContain(`"http://example.test/*"`);
    expect(out).not.toContain("gone");
  });

  it("removes a JSDoc block, a file header and a trailing line comment", () => {
    const source = [
      "// a file header",
      "// over two lines",
      "",
      "/**",
      " * Documents the export.",
      " * @param x the input",
      " */",
      "export function f(x: number): number {",
      "  return x + 1; // a trailing remark",
      "}",
      "",
    ].join("\n");
    expect(stripped(source)).toBe(
      ["export function f(x: number): number {", "  return x + 1;", "}", ""].join("\n"),
    );
  });

  it("leaves no blank line at the edge of a block and no double blank line", () => {
    const source = [
      "function g() {",
      "",
      "  // only a comment",
      "",
      "  const a = 1;",
      "",
      "  // a separator",
      "",
      "  return a;",
      "",
      "  // a closing note",
      "}",
      "",
    ].join("\n");
    expect(stripped(source)).toBe(
      ["function g() {", "  const a = 1;", "", "  return a;", "}", ""].join("\n"),
    );
  });

  it("never fuses two tokens where an inline comment stood between them", () => {
    const out = stripped("const n = a/**/+/**/+1;\nconst m = typeof/**/a;\n");
    expect(out).toBe("const n = a+ +1;\nconst m = typeof a;\n");
  });

  it("keeps every tool directive and drops only its explanation", () => {
    const source = [
      "#!/usr/bin/env node",
      '/// <reference types="node" />',
      "// @vitest-environment happy-dom",
      "/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing:",
      "   it keeps the contract */",
      "// eslint-disable-next-line no-console, no-undef -- a reason",
      "console.log(1);",
      "/* eslint-enable no-console */",
      "// @ts-expect-error a reason the error is expected",
      "const e: string = 1;",
      "// @ts-ignore",
      "const i: string = 2;",
      "// prettier-ignore",
      "const p = [1,2];",
      "/* c8 ignore next */",
      "/* v8 ignore next 2 */",
      "/* istanbul ignore else */",
      "const pure = /* #__PURE__ */ make();",
      "const pure2 = /*@__PURE__*/ make();",
      "",
    ].join("\n");
    const result = strip(source, "fixture.ts");
    expect(result.kept).toBe(13);
    expect(result.text).toBe(
      [
        "#!/usr/bin/env node",
        '/// <reference types="node" />',
        "// @vitest-environment happy-dom",
        "/* eslint-disable @typescript-eslint/require-await */",
        "// eslint-disable-next-line no-console, no-undef",
        "console.log(1);",
        "/* eslint-enable no-console */",
        "// @ts-expect-error",
        "const e: string = 1;",
        "// @ts-ignore",
        "const i: string = 2;",
        "// prettier-ignore",
        "const p = [1,2];",
        "/* c8 ignore next */",
        "/* v8 ignore next 2 */",
        "/* istanbul ignore else */",
        "const pure = /* #__PURE__ */ make();",
        "const pure2 = /*@__PURE__*/ make();",
        "",
      ].join("\n"),
    );
  });

  it("does not mistake prose that MENTIONS a directive for the directive", () => {
    const source =
      "// The `// @vitest-environment happy-dom` line above sets the DOM.\nconst x = 1;\n";
    expect(stripped(source)).toBe("const x = 1;\n");
  });

  it("finds every comment in a JavaScript file and leaves the token stream unchanged", () => {
    const source =
      "/** @type {number} */\nexport const n = 1; // one\n/* two */ export const m = 2;\n";
    expect(findComments(source, "fixture.mjs")).toHaveLength(3);
    const out = stripped(source, "fixture.mjs");
    expect(out).toBe("export const n = 1;\nexport const m = 2;\n");
    expect(tokenStream(out, "fixture.mjs")).toEqual(tokenStream(source, "fixture.mjs"));
  });

  it("changes nothing in a file that carries no comments", () => {
    const source = "export const s = `/* ${1} */`;\n";
    const result = strip(source, "fixture.ts");
    expect(result.removed).toHaveLength(0);
    expect(result.text).toBe(source);
  });
});

describe("strip-comments --check", () => {
  const repo = mkdtempSync(join(tmpdir(), "loam-strip-comments-"));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });

  it("exits 2 and names file:line for a comment, then passes once the file is stripped", () => {
    const file = join(repo, "a.ts");
    writeFileSync(file, 'export const a = "//";\n\n// a remark\nexport const b = 2;\n');
    writeFileSync(
      join(repo, "clean.ts"),
      "// eslint-disable-next-line no-console\nconsole.log(1);\n",
    );

    const red = run("--check", ".");
    expect(red.status, red.stderr).toBe(2);
    expect(red.stderr).toContain("a.ts:3");
    expect(red.stderr).not.toContain("clean.ts");

    const write = run(".");
    expect(write.status, write.stderr).toBe(0);
    expect(readFileSync(file, "utf8")).toBe('export const a = "//";\n\nexport const b = 2;\n');

    const green = run("--check", ".");
    expect(green.status, green.stderr).toBe(0);
    expect(green.stdout).toContain("1 tool directives kept");
  });
});
