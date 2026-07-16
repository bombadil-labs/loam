## 2026-07-14 — §26 as-of and §25 hardening land; the arc parks on the Schema Schema

Two implementations landed off the design briefs, both built by supervised agents against the
merged spec and both reviewed before merge:

- **§26 as-of reads** (#84). An optional `asOf` on `query` resolves the view against the ground as
  it stood at T — same gather, same resolution program, a delta-set filtered to `timestamp ≤ T`.
  Erasure wins even in the past (a purged delta can never reappear, proved by a test that purges a
  genuine delta), and the annotation ENUMERATES the discontinuity timestamps in the window (Myk's
  refinement: name the moments, not just count them) — a read-only `forgottenSince` over the lawful
  tombstones, surfaced as the `_asOf`/`_forgotten` door meta-fields alongside `_hex`. Non-breaking.
- **§25 hardening** (#85 pieces 1–4, #86 piece 5). A bad row is quarantined on boot and the store
  never bricks (the constitutional core is the one loud exception); `loam repair` lists and resolves
  the pen; the `loam:`/`loam.` id prefix is a lint-able reservation, not a gate; and per-author door
  budgets are operator-signed config — OPT-IN and off by default, volume metered as grow-only
  footprint, the limit shape extensible by addition so a future rate/bytes dimension never needs a
  migration. §12's stranger caps stay law; this is the trusted ceiling above that floor.

Two rhizomatic issues filed against the coming release: #10 (the `loadSchema`/`publishSchemaClaims`
naming lag) and #11 (add a `SCHEMA_SCHEMA` for self-hosting parity with the HyperSchema Schema). The
second is the wall §21's build hit: the design presumes a Schema Schema that frozen rhizomatic does
not expose. So the §21→§24 spine parks until the release lands — then §21 rebuilds against the real
Schema Schema and folds everything (the `schema:`→`hyperschema:` rename + T1's immutable-default
flip) into one migration wave.

Learning: the design briefs read complete but presumed substrate that didn't exist — only the build
surfaced it. The safety valve (stop-and-decompose rather than guess on a breaking surface) is what
turned that into a filed issue and a clean decomposition instead of a wrong PR. And the off-spine
work (as-of, hardening) had no such dependency, so it shipped while the spine waited — the loop
churning everything that could move without a human, stopping only where it genuinely needed one.
