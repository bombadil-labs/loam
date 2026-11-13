import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRITER = "test/server/docs-quick-start.test.ts";
const READER = "test/server/loam-docs.test.ts";

interface Project {
  test: {
    name: string;
    include?: string[];
    exclude?: string[];
    fileParallelism?: boolean;
    sequence?: { groupOrder?: number };
  };
}

const config = async (): Promise<Project[]> => {
  const loaded = (await import(join(root, "vitest.config.mjs"))) as {
    default: { test?: { projects?: Project[] } };
  };
  const projects = loaded.default.test?.projects;
  expect(projects, "the config declares projects").toBeDefined();
  return projects!;
};
const named = (projects: Project[], name: string): Project["test"] => {
  const found = projects.find((p) => p.test.name === name);
  expect(found, `a project named ${name}`).toBeDefined();
  return found!.test;
};

describe("T275 — the two docs rails cannot run at the same time", () => {
  it("vitest itself collects each file into exactly one project, and it is the docs one", () => {
    const listed = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(root, "node_modules", "vitest", "vitest.mjs"),
          "list",
          "--json",
          "--filesOnly",
          WRITER,
          READER,
        ],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    ) as { file: string; projectName?: string }[];
    const slashed = (path: string): string => path.replace(/\\/g, "/");
    for (const file of [WRITER, READER]) {
      const rows = listed.filter((r) => slashed(r.file).endsWith(`/${file}`));
      expect(rows.length, `${file} is collected by exactly one project`).toBe(1);
      expect(rows[0]!.projectName, `${file} is collected by the docs project`).toBe("docs");
    }
  });

  it("both files are in one group, and that group runs after everything else", async () => {
    const projects = await config();
    const docs = named(projects, "docs");
    expect(docs.include, "the writer is in the docs group").toContain(WRITER);
    expect(docs.include, "and so is the reader").toContain(READER);
    const suite = named(projects, "suite");
    expect(docs.sequence?.groupOrder, "the docs group has an order").toBeDefined();
    expect(suite.sequence?.groupOrder, "so does the rest of the suite").toBeDefined();
    expect(docs.sequence!.groupOrder!).toBeGreaterThan(suite.sequence!.groupOrder!);
    for (const other of projects) {
      if (other.test.name === "docs") continue;
      expect(
        other.test.sequence?.groupOrder,
        `${other.test.name} does not run alongside the docs group`,
      ).not.toBe(docs.sequence!.groupOrder);
    }
  });

  it("inside that group the two files run one at a time", async () => {
    expect(named(await config(), "docs").fileParallelism).toBe(false);
  });

  it("the rest of the suite does not also collect them, so neither runs twice", async () => {
    const suite = named(await config(), "suite");
    for (const file of [WRITER, READER]) {
      expect(suite.exclude, `${file} runs in the docs group only`).toContain(file);
    }
    expect(suite.exclude, "the worktree exclusion survives the split").toContain(
      ".claude/worktrees/**",
    );
  });
});
