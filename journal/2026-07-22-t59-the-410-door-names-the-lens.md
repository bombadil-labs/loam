# T59: the 410 door names the lens, and a backlog that forgot to bury its dead

**2026-07-22, overnight churn.** The withdrawn-registration reader named a struck
registration by its hyperschema's name — the program — while the §17 410 door
compares that name to a lens taken from the URL. The H6 tell exactly: a
program-name comparison sitting among `lensOf` siblings.

## The two wrong answers

Under §21.7 coexistence, where a lens name differs from its program:

- **Under-answer**: strike `PlantClassic`'s registration, ask for its hash under
  `PlantClassic`, and the program-named record made the comparison miss — a bare
  404 where §17 promises 410. That difference is the whole signal to an
  integrator: *withdrawn, stop retrying* versus *you have the wrong hash*. It
  degraded for every lens whose name differs from its program — every lens §21.7
  exists to enable.
- **Over-answer**: ask under the *program* name, which no lens need serve, and
  get a 410 confirming the hash was a lawful registration on the strength of a
  withdrawal belonging to a different reading.

The fix takes the name from `lensNameOf` — the reader the sibling latest-per-lens
and version readers already use — keeps `loadHyperSchema` only as the
loadability guard, and renames the field `schemaName → lensName`, typed
`LensName`, so the next reader cannot silently take it from the program again.
The prosecutor returned clean on all five angles, including that the rail's
over-answer case genuinely reaches the withdrawn branch rather than passing
trivially.

## The backlog forgot to bury its dead

Renaming the field needed an audited rails bypass, because `registration.ts` is
a rail T63 declared — and T63 had **landed** (#159). The freeze that should have
lifted at merge did not, because the P6 motion of removing a realized ticket from
`.adlc/tickets.json` was skipped when Myk merged the PRs by hand. So T42, T55, and
T63 all sat in the backlog marked `in_review` with active file rails, silently
blocking legitimate follow-on edits to `registration.ts`, `eslint.config.js`,
`mirror.ts`, and the erasure files.

This landing prunes all three — each confirmed merged first — releasing their
rails. The lesson for the loop: a rail is a promise scoped to a build; when the
build lands, the promise is kept and the freeze must lift. Leaving it frozen turns
a trust root into a tollbooth.

**Provenance.** Landed by the overnight churn (branch `fix/t59-withdrawn-410-lens`).
Repair of stated §17 behavior; both wrong outcomes railed at both levels, prosecutor
clean. Rails: `test/surface/withdrawn-410-lens.test.ts`.
