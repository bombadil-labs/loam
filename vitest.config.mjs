import { defineConfig } from "vitest/config";

// The suite drives REAL sqlite files — appends, purges, and VACUUMs that fsync to disk and
// checkpoint a WAL. On a loaded Windows CI runner those cycles legitimately cost several seconds,
// and vitest's 5s default left the byte-level erasure rails (test/store/erasure-at-rest.test.ts)
// timing out under load while passing everywhere else — a boundary flake, not a hang. Raising the
// budget gives real I/O room without hiding a stuck test; the assertions are untouched.
const shared = {
  testTimeout: 20_000,
  hookTimeout: 20_000,
  // Parallel work happens in git worktrees under `.claude/worktrees/`, and each one carries a full
  // copy of this suite. Without this line the default glob collects them all: a run from the main
  // checkout inherits every in-flight branch's red bar and every fixed-port test races its own
  // copies, which reads exactly like a defect in the code you are actually holding. `eslint`
  // already ignores the same path.
  exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**"],
};

// TWO FILES SHARE ONE DIRECTORY IN THE REAL TREE, AND THEY MUST NOT RUN AT THE SAME TIME (T275).
// `test/server/docs-quick-start.test.ts` writes `docs/Bad_Topic.md` and removes it, proving the
// doc generator refuses a filename that would mint an unservable topic.
// `test/server/loam-docs.test.ts` runs that same generator in a child process, proving the
// committed module regenerates byte-identically. Both assertions are right and both need the real
// tree. Run concurrently in different workers, the reader's child process meets the writer's stray
// file and dies — a red bar that belongs to neither test.
//
// A LOCK CANNOT BE TAKEN ON BOTH SIDES: the writer is a frozen rail of an archived ticket, so this
// is scheduling, not synchronisation. Projects with different `groupOrder` run one group after the
// other, so the docs group runs alone. Nothing else changes: no retry, no widened assertion, no
// skip, and both files are unedited.
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
          // Alone in its group, and single-file at a time within it: the two files race each other
          // and nothing else, so serialising the pair is the whole fix.
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
