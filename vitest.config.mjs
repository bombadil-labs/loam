import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// TEMPORARY (T156) — this plugin and `test/setup/windows-teardown-tolerance.ts` are deleted
// together by the PR that lands the real Chrome-teardown fix (#382). It redirects ONE import in
// ONE file, so that a failed removal of a Chrome scratch profile on win32 stops reddening every
// pull request. Read the shim's header for the deadlock it breaks and why the redirect is a
// `transform` rather than a setup file or a resolver alias.
const SHIM = join(
  dirname(fileURLToPath(import.meta.url)),
  "test",
  "setup",
  "windows-teardown-tolerance.ts",
);
const SENTINEL = "t156-tolerant-fs";
const CDP_IMPORT = `import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";`;

const tolerantFs = {
  name: "t156-windows-teardown-tolerance",
  enforce: "pre",
  resolveId(source) {
    return source === SENTINEL ? SHIM : null;
  },
  transform(code, id) {
    if (!id.replace(/\\/g, "/").endsWith("/test/browser/cdp.ts")) return null;
    if (!code.includes(CDP_IMPORT)) {
      // Refuse rather than pass silently. A shim that quietly stopped applying would look exactly
      // like a fixed Windows leg right up until the leg went red again.
      throw new Error(
        "t156-windows-teardown-tolerance: test/browser/cdp.ts no longer carries the exact " +
          "`node:fs` import this plugin rewrites, so the Windows teardown tolerance is NOT in " +
          "effect. If cdp.ts changed because the real fix (#382) landed, delete this plugin and " +
          "test/setup/windows-teardown-tolerance.ts — they are spent.",
      );
    }
    return {
      code: code.replace(CDP_IMPORT, CDP_IMPORT.replace('"node:fs"', JSON.stringify(SENTINEL))),
      map: null,
    };
  },
};

// The suite drives REAL sqlite files — appends, purges, and VACUUMs that fsync to disk and
// checkpoint a WAL. On a loaded Windows CI runner those cycles legitimately cost several seconds,
// and vitest's 5s default left the byte-level erasure rails (test/store/erasure-at-rest.test.ts)
// timing out under load while passing everywhere else — a boundary flake, not a hang. Raising the
// budget gives real I/O room without hiding a stuck test; the assertions are untouched.
export default defineConfig({
  plugins: [tolerantFs],
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
