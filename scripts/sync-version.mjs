// Keep the in-source version constants agreeing with package.json. Runs as the `version`
// lifecycle hook of `npm version` (after the bump, before the release commit), so the synced
// files ride the same commit as the version change.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const patches = [
  {
    file: "src/cli/cli.ts",
    pattern: /const VERSION = "[^"]+"/,
    replacement: `const VERSION = "${version}"`,
  },
  {
    file: "src/server/http.ts",
    pattern: /serverInfo: \{ name: "loam", version: "[^"]+" \}/,
    replacement: `serverInfo: { name: "loam", version: "${version}" }`,
  },
];

for (const { file, pattern, replacement } of patches) {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) {
    console.error(`sync-version: ${file} no longer matches ${String(pattern)} — fix the sync`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(pattern, replacement));
  console.log(`sync-version: ${file} → ${version}`);
}

execSync("git add src/cli/cli.ts src/server/http.ts", { stdio: "inherit" });
