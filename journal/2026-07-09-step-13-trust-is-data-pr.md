## 2026-07-09 — Step 13: Trust is data (PR #18)

What a store admits at federation is configuration, and configuration is a derived view over
deltas that are always updating. One operator-signed declaration at `loam:trust` sets the
door: `open` (the default and the aggregator's stance), `roster` (operator + named
authors), or `closed` (everyone, operator included — closed means closed). `federate` and
`pullFrom` resolve the policy FRESH per call: a roster edit is a delta and the next pulse
obeys it; additions are declarations, removals are negations; and the same surviving deltas
feed the `trustRosterPred` inView lens — admission and resolution share one live source of
truth. The village's Mallory arc grew the door acts, watched live: roster declared, her next
forgery bounced (accepted: 0), door reopened by choice. 224/224.

Learnings worth keeping:

- **When one side of an invariant cannot validate, the OTHER side must refuse.** The review's
  HIGH find: a declaration with a bogus mode smuggled roster entries into the inView lens
  (predicates see pointers, not shape rules) while the door voided the whole declaration —
  "door and lens can never disagree" broken by a typo. The durable fix was at the source:
  `trustDefect` makes malformed declarations MALFORMED LAW, refused at append for everyone,
  and the door's harvest now deliberately matches the lens for whatever survives. An invariant
  between two readers is only as strong as the writer's gate.
- **Union-plus-negation beats latest-wins for SETS.** A fresh declaration only adds; removal
  is striking the declaration that admitted them. That choice wasn't taste — it is the only
  semantics an inView lens can share (a predicate extracts from surviving deltas; it cannot
  do latest-wins), and it is the system's own grammar: revocation is negation, everywhere.
- **Ungoverned stores get no door.** Honoring anyone's declaration would let one federated
  stranger's max-timestamp "closed" brick a pull-only aggregator (confirmed empirically by
  the review). No operator, no lawful voice, door stays open — govern the store to govern the
  door.
