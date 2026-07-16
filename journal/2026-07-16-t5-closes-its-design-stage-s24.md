## 2026-07-16 — T5 closes its design stage: §24 in full, reconciled with §27 (PR pending Myk)

The quarantine's full design memo, on branch `design/24-quarantine-full`. Most of §24 was already drafted
(#108) and its foundation built (#109); what this pass adds is the part that could only exist NOW — the
reconciliation with §27, which landed after the draft and reframed the quarantine as a container. New
§24.10 pins it clause by clause: the separate-store proof is BOUNDED to the untrusted domain by §27.1's
property-vs-wall spectrum (not weakened — a quarantine is definitionally the wall case); slice 1's `admit`
predicate is the degenerate form of §27.6's membership-is-a-query; promote-outputs (#111) IS §27.3's
adoption-merge, and scope-merge never applies behind the glass; §24.2's one-way tree and §27.4's
live-tree/frozen-DAG rule are one law (a frozen quarantine is a module version, no longer a quarantine).
Flagged precisely: rhizomatic 0.6.0's `difference`/`intersect` are Term-layer operators — they compose
scopes at the seeding edge; they are NOT usable inside `inView` predicates, whose depth-1 stratification
is unchanged.

The §24.8 rail grew a seventh test (green, 7/7): the widest scope any §23.9 opt-in interop read could ever
assemble — primary ⊎ pool, both reactors and both backends at rest — holds zero bytes of a purged delta,
asserted byte-for-byte by content string, not just by id. A design rail: when the first-class scope
surface lands, the test re-points at it. Premortem finding folded into §24.8: the erasure fan-out reaches
pools attached IN-PROCESS; a durable pool that outlives the primary's process and is never re-attached is
a replica no fan-out reaches — so a durable quarantine must be REGISTERED for boot-time re-attachment or
it may not be durable. Learning: every replica-shaped feature must answer "who re-attaches you after a
restart?" before it earns a durable backend.
