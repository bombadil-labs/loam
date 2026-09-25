# Census tools

These scripts measure the source tree. They produced the numbers in
`journal/2026-09-25-loam-is-the-testbed.md`. Every script parses with the TypeScript compiler, so
comments, strings and code are told apart by the syntax tree, not by a regex. Run them from the
repo root. Each takes an optional directory, and the default is `src`.

| Script | What it measures |
| --- | --- |
| `density.mjs [--top N]` | Code, string literals and comments: bytes and lines, per file and in total |
| `imports.mjs [--json out]` | The import graph: cycles, directory edges, fan-in and fan-out, rhizomatic names used |
| `gateway-surface.mjs` | The `Gateway` class members, and which files reach into which members |
| `split.mjs [--files]` | Code lines by subsystem, split into host-bound and host-free function code |
| `hazards.mjs` | Comment share and hazard (`H1`, ...) and ticket (`T1`, ...) citations, per subsystem |
| `hermetic-census.mjs` | Functions already hermetic, liftable, or left for a person; by count and by code lines |
| `ratchet.mjs [--write]` | The census ratchet in `npm run check`: fails when a count in `ratchet.json` rises, or falls without the file being rewritten |
| `ambient-reach.mjs` | What each function reaches outside itself: imports, module bindings, globals, the clock |

`lib.mjs` holds the shared parsing, the subsystem map and the candidate-function rule. The two
hermetic scripts need `@bombadil/hermetic`, a dev dependency. `ambient-reach.mjs` marks functions in
a temporary copy only; it never changes the repo.

Two counts come from `grep`:

```sh
grep -rhoE "options\.seed\b" src --include=*.ts | wc -l   # reads of the operator's private key
grep -rhoE "reactor\.snapshot\(\)" src --include=*.ts | wc -l   # full copies of the delta set
```

## Baseline (main at aeeea24, 2026-09-24)

- **Density:** 97 files. 35,118 code lines, 901 string-only lines, 14,958 comment-only lines.
  Non-whitespace bytes: code 37.4%, strings 14.0%, comments 48.6%. Rhizomatic's TypeScript:
  comments 19.0%.
- **Imports:** one cycle of 20 files over value imports, and one of 2 (`registration.ts`,
  `binding-policy.ts`). With type imports, the large cycle has 27 files. Fan-in: `gateway.ts` 40,
  `registration.ts` 37, `container.ts` 24.
- **Gateway:** 144 members: 104 methods, 37 properties, 2 getters, 22 private.
- **Split:** 36,019 code lines. The areas that SPEC-6 claims hold about 10,000 of them: federation
  and ingest 3,430, containers and pools 2,285, erasure 2,274, adoption and manifests 1,588,
  grants 410.
- **Hazard citations per 1,000 code lines:** storage 22.0, erasure 15.0, containers 13.6,
  federation 9.6, adoption 8.8, law 6.1, CLI 5.5, query surface 4.8, HTTP 3.6, code in deltas 3.5.
- **Hermetic:** 1,136 candidate functions. Already hermetic: 24.1% of them, holding 7.8% of their
  code lines. Liftable: 19.5% and 11.4%. Left for a person: 56.4% and 80.8%.
- **Ambient reach:** 761 functions reach outside themselves. 75 reach ambient authority. 19 core
  functions read the clock directly.
- **grep:** 63 reads of `options.seed` in 20 files. 51 calls of `reactor.snapshot()`.

## The ratchet

`ratchet.mjs` counts four things with the syntax tree: the largest import cycle over value
imports, `options.seed` reads, `reactor.snapshot()` calls, and wall-clock reads in core code. A
count that falls fails too, until `--write` locks the gain in. The `grep` counts above include
mentions in comments, so they read a little higher.

## Using them in M0

The census ratchet in M0 should fail CI when a count moves the wrong way. Good first counts: the
size of the large import cycle, the files that reach into `Gateway` members, the core clock
readers, the `options.seed` reads, and the `reactor.snapshot()` calls. Each graduation should
move at least one of them down.
