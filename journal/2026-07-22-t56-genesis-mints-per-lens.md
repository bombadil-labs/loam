# T56: genesis mints each reading under its own lens

**2026-07-22.** The mint-side member of the H6 family. `assembleGenesis` passed
`reg.hyperschema.name` — the PROGRAM — into the slot the two live mint paths fill
with the lens, and silently discarded `Registration.lensName`. Under §21.7
coexistence a genesis declaring two readings over one hyperschema minted BOTH at
living entity `schema:<program>`; on replay `readRegistrations` keyed
latest-per-lens, both collided, and the LAST in the array won. **Array order — not
the operator's intent — decided which policy served, including behind the
anonymous door** if the public declaration named that program.

The fix derives the lens exactly as the live paths do
(`reg.lensName ?? reg.schema.name ?? reg.hyperschema.name`) and passes that, and
refuses at assembly a genesis where two registrations over one hyperschema
resolve to the same lens name — since they can never both bind, silently dropping
one is the bug. A second pass fixed the collision-key separator (it joined on a
space where the reader dedups on NUL) and cleared a raw NUL byte that had embedded
itself in the source line (the T48 hazard, invisible to grep and diff).

## The migration question, decided

The prosecutor flagged one upgrade side-effect: a named single-reading genesis
whose schema name differs from its program name now mints a *different* living
entity, so a store built pre-fix from such a genesis would gain a duplicate
program-named lens on reboot. Inert for every shipped and realistic genesis
(anonymous schema, or name == program — proven by the green suite). The PR was
opened stacked for the decision. **Myk, 2026-07-22: no migration — pre-release,
no deployed store is affected.** Landed as-is.

This also retires the constraint `test/surface/rest-lens-gate.test.ts` had
documented as unavoidable — "a genesis lens can never differ from the program
name." It always could have; the mint just threw the name away.

**Provenance.** Landed by the overnight churn (branch `fix/t56-genesis-lens-name`,
merged into main after the migration question was answered). Repair of stated
§21.7 behavior. Rails: `test/gateway/genesis-lens-name.test.ts`.
