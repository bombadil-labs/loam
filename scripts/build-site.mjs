import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { stubRenderWorker } from "./esbuild-stub-render-worker.mjs";
import { renderMarkdown } from "./render-md.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFlag = process.argv.indexOf("--out");
if (outFlag !== -1 && process.argv[outFlag + 1] === undefined) {
  console.error("loam: --out needs a directory");
  process.exit(1);
}
const out = outFlag === -1 ? join(root, "site-dist") : resolve(process.argv[outFlag + 1]);

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

const landing = readFileSync(join(root, "demos", "site", "index.html"), "utf8");
const guide = (file, id) => {
  const { html, headings } = renderMarkdown(readFileSync(join(root, "docs", file), "utf8"), {
    headingShift: 1,
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
cpSync(join(root, "demos", "tutorial", "intro.html"), join(out, "intro.html"));
cpSync(join(root, "demos", "capabilities", "index.html"), join(out, "capabilities.html"));

console.log(`loam: built ${out} (the landing with both guides, the tutorial, the deck, the book)`);
