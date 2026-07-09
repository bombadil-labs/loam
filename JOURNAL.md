# Journal

_Append-only record: one entry per completed step (or notable event) — what was done, why it went that way, and any novel learning. Newest last._

## 2026-07-09 — Open decisions resolved; sprint begins

Myk resolved both standing questions at the start of a three-day build sprint:

- **Multi-tenancy (§7): full.** v1 treats tenant isolation as a first-class construct — genesis
  schemas and gateway enforcement carry it from the start, not as a later graft.
- **Chorus (§10): reference-only.** Read its plumbing as a design guide; write Loam's code clean,
  against Loam's tests. SPEC §10 is now a reference inventory, not an extraction inventory.
- **Cadence:** run the loop autonomously until the plan's steps are secured, then regroup.

Also verified at sprint start: `@bombadil/rhizomatic@0.1.0` is live on npm (published 2026-07-06),
and its export surface matches SPEC §2 name-for-name — the spike (step 1) will confirm semantics.

## 2026-07-09 — Step 0: Scaffold (PR #1)

The ground is prepared: a TS/ESM project standing on the real `@bombadil/rhizomatic@0.1.0` from
npm, with a five-stage gate (`prettier` → type-aware `eslint` → `tsc --noEmit` → `tsc -p
tsconfig.build.json` → `vitest`) held by CI on ubuntu and windows. The smoke test signs three
deltas with a fixed seed and walks them through content addressing, `DeltaSet` dedup, and
overlapping union merges in both orders.

Learnings worth keeping:

- **vitest 4, not 2.** rhizomatic pins vitest ^2; that chain (vite/esbuild) carries five audit
  findings including a critical. v4 audits clean and nothing in our usage differs. Don't inherit
  a toolchain pin out of sympathy.
- **The adversarial review earned its keep on a "trivial" step.** Eight finder angles on a
  scaffold produced ten real fixes — the sharpest: `build` (declaration emit) was exercised by
  nothing, so TS2742-class breakage would have merged green until step 8; and non-type-aware
  eslint would have let a floating promise into step 2's async store seam. Review the boring PRs.
- **Tell the truth in `engines`.** The tooling's real floor is node 22.13 (eslint-visitor-keys);
  `>=22` was a comfortable lie. Note: the local dev machine runs node 22.0.0 — it works, but
  npm warns; an upgrade would quiet it.
- **A merge test with an empty set proves nothing.** Order-blindness is only falsifiable with
  two overlapping non-empty sets compared in both orders.
