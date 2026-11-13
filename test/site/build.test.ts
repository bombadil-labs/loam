import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

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
    expect(text).not.toMatch(/^import\s*(?:[\w$*{},\s]+from\s*)?["']/m);
    expect(text).not.toMatch(/\brequire\(/);
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

  it("the deployed tutorial is the v3 player: the shell it renders into, and the engine inside the bundle", () => {
    const html = readFileSync(join(OUT, "tutorial.html"), "utf8");
    for (const id of [
      "lesson-pane",
      "progress-rail",
      "glossary-entries",
      "ground-show-tutorial",
      "drawer",
    ]) {
      expect(html, `the shipped page has no #${id}`).toContain(`id="${id}"`);
    }
    const app = readFileSync(join(OUT, "app.js"), "utf8");
    expect(app, "the checkpoint store did not ship").toContain("loam:tutorial-ckpt:");
    expect(app, "the tutorial's own vocabulary did not ship").toContain("tutorial.glossary");
  });

  it("ships no native dialog: every confirmation is a control in the page", () => {
    const app = readFileSync(join(OUT, "app.js"), "utf8");
    expect(app).not.toMatch(/window\.confirm\s*\(/);
    expect(app).not.toMatch(/(?<![.\w])confirm\s*\(["'`]/);
  });
});
