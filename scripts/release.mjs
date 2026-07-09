// The release: `npm run release -- patch|minor|major` (default patch). Runs the whole gate
// locally, bumps the version (the `version` lifecycle syncs the in-source constants), commits,
// tags vX.Y.Z, and pushes — the GitHub Actions release workflow takes it from the tag.
//
// Refuses to release from anywhere but a clean, up-to-date main: a release is a statement
// about what main IS, not about a working tree.

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

// --- the preconditions ---------------------------------------------------------------------
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

// --- the gate, locally (the workflow runs it again — a tag should never be a gamble) --------
run("npm run check");

// --- bump, sync, commit, tag, push -----------------------------------------------------------
run(`npm version ${bump} -m "release v%s"`);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
run("git push origin main --follow-tags");

console.log(
  `\nrelease: v${version} is tagged and pushed — the release workflow publishes from here.\n` +
    `  watch it: gh run watch --repo bombadil-labs/loam`,
);
