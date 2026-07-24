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
  },
});
