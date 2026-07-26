// The shipped SITE artifact, pinned (SPEC §16): `scripts/build-site.mjs` produces a
// self-contained page — the app bundle carries the whole store (same-commit source, aliased
// in the build, so version skew is impossible), and everything the page fetches at runtime
// (packets, styles) is in the output directory. The full lesson arc's behavior is pinned by
// arc.test.ts; this suite pins only that the ARTIFACT holds together.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 }); // esbuild inlines a whole store

const OUT = join(process.cwd(), "site-dist");

beforeAll(() => {
  execFileSync(process.execPath, [join("scripts", "build-site.mjs")], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});

describe("the tutorial site build", () => {
  it("emits the whole page: html, css, app bundle, and both packets", () => {
    for (const f of [
      "index.html",
      "tutorial.html",
      "style.css",
      "app.js",
      join("packets", "circle.json"),
      join("packets", "adversary.json"),
      // The two pages the landing links to. Without these lines, deleting either `cpSync` ships a
      // landing whose links 404 and a green bar — the whole suite is about the artifact holding
      // together, and a link to nothing is the artifact not holding together.
      "intro.html",
      "capabilities.html",
      "capabilities.js",
    ]) {
      expect(existsSync(join(OUT, f)), `${f} missing from site-dist`).toBe(true);
    }
  });

  it("the landing's links resolve to emitted files, so a reader never hits a 404", () => {
    const html = readFileSync(join(OUT, "index.html"), "utf8");
    for (const href of ["tutorial.html", "intro.html", "capabilities.html"]) {
      expect(html, `the landing does not link ${href}`).toContain(`href="${href}"`);
      expect(existsSync(join(OUT, href)), `${href} linked but not emitted`).toBe(true);
    }
  });

  it("the book's page loads the bundle the build emitted", () => {
    const html = readFileSync(join(OUT, "capabilities.html"), "utf8");
    expect(html).toContain(`src="./capabilities.js"`);
  });

  it("the app bundle is self-contained: nothing left for a browser to resolve", () => {
    const text = readFileSync(join(OUT, "app.js"), "utf8");
    // No import STATEMENTS. The lesson copy legitimately wraps onto lines beginning with the
    // word "import", so match the statement grammar — a specifier or a from-clause — not the
    // word at a line start.
    expect(text).not.toMatch(/^import\s*(?:[\w$*{},\s]+from\s*)?["']/m);
    expect(text).not.toMatch(/\brequire\(/);
    // Zero node: specifiers beyond graphql's guarded feature probe (same rule as the
    // browser-bundle suite).
    for (const m of text.matchAll(/["']node:/g)) {
      const site = text.slice(Math.max(0, m.index - 30), m.index + 40);
      expect(site).toMatch(/getBuiltinModule\(["']node:diagnostics_channel["']\)/);
    }
  });

  it("the tutorial page loads exactly the artifacts the build emitted", () => {
    const html = readFileSync(join(OUT, "tutorial.html"), "utf8");
    expect(html).toContain(`src="./app.js"`);
    expect(html).toContain(`href="./style.css"`);
  });
});
