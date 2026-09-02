// Build the tutorial site (SPEC §16) into `site-dist/` — never committed; CI deploys it to
// GitHub Pages. The page imports `@bombadil/loam/browser` and this build aliases that name to
// the SAME-COMMIT source entry, so the tutorial can never skew from the library it teaches.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { stubRenderWorker } from "./esbuild-stub-render-worker.mjs";
import { renderMarkdown } from "./render-md.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The output directory is a PARAMETER, defaulting to the deployed one. This build begins by
// deleting whatever stands at `out`, so two callers sharing one path race: the browser rail
// serves a built site while `test/site/build.test.ts` rebuilds it, and a page vanishes
// mid-suite. `--out <dir>` gives each caller its own directory, which removes the race rather
// than serializing it. CI and Pages pass nothing and keep `site-dist/`.
const outFlag = process.argv.indexOf("--out");
if (outFlag !== -1 && process.argv[outFlag + 1] === undefined) {
  console.error("loam: --out needs a directory");
  process.exit(1);
}
const out = outFlag === -1 ? join(root, "site-dist") : resolve(process.argv[outFlag + 1]);

// The first thing this script does is DELETE what stands at `out`, recursively. A mistyped
// `--out .` would take the repository with it, so the two paths that can never be an output —
// the repository itself and any directory containing it — are refused rather than emptied.
if (out === root || root.startsWith(out + "/") || out === "/") {
  console.error(`loam: refusing to build into ${out} — this build deletes its output directory`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "demos", "tutorial", "app.mjs")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  alias: {
    "@bombadil/loam/browser": join(root, "src", "browser", "index.ts"),
    "node:http": join(root, "scripts", "client-node-http-stub.mjs"),
  },
  plugins: [stubRenderWorker()],
  legalComments: "none",
  logLevel: "silent",
});

// The capabilities book (T95). Bundled rather than copied, because the page renders from the same
// `chapters.mjs` the anti-rot rail imports — the identity is the guarantee, so the page must not get
// a hand-maintained second copy of the text.
await build({
  entryPoints: [join(root, "demos", "capabilities", "page.mjs")],
  outfile: join(out, "capabilities.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "silent",
});

// The ROOT is a landing page (Myk, 2026-07-26) that gets a newcomer running (Myk, 2026-09-02): the
// thesis, then the two guides — quick start and first steps — rendered here from docs/ at build
// time, so the site never carries a second copy of them (the rule the capabilities book follows;
// the last front door aged badly by carrying content the code outgrew). The tutorial, the deck and
// the book stay emitted and linked from the foot, for when a reader wants them.
const landing = readFileSync(join(root, "demos", "site", "index.html"), "utf8");
const guide = (file, id) => {
  const { html, headings } = renderMarkdown(readFileSync(join(root, "docs", file), "utf8"), {
    headingShift: 1,
    // A guide's link to its sibling guide becomes the in-page anchor; everything else stands.
    linkOf: (href) =>
      href === "quick-start.md"
        ? "#quick-start"
        : href === "first-steps.md"
          ? "#first-steps"
          : href,
  });
  const [title, ...rest] = headings;
  const toc = rest
    .filter((h) => h.level === 3)
    .map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`)
    .join("");
  // The document's own title becomes the section's; the table of contents follows it.
  return html
    .replace(`<h2 id="${title.id}">`, `<h2 id="${id}-title">`)
    .replace(`</h2>`, `</h2>\n<ul class="toc">${toc}</ul>`);
};
for (const [marker, file, id] of [
  ["<!-- QUICK-START -->", "quick-start.md", "quick-start"],
  ["<!-- FIRST-STEPS -->", "first-steps.md", "first-steps"],
]) {
  if (!landing.includes(marker)) throw new Error(`the landing template lacks ${marker}`);
}
writeFileSync(
  join(out, "index.html"),
  landing
    .replace("<!-- QUICK-START -->", guide("quick-start.md", "quick-start"))
    .replace("<!-- FIRST-STEPS -->", guide("first-steps.md", "first-steps")),
);
cpSync(join(root, "demos", "tutorial", "index.html"), join(out, "tutorial.html"));
cpSync(join(root, "demos", "tutorial", "style.css"), join(out, "style.css"));
cpSync(join(root, "demos", "tutorial", "packets"), join(out, "packets"), { recursive: true });
// The concept deck: a self-contained standalone page the landing links to, no bundling needed.
cpSync(join(root, "demos", "tutorial", "intro.html"), join(out, "intro.html"));
cpSync(join(root, "demos", "capabilities", "index.html"), join(out, "capabilities.html"));

console.log(`loam: built ${out} (the landing with both guides, the tutorial, the deck, the book)`);
