import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const read = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const die = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const bump = process.argv[2] ?? "patch";
if (!["patch", "minor", "major"].includes(bump)) {
  die(`the bump is patch, minor, or major — not "${bump}"`);
}

if (read("git rev-parse --abbrev-ref HEAD") !== "main") {
  die("releases cut from main only");
}
if (read("git status --porcelain") !== "") {
  die("the working tree is not clean — a release is a statement about what main IS");
}
run("git fetch origin main --quiet");
if (read("git rev-parse HEAD") !== read("git rev-parse origin/main")) {
  die("main is not in sync with origin/main — pull or push first");
}
for (const license of ["LICENSE-MIT", "LICENSE-APACHE"]) {
  if (!existsSync(license)) {
    console.warn(
      `release: NOTE — ${license} is missing (the license files are the author's to add); ` +
        `npm will publish with a warning`,
    );
  }
}

run("npm run check");

run(`npm version ${bump} -m "release v%s"`);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
run("git push origin main --follow-tags");

console.log(
  `\nrelease: v${version} is tagged and pushed — the release workflow publishes from here.\n` +
    `  watch it: gh run watch --repo bombadil-labs/loam`,
);
