# T57: a quarantined negation names the strike it stranded

**2026-07-22, overnight churn.** The nastiest of the erasure/negation family, and
the one where the loop's judgment mattered most.

## The bug (H1 meets §25)

When a stored delta fails admission it is quarantined and skipped, and
`deltasSince` reads on. That is a narrowing of the delta-set — and the one
narrowing that cannot carry a negation closure, because the dropped row is
precisely what is illegible. A missing CLAIM contributes nothing. A missing
NEGATION revives its target: a retracted value reads live, a revoked grant
regains standing, a tombstone falls out of the forgotten set. And it was silent.

## Split, not bulldozed

The ticket bundled two fixes: DISCLOSURE (tell the operator a strike fell out) and
RECOVERY (heal replaces the corrupt row past `INSERT OR IGNORE`). Recovery touches
delicate insert/heal semantics on erasure-critical paths — the exact shape where
T55 showed a naive fix can be worse than the bug. So this landed the disclosure
half, which converts a *silent* security failure into a loud, actionable one, and
split recovery to T66 where its replace-invariant gets its own scrutiny.

Two of the three quarantine reasons (id-mismatch, invalid-signature) have already
parsed the claims, so the driver can read the `negates` refs and name the target.
`repair list` now prints, per row, exactly which strike is live until settled.

## What the prosecutor caught, and what my own probe caught

The security pass found `negatesOf` returned only the FIRST `negates` pointer —
but the substrate honors every one, and a foreign delta can strike several targets
at once. A corrupted multi-target negation would disclose one strike and revive
the rest silently: the exact H1 escape the disclosure exists to close. Fixed to
return all targets. It also flagged that the disclosed id comes from *unverified*
claims, so the warning now says "claims to strike (unverified)" rather than
asserting it — a planted row can't masquerade as an authenticated retraction.

Then my own probe caught a hollow spot in the fix's rail: the multi-target test
exercised the warning formatter but constructed the row directly, so it never
touched `negatesOf` — reverting the extraction to first-only left it green. Added
a rail that hits `negatesOf` with a two-pointer negation, and it bites. The
"could this pass with the fix reverted?" question, asked of my own patch.

**Provenance.** Landed by the overnight churn (branch
`fix/t57-quarantine-negation-revives`). Disclosure half of a §25/§11/H1 repair;
recovery split to T66. Rails: `test/store/quarantined-negation.test.ts`.
