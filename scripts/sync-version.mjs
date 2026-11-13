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
    pattern: /const MCP_SERVER_INFO = \{ name: "loam", version: "[^"]+" \}/,
    replacement: `const MCP_SERVER_INFO = { name: "loam", version: "${version}" }`,
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
