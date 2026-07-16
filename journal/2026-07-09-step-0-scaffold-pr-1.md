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
- **The strict review earned its keep on a "trivial" step.** Eight finder angles on a
  scaffold produced ten real fixes — the sharpest: `build` (declaration emit) was exercised by
  nothing, so TS2742-class breakage would have merged green until step 8; and non-type-aware
  eslint would have let a floating promise into step 2's async store seam. Review the boring PRs.
- **Tell the truth in `engines`.** The tooling's real floor is node 22.13 (eslint-visitor-keys);
  `>=22` was a comfortable lie. Note: the local dev machine runs node 22.0.0 — it works, but
  npm warns; an upgrade would quiet it.
- **A merge test with an empty set proves nothing.** Order-blindness is only falsifiable with
  two overlapping non-empty sets compared in both orders.
