// T275 — TWO DOCS RAILS SHARE ONE DIRECTORY IN THE REAL TREE, AND MUST NOT RUN AT THE SAME TIME.
//
// `test/server/docs-quick-start.test.ts` writes `docs/Bad_Topic.md`, runs the doc generator, and
// removes it — proving the generator refuses a filename that would mint an unservable topic.
// `test/server/loam-docs.test.ts` runs that same generator in a child process — proving the
// committed module regenerates byte-identically. Both are right, and both need the REAL tree.
// Run concurrently in different workers, the reader's child process meets the writer's stray file
// and dies on it: a red bar that belongs to neither test, observed 2026-09-03.
//
// A LOCK CANNOT BE TAKEN ON BOTH SIDES — the writer is a frozen rail of archived T250 — so the fix
// is scheduling, and this file asserts the scheduling rather than a passing run. A run that
// happened not to collide proves nothing; the declaration is the thing that makes collision
// impossible, so the declaration is what is read here.
//
// RAILS-RED on origin/main, this file copied in: 3 red, 0 green — 3 cases. No control.
//
// REVERT PROBES, MEASURED against this file as it stands — 3 cases.
//   the two files share one group                    → 1 red, 2 green
//   the docs group runs its files in parallel        → 1 red, 2 green
//   the suite group stops excluding the docs files   → 1 red, 2 green

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  it("both files are in one group, and that group runs after everything else", async () => {
    const projects = await config();
    const docs = named(projects, "docs");
    expect(docs.include, "the writer is in the docs group").toContain(WRITER);
    expect(docs.include, "and so is the reader").toContain(READER);
    // A DIFFERENT groupOrder is the whole mechanism: same order means parallel groups, which is
    // the collision this file exists to prevent.
    const suite = named(projects, "suite");
    expect(docs.sequence?.groupOrder, "the docs group has an order").toBeDefined();
    expect(suite.sequence?.groupOrder, "so does the rest of the suite").toBeDefined();
    expect(
      docs.sequence!.groupOrder === suite.sequence!.groupOrder,
      "and the two orders differ, so the groups run one after the other",
    ).toBe(false);
  });

  it("inside that group the two files run one at a time", async () => {
    // Alone in its group is not enough: the two race EACH OTHER, so the pair must serialise too.
    expect(named(await config(), "docs").fileParallelism).toBe(false);
  });

  it("the rest of the suite does not also collect them, so neither runs twice", async () => {
    const suite = named(await config(), "suite");
    for (const file of [WRITER, READER]) {
      expect(suite.exclude, `${file} runs in the docs group only`).toContain(file);
    }
    // And the exclusions the whole suite has always carried are still there: a config that
    // dropped `.claude/worktrees/**` would collect every in-flight branch's copy of this suite.
    expect(suite.exclude, "the worktree exclusion survives the split").toContain(
      ".claude/worktrees/**",
    );
    // Read as text too: the mechanism is a declaration a person must be able to find.
    const text = readFileSync(join(root, "vitest.config.mjs"), "utf8");
    expect(text, "and the config says why").toContain("T275");
  });
});
