# Current work — Step 8: CLI + deploy

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**The pieces:**

- **A `loam` CLI** — a tiny hand-rolled arg parser (chorus `cli.ts` as reference), subcommands:
  - `loam init [--home DIR] [--seed HEX]` — create a home dir, mint or import the operator seed,
    write config; **never echo the seed**.
  - `loam serve [--http] [--port N] [--store PATH] [--token TOK] [--home DIR]` — boot a store
    from its backend and serve it (the step-6 HTTP server).
  - `loam store <path>` — inspect a store (delta count, registrations, tenants).
  - `--help` / `--version` on the root and each subcommand.
- **A container** — a `Dockerfile` (node 22-slim, build, non-root, `loam serve --http`) + a
  `.dockerignore`.
- **Turnkey hosted persistence** — document the libSQL/Turso path (the `StoreBackend` seam
  already makes it a driver; wire it if cheap, else a clear config seam + doc).
- **npm-publish prep** (landing task): keep `"private": true` (Myk's publish button), but verify
  `files`/`bin`/`exports` against a real `npm pack` tarball smoke; add the `bin` entry.

**Success criteria (from CLAUDE.md):** `loam serve --http` answers a query; a container runs with
durable persistence; an install/tarball smoke passes; `npm run check` green.

**Sub-tasks:**

- [ ] `test/cli/cli.test.ts` — init (creates home, writes config, hides seed), serve
      (spawns, answers a real HTTP query, shuts down), store (reports), help/version, bad args
- [ ] `src/cli/args.ts` + `src/cli/cli.ts` (+ `config.ts`) — the parser and subcommands
- [ ] `bin` wiring in package.json; `Dockerfile` + `.dockerignore`
- [ ] tarball smoke (`npm pack`, inspect contents) — a test or a checked script
- [ ] libSQL path documented (driver seam) — wire if cheap
- [ ] Gate green → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
