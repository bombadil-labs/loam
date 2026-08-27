// Compile `docs/*.md` into `src/server/docs-content.ts` — the module the MCP door's `loam_docs`
// tool and `resources/read` serve from. The doc rides the BUILD (tsc compiles the generated module
// into dist like any other), so a packaged install serves its own version's grammar with no
// runtime read of a docs/ tree it does not ship.
//
// The gen-packets pattern (committed generated artifact, `--check` gates drift): re-running this
// script is byte-identical for unchanged inputs, `--check` diffs without writing, and `npm run
// build` runs the check so a docs/ edit that forgot to regenerate fails the build rather than
// serving stale pages. `test/server/loam-docs.test.ts` runs the same comparison in the suite.
//
// docs/ holds two kinds of file and the split is explicit: SUMMARIES names what the store SERVES
// (each entry is the topic's one-line listing), INTERNAL names repo runbooks that never ride the
// door. A file in neither roster is refused rather than guessed at — silently serving a runbook
// and silently skipping an intended topic are both drift, and this script does neither. Output is
// formatted with the repo's own prettier so `format:check` and this script can never disagree
// about the file's bytes.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src", "server", "docs-content.ts");

// One line per SERVED topic, shown by `loam_docs` with no arguments and by `resources/list`.
const SUMMARIES = {
  "register-grammar":
    "The registration envelope, the term algebra, predicates, mask policies, the resolution " +
    "policy language, and refs/edges — transcribed from the parsers, not paraphrased.",
};

// Repo-internal docs: in the tree for people working on Loam, never compiled into the package.
const INTERNAL = new Set(["wsl-migration"]);

export async function generate() {
  const files = readdirSync(join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .sort();
  const topics = [];
  for (const file of files) {
    const topic = file.slice(0, -".md".length);
    if (INTERNAL.has(topic)) continue;
    const summary = SUMMARIES[topic];
    if (summary === undefined) {
      throw new Error(
        `build-docs: docs/${file} is in neither roster — add a summary to SUMMARIES to serve ` +
          `it, or list it in INTERNAL to keep it out of the package; this script does not guess`,
      );
    }
    topics.push({ topic, summary, markdown: readFileSync(join(root, "docs", file), "utf8") });
  }
  for (const topic of Object.keys(SUMMARIES)) {
    if (!files.includes(`${topic}.md`)) {
      throw new Error(`build-docs: SUMMARIES names "${topic}" and docs/${topic}.md does not exist`);
    }
  }
  if (topics.length === 0) throw new Error("build-docs: docs/ holds no .md file to compile");
  const body = topics
    .map(
      (t) =>
        `  {\n    topic: ${JSON.stringify(t.topic)},\n    summary:\n      ` +
        `${JSON.stringify(t.summary)},\n    markdown:\n      ${JSON.stringify(t.markdown)},\n  },`,
    )
    .join("\n");
  const source =
    `// GENERATED from docs/*.md by scripts/build-docs.mjs — do not edit by hand.\n` +
    `// Regenerate: \`node scripts/build-docs.mjs\`; \`--check\` diffs without writing (run by the build).\n` +
    `\n` +
    `export interface DocTopic {\n` +
    `  readonly topic: string;\n` +
    `  readonly summary: string;\n` +
    `  readonly markdown: string;\n` +
    `}\n` +
    `\n` +
    `export const DOC_TOPICS: readonly DocTopic[] = [\n${body}\n];\n`;
  const cfg = await prettier.resolveConfig(OUT);
  return prettier.format(source, { ...cfg, filepath: OUT });
}

// CLI when executed directly; inert on import (the drift rail imports `generate`).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await generate();
  if (process.argv.includes("--check")) {
    let existing;
    try {
      existing = readFileSync(OUT, "utf8");
    } catch {
      existing = undefined;
    }
    if (existing !== text) {
      console.error(
        "build-docs --check: src/server/docs-content.ts does not match docs/*.md — " +
          "run `node scripts/build-docs.mjs` and commit the result",
      );
      process.exit(1);
    }
    console.log("build-docs --check: src/server/docs-content.ts is byte-identical");
  } else {
    writeFileSync(OUT, text);
    console.log(`build-docs: wrote src/server/docs-content.ts (${text.length} bytes)`);
  }
}
