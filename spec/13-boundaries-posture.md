## 13. Boundaries & posture — what Loam refuses to be

Red-teamed 2026-07-10; these are the honest edges, stated proudly. Strong paradigms host
their own opposition.

- **No scarcity.** Pure union cannot express "exactly one, and Alice owns it" — no
  double-spend answer, no inventory invariants, by design. Where ordering is genuinely the
  point, a store may be the ORDERING AUTHORITY for its own narrow context (operator-signed
  sequence claims): centralize exactly there, nowhere else. We did not beat CAP; we chose AP
  and made peace.
- **No write-time invariants.** "Balance never negative" is a lens-level judgment; two readers
  may disagree about whether your invariant held. Loam is for facts and testimony, not state
  machines.
- **No causal order.** Timestamps are testimony, gameable by construction; trust-ordered
  lenses (chain orders, rosters) are the mitigation, not a logical clock. We chose union over
  happens-before.
- **No network-wide recall.** Erasure (§11) is precise and auditable, never magic.
- **Power migrates to defaults.** The reader decides everything — so in practice, whoever
  ships the default lens, the winning registry, the schema-writing steward holds real power.
  The only honest defense: the default layer stays inspectable data with one-delta switching
  costs. Vigilance gets cheaper, never unnecessary.
- **Patterns that answer the standard objections:**
  - _Deprecation-by-rebirth_ (generational compaction): mark the old store read-only, query
    out what matters, seed a new store with those SAME deltas — ids and signatures intact, so
    compaction never launders provenance — and keep the old store as the cold audit trail.
  - _Reassertion-as-endorsement_: re-signing identical content in your own voice is
    endorsement with skin in it; convergent reassertion is a trust signal lenses can consume.
    Deltas never belonged to stores; a dead store orphans nothing.
  - _Coordination is an optimization, not a prerequisite_: a schema registry is just a store
    whose crop is vocabulary — it federates, it has trust rosters, competitors coexist, the
    reader picks. Failed coordination costs one translation delta, written after the fact,
    with provenance.

**Provenance.** Foundational — a posture record, not a build. Drafted 2026-07-10 in the same red-team night session that also spawned §11 (erasure, [#34](https://github.com/bombadil-labs/loam/pull/34)/[#36](https://github.com/bombadil-labs/loam/pull/36)) and §12 (the open door, [#43](https://github.com/bombadil-labs/loam/pull/43)), whose landings are this section's evidence rather than its own PR. These are boundaries stated proudly and held, not code shipped. Full narrative in the [Journal](../JOURNAL.md).
