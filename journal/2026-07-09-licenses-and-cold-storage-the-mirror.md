## 2026-07-09 — Licenses, and cold storage: the mirror and the archive (PRs #21, #22)

Two units. First, Myk chose the dual license — **MIT OR Apache-2.0**, the at-your-option
split — and the paperwork landed: both full texts, the README notice with the Apache §5
contribution clause, and the pack test now pins the license files into the npm tarball so the
published artifact always ships its own terms (PR #21).

Then the store grew its backup story (PR #22). The design rode the CRDT the whole way: deltas
are immutable and merge is union, so a lagging copy is *correct*, catch-up is a set-difference,
and restore is union — which means backup is a **combinator over the seam**, not a subsystem.
`MirrorBackend(primary, mirror)` writes through to both sides; the primary is authoritative
(its failures reject, its rows answer reads); a mirror failure is **lag, not loss** — loud via
`lagging` and `onLag`, repaired by `heal()`, whose two-way union is ALSO the disaster-restore
path. `ArchiveBackend(root)` is the cold driver: a directory of canonical delta files named by
their content address, so plain file tools are backup tools — copying files between archives
IS replication, and a renamed file is corruption, refused. `loam serve --archive <dir>` (or
`"archive"` in config.json) mirrors the sqlite store and heals BEFORE boot; restore after
disaster is: delete the lost sqlite, serve again. The contract's corruption probes
generalized to per-harness hooks; five harnesses now face the full contract. 285/285.

Learnings worth keeping:

- **The review found the gap between "crash" and "power loss."** Write-then-rename protects
  against a dying process, but the rename can hit disk before the data does — a truncated file
  wearing a real name, in the one driver whose whole job is surviving the machine. The bytes
  are now fsynced before the rename earns the name; the durability comment says exactly what
  is promised, the way sqlite's `synchronous = NORMAL` note does. When a driver's reason to
  exist is disaster, its honesty bar is the disaster, not the happy path.
- **A flag cleared by an operation that didn't see the failure is a lie.** `heal()` cleared
  `lagging` unconditionally; an append that lagged WHILE heal ran was masked. A lag-epoch
  counter fixes it in three lines: heal clears only what it actually caught up.
- **"Returns a set" is part of the contract even when every current consumer tolerates
  duplicates.** A misfiled copy (wrong fan directory) made `deltasSince` return one id twice —
  harmless today because every consumer unions, wrong tomorrow for any consumer that counts.
  A per-walk seen-set keeps the promise where it's made, not where it's currently caught.
