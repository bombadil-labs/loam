# Current work — cold storage: the mirror and the archive

_The live checklist for the work in progress; cleared when a unit merges._

**The ask (Myk, 2026-07-09):** flesh out store support with an optional cold-storage / backup
store. The design leans on the CRDT: a lagging copy is *correct*, catch-up is a set-difference,
restore is union. So backup is a **combinator over the seam**, not a new subsystem.

## Success criteria

- [ ] `MirrorBackend(primary, mirror, opts?)` — a `StoreBackend` that writes through to both
      sides. The primary is authoritative: its failures reject; a mirror failure does **not**
      fail the append (lag is safe under union) but is loud — a `lagging` getter and an
      `onLag` callback. `heal()` is repair and restore in one: two-way union, returns
      `{ toMirror, toPrimary }`, clears `lagging`. Reads come from the primary. `close()`
      closes both sides even if one refuses.
- [ ] `ArchiveBackend(root)` — the cold driver: a directory of canonical delta files,
      `<root>/<id[0..2)>/<id>.json`, each holding `{ claims, sig? }`. The filename is the
      content address: a file that does not recompute to its own name is corruption, refused.
      Stray non-`.json` files are ignored; malformed `.json` is refused. Copying files between
      archives IS replication — union by filename.
- [ ] Both satisfy the full `StoreBackend` contract (`test/store/contract.test.ts`), including
      close/reopen durability (archive; mirror-of-durables) and two-handle convergence. The
      contract's corruption probes generalize from sqlite-specific to per-harness hooks.
- [ ] Wiring: `LoamConfig` gains optional `archive`; `loam serve --archive <path>` overrides.
      When configured, serve builds `MirrorBackend(SqliteBackend, ArchiveBackend)` and
      **heals before boot** (boot reads the backend once), so restore-after-disaster is:
      delete the sqlite, serve again. Heal counts and lag events reach the operator's log.
- [ ] Exports: `MirrorBackend`, `ArchiveBackend` from the package root.

## Sub-tasks

- [x] Tests first: contract corruption hooks generalized (five harnesses now: memory, sqlite,
      archive, mirror(memory,memory), mirror(sqlite,archive)); mirror + archive suites; CLI
      burn-and-restore + config-field tests.
- [x] Implement `src/store/mirror.ts`, `src/store/archive.ts`; wire `config.ts` + `cli.ts`
      (heal-before-boot, loud lag, archive in the banner); exports; README Cold storage section.
- [x] Gate green (283/283) → branch → PR.
- [ ] One review agent, neutral register (this is storage-integrity code: review for
      correctness gaps — what inputs or states lose, launder, or double-count a delta).
- [ ] Resolve → merge → JOURNAL entry.
- [ ] Village: **the fire** — the almanac keeps a seed vault (archive); an act burns its
      sqlite mid-run, reboots, heal replants, the dossiers hold. Ledger updated.
- [ ] Re-plan: note the libSQL/Turso hosted driver as the natural next store unit (not this one).

## Left off here

Stages 2–4 done, gate green at 283/283. Next: open the PR, then stage 5 — one review agent,
neutral register.
