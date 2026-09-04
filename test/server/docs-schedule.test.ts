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
// WHAT THIS FILE ASSERTS, AND WHAT IT RESTS ON. The first case asks the REAL vitest which project
// collects each of the two files, so "exactly one project collects it" is measured rather than
// read off the config — a third project added later with no `include` would collect them under the
// default glob, and a rail that only read the two projects it knows by name would stay green while
// the collision came back. The remaining cases read declarations, because no run can show that a
// group's files are serialised without observing a race that may not happen.
//
// THE PREMISE, NAMED: those rest on vitest honouring `fileParallelism` and `sequence.groupOrder` at
// PROJECT level. Vitest ignores a misplaced option rather than refusing it, so if that ever stops
// being true these cases stay green while the files race again. Measured against vitest 4.1.10;
// `package.json` floats on `^4.1.10`, so a minor bump is the thing to re-check.
//
// RAILS-RED on origin/main, this file copied in: MEASURED BELOW.
//
// REVERT PROBES, MEASURED against this file as it stands — see below.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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
  it("vitest itself collects each file into exactly one project, and it is the docs one", () => {
    // ASKED OF THE TOOL, NOT OF THE CONFIG OBJECT. Reading the two projects this file knows by
    // name cannot see a THIRD project collecting the same files under the default glob; the
    // resolved listing can, because a second collector is a second row.
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
    for (const file of [WRITER, READER]) {
      const rows = listed.filter((r) => r.file === join(root, file));
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
    // AFTER, not merely different. Equal orders run the groups in parallel, which is the collision
    // this file exists to prevent, and a header that outruns its assertion is the very defect this
    // file is repairing.
    expect(docs.sequence!.groupOrder!).toBeGreaterThan(suite.sequence!.groupOrder!);
    // And no OTHER project shares the docs group, or the pair is alone with company.
    for (const other of projects) {
      if (other.test.name === "docs") continue;
      expect(
        other.test.sequence?.groupOrder,
        `${other.test.name} does not run alongside the docs group`,
      ).not.toBe(docs.sequence!.groupOrder);
    }
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
