## 2026-07-10 — Erasure gated to the operator; the village becomes playable (branch work)

Two things this session, both on the `erasure-law` branch (staged, unmerged per Myk).

**Erasure is the instance operator's alone.** Myk's directive: erasure is destructive, so be
maximally conservative — only the operator's own signature may order a record removed, never the
record's author, a grantee, or a peer. `eraseDefect` now runs at BOTH doors (append AND
federation) and refuses any tombstone the operator did not sign; the readers bind only the
operator's; `Gateway.erase` dropped its actor override (a data subject asks, the operator
executes). Erasure does not auto-propagate — a peer refuses a foreign operator's removal-order,
so a forged order can never cascade a deletion across the network. This also resolved the
review's three correctness findings (federated-mismatch, pre-emptive refusal, struck-vs-heal —
`tombstonesIn` builds a probe reactor and defers to `readTombstones`, so it respects lawful
negation). 320/320; phase12 4/4. The lesson worth keeping: **for a destructive operation,
gate hard and gate at every door — the substrate cannot stop a delta being minted, so the store
must be certain never to accept one it did not authorize.**

**The village became a game (Unit 3a).** `dashboard.html` is now a 2D canvas village: buildings,
a palisade with the alien cinelog store beyond it, villager sprites that walk to a building when
an act fires there and speak it in a bubble, a beating federation pulse, a turning mill wheel,
the crash shake, the gate-refusal flash, and click-to-dossier with the three-lens trust duel and
the mill's presence line. The design law that keeps it honest: movement is theater, the acts are
ground — no per-tick deltas, the game is a lens over the same stream. Actor and place are
inferred server-side in `tell()`, so the acts stayed untouched. Verified live in the browser.
