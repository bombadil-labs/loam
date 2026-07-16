## 2026-07-09 — Step 8: CLI + deploy (PR #10)

The `loam` command (a tiny hand-rolled parser — a framework would be the package's heaviest
dependency): `init` mints a home and an operator identity, `serve --http` boots a store from its
genesis and serves it, `store` inspects. A `Dockerfile` (node 22-slim, non-root, store on a
`/data` volume) and the npm-publish surface (`bin` + `files`, a `pack` smoke test). 139/139.

Learnings worth keeping:

- **The seed never touches an output stream.** `init` writes it to `operator.seed` (mode 0600),
  keeps only the public author in `config.json`, and refuses a positional `loam init <seed>`
  (the natural `--seed` typo) *without echoing the value* — a seed in a terminal is a seed in a
  shell history. A test asserts the printed output never contains the secret.
- **`run` returns an exit code, or (serve --detach) a live handle.** Testing a server CLI means
  driving a real listening server; the detach seam lets a test boot, `fetch`, and close without
  a subprocess. The handle's `close()` releases the server AND the gateway's backend file — one
  shutdown, whole, so the Windows file lock clears before cleanup.
- **Hosted persistence stayed a driver, not an image change.** The step-2 `StoreBackend` seam
  means a libSQL/Turso driver is a one-file addition beside `SqliteBackend` — not vendored here
  (it needs a live Turso account to exercise), but the seam is the deliverable and SPEC §8 now
  says so.
- **`npm pack --dry-run --json` is a real regression guard**: the smoke test pins that
  `dist/index.js` and `dist/cli/bin.js` actually ship, so a `files`/`bin` slip can't publish a
  package whose advertised `loam` command isn't in the tarball. (`shell: true` on windows — npm
  is a `.cmd`.)

Review resolution (8 findings): the single agent found the container **couldn't boot as
written** — four compounding Docker bugs. Fixed:

- **`chown` before `VOLUME`** — a `VOLUME` declared first discards later ownership changes, so
  the runtime user hit EACCES on a root-owned `/data`. Reordered.
- **Turnkey serve** — `serve` now reads the token from `--token` OR `LOAM_TOKEN`, and
  **self-initializes** (mints, or imports via `LOAM_SEED`, the operator identity on first run),
  so `docker run -e LOAM_TOKEN=… loam` works with no out-of-band `loam init`. The docs and the
  code now agree.
- **Native build, once** — better-sqlite3 compiles in a full `node:22` build stage (which has a
  toolchain) and the already-compiled `node_modules` is copied into the slim runtime, so the
  runtime needs no compiler and the build never silently depends on a prebuild matching the arch.
- **The genesis marker.** A bare genesis was empty, so durability was untestable (an empty store
  is honestly 0 deltas). Every store is now born with an operator-marker delta — it records who
  governs the store (auditable), is idempotent (content-addressed, timestamp 0), and makes
  durability demonstrable: a restart reads back what the first boot wrote.
- Plus: `--port` rejects non-integers instead of coercing a typo to a random port; the parser
  handles `--name=value`; and the Windows 0600 caveat on the seed file is documented, not
  pretended away.
