## 2026-07-17 — T2: one gather, many readings

The §4 symmetry — `HyperSchema : HyperView :: Schema : View` — finally serves: two lenses over one
hyperschema, per-lens at every door, built to the §21.7 design (#114) and landed as
[#131](https://github.com/bombadil-labs/loam/pull/131). The shape the design pinned held all the way
down: **dedup is a data structure, not a discipline** — `groupPrograms` derives one program per
hyperschema (gather + union roots + lens map) in exactly one place, and every consumer iterates
groups; none ever sees the flat binding list again.

What the build taught:

- **The pinning rail is the hero.** Byte-identical single-lens snapshots (SDL, OpenAPI, REST paths)
  were written before the first line of build code, and they caught a real drift mid-build — a
  reworded SDL description that would have silently moved every deployed store's introspection.
  Reverted within minutes because the rail said so, not because anyone noticed.
- **The keying sweep was the bulk, and `lensOf` was the whole lever.** One exported helper —
  `lensName ?? hyperschema.name` — swapped through gql's family naming and dispatch, REST's
  aliasing and paths, the public-door admission, and `def()`; the degenerate case is definitionally
  identical, which is why 635 pre-existing tests never moved.
- **T19 paid for itself on the first ticket after it.** The grouping seam landed in `lifecycle.ts`
  beside the fixpoint and rebind it modifies; the materialization-per-program change touched
  `reads.ts` and `matFor` precisely; the diff reads by concern instead of by scroll-position in a
  2,166-line class.
- **The fixpoint needed no new machinery for coexistence** — latest-per-lens upstream plus grouped
  trial registries downstream, and the additive/rebind decision moved naturally from the binding
  level to the program level (subset-rooted lenses ride additive; a widened union rebinds).

Ten rails green (the eight from P3 plus the per-lens §17 ladder and the REST segment), 639+ tests,
the village's new act (`phase-coexistence.mjs`: Townbook beside FirstImpressions, one public, one
the town's own) and the full 29-act fresh sweep. No migration — the lens name was in the bytes
since slice 2prime, which is what made the whole ticket a serving-side reading.
