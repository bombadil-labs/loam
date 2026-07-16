## 2026-07-16 — the arc lands whole; the queue restocked for what follows

Myk merged the week in one sitting: #113 (rhizomatic 0.6.0), #115 (§24 in full, §27-reconciled), #111
(promote-outputs, hardened by the fresh-eyes review pass — chain closure through the trail, inherited
timestamps, the facts-not-law gate), and #114 (§21.7 coexistence, with the grouped-serving-surface model
that dissolved the double-dedup footgun he rightly flagged). The §21→§27 design arc is now entirely IN
SPEC; nothing of it remains speculative.

The queue is restocked to match what landed, per the after-a-ticket-lands rule:
- **T2 flips design → build.** Its design stage closed with #114, so the body now carries the §21.7
  contract as build instructions: the grouped serving surface (programs → lenses, computed once, no
  consumer sees the flat list), the two seam refusals, the rebind rule, the byte-identical degenerate
  case as a rail, and the honest no-migration verdict.
- **T15 authored** — the first §27 implementation slice: membership select/watch as a first-class
  gateway surface, the quarantine's seeding edge generalized from the admit predicate to a membership
  Term, and the composable (nested) difference scoping 0.6.0 bought, proven through the seeding edge.
  Deliberately narrow: no manifest (still an open §27.6 design question), no Merkle-set identity, no
  Container lifting — each named as its own later ticket.

`adlc merge-forecast`: T2 → T15, width 1 (they share the gateway). Both are Myk-merge-flagged where it
matters — T15 touches the federation/quarantine seeding surface outright, and T2 rewires the serving
loop's core.
