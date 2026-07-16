## 2026-07-10 — The night session: the red team and the road to the Republic

No code tonight — design. Myk has a fringe-tech investor call and wanted the paradigm dreamed
forward, then strained. Both happened; SPEC grew three sections (§11 erasure, §12 the open
door, §13 boundaries & posture) and CURRENT_WORK queues three units: erasure, public reads +
browser client, and the Reader's Republic demo.

What the night established, in order of importance:

- **Erasure is the paradigm's hardest objection and its best demo.** The design (SPEC §11)
  composes entirely from existing vocabulary: tombstones (the store remembers THAT it forgot,
  never what), purge as a named seam exception, admission that remembers the hole, degrees of
  forgetting as purge + tombstone + reassert. Two findings worth their weight: content
  addressing is a CONFIRMATION ORACLE (an on-record link from anonymized copy to old id lets
  anyone brute-force the author against the roster — severance must be total), and the
  heal/tombstone interaction is where the bugs will hide (the vault must not replant what the
  operator erased).
- **The red team's yield (SPEC §13):** no scarcity, no write-time invariants, no causal order,
  no network-wide recall — losses by design, stated proudly. The deepest strategic finding:
  power migrates to defaults (lenses, registries, stewards); the only honest defense is that
  the default layer stays inspectable data with one-delta switching costs.
- **The pitch spine:** blockchain made evidence unforgeable, then wasted everything forcing one
  total order. Loam keeps the unforgeable evidence, replaces consensus with union, and makes
  truth a lens — auditable, chosen, revocable. Every standard objection has one answer worn
  four ways: we deleted the central thing, and the load went to the edges. For the agentic
  decade: writing grants no authority — a million agents may write; nobody has to believe them.
- **The resonance that named the demo:** the Sich — know the land, own a horse, come together
  without ceding sovereignty, have grain to sell, keep an impregnable fortress. It was never
  taken; it was centralized out of existence. The Reader's Republic is the Sich with tooling,
  and the LLM is the elder who teaches every newcomer the land.
