## 2026-07-16 — T17: the index tells the truth, and the memory rail stops being hollow

Audit 2's honesty sweep, applied. The dangerous direction was already clean — no case of the spec
claiming a guard the code lacks — so this is the sweep of the *understating* drift: labels and the index
describing a world from before this week's landings.

- **SPEC.md's preamble and index** now match what IS: §23 is built (five merged slices), §24's full design
  is decided with slice 1 + promote-outputs built, §25/§26 are landed (their own footers said so all
  along; the preamble hadn't caught up). The index is the router; a router that says a built thing is
  unbuilt is lying about the map.
- **spec/21 keeps the one distinction that matters honest**: §21.7's coexistence design is ACCEPTED
  (#114 merged — the DRAFT label is gone) but NOT BUILT — and the §21 *body's* present-tense claim ("the
  registry lifts the old 1:1... so they coexist") now carries its honesty note right where a reader meets
  it, naming T2 as the ticket that makes it true, instead of relying on correctives two hundred lines
  below. Design-landed and built are different words; flattening them was the audit's finding.
- **spec/24's stale pending-labels** (the "awaiting P6" that HAS happened — #111/#114/#115 all merged
  2026-07-16) converted to their landed form, provenance intact.
- **The memory rail is no longer hollow.** The §23.9 test asserted only `status === 500`, which the
  500ms timer alone produces — so it passed identically whether `resourceLimits` worked or not. The two
  bounds turn out to have *different signatures*: the timer says "the renderer timed out", an
  OOM-reclaimed worker dies on the error/exit path and says "the renderer faulted". The rail now asserts
  the memory path's signature specifically, five stable runs to prove it isn't a race. No spec downgrade
  needed — the honest attempt found the distinction was there all along.

628 tests green. Stacked on T16's branch (#120) per the merge order; docs + one test, no behavior.
