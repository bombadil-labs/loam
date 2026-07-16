## 2026-07-12 — The decision slate: every "Myk confirms" gate in the backlog, cleared in one sitting

Myk asked to resolve every deferred decision in TODO.md here rather than leave them for the
design stages. Fourteen calls, all recorded in-place with today's date:

**The contested four.** (1) The §14 immutable-by-default flip is ON — riding §21's migration
wave, so one §20 migration carries both the `schema:` rename and every registration gaining its
explicit `writable` list; strictness lands before renderers and federation grow the ecosystem.
(2) §22's DerivedFn question dissolved on inspection of the substrate: `DerivedFn` is HView in,
signed CLAIMS out — write-side computation, "everything that computes is an author" — so
`resolve` (ground in, VALUE out, perspectival) is its read-side DUAL, not its competitor. Keep
both, touch nothing in rhizomatic; rung (e) synthetics are resolve territory; the §14
derived-fields bullet UNBLOCKS (re-scoped into §22: synthetics refuse writes with a reason);
vocabulary guard: "derived" is reserved for the write side. Signpost: a resolver that wants to
remember what it computed wants to be a derived author. (3) The source-vs-artifact residue:
EXECUTABLE SOURCE — the delta asserts directly-runnable ESM, what you audit is what runs, one
hash; building is the pusher's business; optional provenance claim links to pre-build sources.
(4) Hardening's corruption call: QUARANTINE THE ROW, never the store — isolate, report, boot,
`loam repair` resolves; in a grow-only union store absence is already a legal state (§13), so
an isolated row reads as not-yet-synced. Never brick.

**The slate, confirmed wholesale.** §21: the Schema becomes a first-class entity with
registration demoted to a BINDING (Q1 yes); a VersionedSchema is a distinct snapshot entity,
pinnable without being served (Q2); roots live at the binding/serving layer (Q4). §22: `resolve`
is an override atop an intact Policy, never a second system (Q1); v1 BUILDS rung (a) only, the
design admits the whole ladder, the rung is part of the signed definition (Q3); writability
stays orthogonal at every rung, writes hit the bucket, round-trip honestly not guaranteed, rung
(e) refuses (Q5); a resolver's content address is part of what a VersionedSchema freezes, so
changing one is a new version (Q7). §24: the quarantine is a separate store federating one-way
inbound, design proves it (Q1); quarantine-first is the POSTURE for federated law,
inert-by-default its degenerate case, default flips when quarantine ships (Q6).

What remains genuinely open for the design stages: §21 Q3 (what names a lens) and the naming
pass; §22 Q6 (caching/invalidation contract per rung); all of §23's contract work; §24's
one-way-glass and promotion semantics. The gates are cleared; the design work is real.

Learning: half the "decisions" were facts wearing decision costumes — DerivedFn's signature
answered §22 Q2, the register-payload probe had already answered §21 Q4. Reading the substrate
before scheduling the meeting shrinks the meeting.
