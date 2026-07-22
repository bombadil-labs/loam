# T54: the translator door gets the guard the promote door already had

**2026-07-22, overnight churn — the night's last landing.** Filed PLAUSIBLE, the
probe confirmed it: `translate` re-speaks foreign content in the operator's voice
with no reserved-vocabulary guard, while `promotionRefusal` guards the identical
crossing at the promote door.

## The footgun, confirmed

`applyTemplate` takes an emitted pointer's entity id from the recognized —
possibly hostile — source, and its context from the operator-blessed spec
template. The village runs `translate` under the operator seed, so an emission
lands inside `lawfulSnapshot` where the constitutional readers treat it as LAW.

The probe: an operator blesses a spec emitting into `loam.trust`; a stranger
federates a source pointing at `loam:trust`; the pass signs a `closed` trust
declaration AS THE OPERATOR, and `readTrustPolicy` reads it — the whole store's
federation door slams shut. A stranger picks the entity id; the operator's own
blessed template supplies the reserved context. An operator footgun, but exactly
the one `promotionRefusal` exists to remove.

## The fix, and why it is one guard not two

`promotionRefusal` already refuses `loam.*`/`rhizomatic.*` contexts, `loam:` ids,
and negations at the promote door — the same law/data boundary. The asymmetry
between the two doors was unintended, so the fix reuses that guard rather than
writing a second: each emission's constructed pointers run through
`promotionRefusal` before append; a refused emission is skipped. The prosecutor
confirmed it complete (every reserved reader is caught, the source controls only
ids and values, roles and contexts come from the operator template) and added
that a refused crossing deserves its own signal — so `TranslateReport` now
carries a `refused` counter distinct from `unbound`, and the operator sees when
their door was probed.

**Provenance.** Landed by the overnight churn (branch
`fix/t54-translate-reserved-guard`). Repair of an unintended door asymmetry; the
translate suppression-transitivity defect (T58) and the negation-closure finish
(T43) are the delicate siblings left for attended handling. Rails:
`test/federation/translate-reserved-guard.test.ts`.
