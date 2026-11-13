import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src", "server", "docs-content.ts");

const SUMMARIES = {
  "first-steps":
    "You connected — now what? What makes this store different, six ways to use it today " +
    "with paste-able first prompts, and the two things worth knowing early.",
  "quick-start":
    "From nothing to a store Claude can reach: install, the guided init, the tailscale funnel, " +
    "and the MCP connection — every loam command transcribed from the shipped code.",
  "register-grammar":
    "The registration envelope, the term algebra, predicates, mask policies, the resolution " +
    "policy language, and refs/edges — transcribed from the parsers, not paraphrased.",
};

const INTERNAL = new Set(["wsl-migration", "project-context"]);

export async function generate() {
  for (const topic of Object.keys(SUMMARIES)) {
    if (INTERNAL.has(topic)) {
      throw new Error(
        `build-docs: "${topic}" is in BOTH rosters — SUMMARIES serves it and INTERNAL hides it; ` +
          `pick one`,
      );
    }
  }
  const files = readdirSync(join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .sort();
  const topics = [];
  for (const file of files) {
    const topic = file.slice(0, -".md".length);
    if (INTERNAL.has(topic)) continue;
    if (!/^[a-z0-9-]+$/.test(topic)) {
      throw new Error(
        `build-docs: docs/${file} would mint topic "${topic}" — a topic is [a-z0-9-]+ only, ` +
          `because it rides a resource uri verbatim; rename the file`,
      );
    }
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
