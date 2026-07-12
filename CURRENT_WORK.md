# Current work — overhaul Loam against rhizomatic 0.3.0 (Option B vocabulary)

_Branch `rhizomatic-0.3.0-vocab`. **Complete — ready for PR + Myk's merge.**_

## Done

1. [x] Dep → `@bombadil/rhizomatic@0.3.0`.
2. [x] Read the landing PR ([rhizomatic#6](https://github.com/bombadil-labs/rhizomatic/pull/6)).
3. [x] Type/API sweep: `Policy`→`Schema`, `PropPolicy`→`Policy`, `parsePolicy`→`parseSchema`,
       `policyToJson`→`schemaToJson` across `src/` + `test/` + demos (`MaskPolicy` untouched).
4. [x] Wire realignment: `rhizomatic.hyperschema.*`, `HYPER_SCHEMA_SCHEMA`; packets regenerated.
5. [x] **Demos green:** tutorial boots + registers + resolves live on 0.3.0 (arc test green);
       **village 0–19 all pass** — including phase17 (fixed its pre-existing regret/waves timing bug:
       the commons' current bio is now dated above phase12's future-dated fixture).
6. [x] **Docs everywhere:** CLAUDE.md (vocab rule) · README.md + SPEC.md (Sonnet agents, reviewed
       — "Policy" split by meaning, glossary gained a Schema entry, a stray `rdb.` typo fixed) ·
       TODO.md (removed the done item, §14 vocab note, queued the optional registration-role
       realignment) · JOURNAL.md (overhaul entry).
7. [x] `npm run check` **green, 445 tests**.

## Deferred / flagged (own PRs, in TODO.md)

- Loam's registration pointer roles still read `schema`/`policy` (the `policy` role now holds a
  Schema) — mirroring rhizomatic fully (`hyperschema`/`schema`) moves content addresses, so it's
  its own PR.

## Next

Open the PR (leave the merge for Myk); one careful review pass first.
