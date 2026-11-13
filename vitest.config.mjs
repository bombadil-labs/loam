import { defineConfig } from "vitest/config";

const shared = {
  testTimeout: 20_000,
  hookTimeout: 20_000,
  exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**"],
};

const DOCS_GROUP = ["test/server/docs-quick-start.test.ts", "test/server/loam-docs.test.ts"];

export default defineConfig({
  test: {
    ...shared,
    projects: [
      {
        test: {
          ...shared,
          name: "suite",
          exclude: [...shared.exclude, ...DOCS_GROUP],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          ...shared,
          name: "docs",
          include: DOCS_GROUP,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
