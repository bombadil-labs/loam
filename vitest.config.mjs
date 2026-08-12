import { defineConfig } from "vitest/config";

// The suite drives REAL sqlite files — appends, purges, and VACUUMs that fsync to disk and
// checkpoint a WAL. On a loaded Windows CI runner those cycles legitimately cost several seconds,
// and vitest's 5s default left the byte-level erasure rails (test/store/erasure-at-rest.test.ts)
// timing out under load while passing everywhere else — a boundary flake, not a hang. Raising the
// budget gives real I/O room without hiding a stuck test; the assertions are untouched.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Parallel work happens in git worktrees under `.claude/worktrees/`, and each one carries a full
    // copy of this suite. Without this line the default glob collects them all: a run from the main
    // checkout inherits every in-flight branch's red bar and every fixed-port test races its own
    // copies, which reads exactly like a defect in the code you are actually holding. `eslint`
    // already ignores the same path.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**"],
  },
});
