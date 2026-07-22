# T46: a struck adoption leaves the trail — and the prosecutor stopped a regression

**2026-07-22, overnight churn.** The clearest demonstration of the night that the
independent pass is load-bearing, not ceremonial.

## The bug

`adopt.ts` was the one constitutional reader in `src/` that read its vocabulary
without gating on the negation algebra — conspicuous beside eight disciplined
siblings. `readAdoptions` never applied `lawfulNegated`, so a struck provenance
record kept appearing in the audit trail (`adoptions()` lied), and `promoteImpl`'s
presence short-circuit rode that stale trail — re-promoting a value whose record
was struck reported success and landed nothing. The same honesty defect PR #151
fixed for `publish`, reappearing in `promote`.

## Why the one-liner wasn't enough

The obvious fix — add the negation check every sibling had — closed the bug and
**introduced a regression**. `adoptions()` is dual-use: the audit trail AND the
citation-rewrite bridge. Filtering struck records severed the bridge, so a
dependent citing a value whose provenance was withdrawn (a §27 review action this
ticket's own rail blesses) threw "would dangle." Reading the code, it looked
right. The prosecutor traced it.

The rework decouples the two: the bridge reads struck records too (withdrawing a
provenance record does not un-adopt the value — the counterpart still stands and
is citable), the idempotence short-circuit reads the live trail. A re-prosecution
confirmed the regression closed.

## The layers, each catching what the last missed

- The prosecutor caught the regression the code review missed.
- The prosecutor also caught that the stranger-censorship LOW fix (per-record-author
  negation scoping) shipped with no rail — "review the rails, not just the code."
- Staging that rail through the store failed: a governed store's write-standing
  door refuses a stranger's negation outright. So the rail is a unit-level one over
  `readAdoptions` as a pure function — which is where the scoping is actually
  reachable.
- The HIGH the prosecutor found (the short-circuit checks the adopted VALUE by
  presence, not survival) is genuinely T39's separate domain — a refuse-vs-revive
  decision, left to its own ticket and noted in-code.

Five rails, two prosecutions, one regression stopped before it reached main.

**Provenance.** Landed by the overnight churn (branch `fix/t46-adoption-survival`).
Repair of stated §24.3/§27 behavior; the adopted-value survival short-circuit is
T39. Rails: `test/gateway/promotion.test.ts`.
