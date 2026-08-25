# Premortem — §50 "the stock graph" (T244)

Independent premortem, fresh-context subagent, 2026-08-25. Findings in severity order.
Resolutions are recorded in the working spec's "Changes after premortem" section.

## 1. The shallow shapes are caught in a fork
A `ShallowPerson` sibling reading over the Person program is inexpressible (H6: resolveView
covers every HView property; a Schema cannot omit `follows`), and termination is a property of
the child PROGRAM, not the reading. As a separate program, ShallowPerson's body references
Person not at all — so "org installs person" is underivable from the bytes, and decisions 4
("derived, never declared") and story 1 cannot both hold.

## 2. The convergence hash cannot see the graph
`versionedSchemaHash` (registration.ts:374) covers Schema props+default ONLY. Every §50 addition
(expands, edge-reading assignments) lives in the hyperschema body, which the hash excludes. The
divergence warning stays silent on exactly the divergences §50 introduces.

## 3. ShallowReference fails the frozen T85 rail
test/cli/stock.test.ts asserts every STOCK_SCHEMAS entry has props.size > 0 and
writable.length > 0. An { id }-only universal reading violates both, and the rail is frozen.

## 4. Criterion 5 tested the wrong re-run
Same-bytes-twice cannot see the §42→§50 body evolution: the qualified does-not-bind outcome,
old flat prop data orphaned under a new expand, H4 dedup limits.

## 5. Reading-name → shelf-entry-name mapping was non-derivable
`PostThread` and `MessageThread` both belonged to one `thread` entry holding exactly one
registration; the installer's mapping was unstated and non-injective.

## 6. Skip-if-bound gates on the program name — H6
A bespoke lens `Person` over program `MyPerson` is invisible to a program-name check; installing
stock person then contests the lens name and can withhold it from the surface entirely. A
fixture with lens = program cannot see this.

## 7. The moderation strike is ambiguous about which delta
Striking the message BODY claim leaves the member-signed anchor pointer alive: a ghost entry in
every thread view. Criterion 8 named no delta.

## 8. The closure test was self-referential (H10)
A walk that misses a Term shape under-collects identically in production and test; the closure
holds over a set that missed the danglers. Needs a hand-written expectation table.

## 9. "Curator-signed" collections are doctrine the bytes cannot enforce
A shipped entry cannot carry authoredBy; any author's items pointer joins the all list. The
distinction is a trust-mask exercise, not a shelf guarantee, and must be stated as such.

## 10. Depth asserted at one door only
A Schema-narrowed ShallowPerson can hide follows from GraphQL while the HView still gathers
everything and other doors serve it. The gather level must be asserted too.

**Through-line.** Findings 1, 2, 5, 6 are one disease: the catalog annotated edges with reading
names while every hard property is decided at the program/body layer, which neither the reading
name nor the @hash snapshot identifies. Resolved once, in the machinery, before any shape lands.
