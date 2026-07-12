# Current work — rhizomatic 0.3.0 vocab overhaul + the migration tool

_Branch `rhizomatic-0.3.0-vocab`. **Complete — ready for PR + Myk's merge.**_

## Done

**The vocab overhaul** (0.2.0 → 0.3.0): source + tests + demos + docs re-vocabularized (Schema = the
resolution program, Policy = the per-property rule); Option B wire realignment; packets regenerated;
village green 0-19 (incl. the phase17 fix); tutorial live-verified; 2-angle review resolved.

**The migration tool** (new standing policy — ship one with every breaking on-wire change):

- [x] `src/migrate/migrate.ts`: `migrate(deltas, {seed}) → {deltas, report}` over a `MIGRATIONS`
      chain; the `hyperschema-roles` step re-signs schema-def deltas to the new roles and negates
      each old one with a `supersededBy` link + `reason`. Grow-only, shape-detected, idempotent.
- [x] `loam migrate <offer> [--out]` CLI (re-signs with the home's operator seed).
- [x] Barrel exports; `test/migrate/migrate.test.ts` + `test/cli/migrate.test.ts`.
- [x] Docs: CLAUDE.md standing rule, SPEC §20 (+ Provenance footer), README (Migrations section +
      layout), JOURNAL entry; renderer reservation bumped §20 → §21 in TODO.md.

**Gate:** `npm run check` **green, 450 tests**.

## Deferred / flagged (own PRs, in TODO.md)

- Loam's registration pointer roles still read `schema`/`policy` (the `policy` role holds a Schema) —
  mirroring rhizomatic fully is its own PR (moves content addresses).
- A per-store version marker (vs shape-detection) — a future migration-framework optimization.

## Next

Open the PR (vocab overhaul + migration tool + policy), leave the merge for Myk.
