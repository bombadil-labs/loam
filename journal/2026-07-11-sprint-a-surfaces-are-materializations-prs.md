## 2026-07-11 — Sprint A: surfaces are materializations (PRs #59–#62, SPEC §17)

GraphQL was never the surface; now the code says so. The seam (PR #60): src/surface/surface.ts
publishes what gql.ts always consumed — Registered, the SurfaceHooks quartet, the
SurfaceGenerator type — and GraphQL became the seam's first witness with zero behavior change
(the whole gate as proof). The second door (PR #61): REST/OpenAPI derived from the same
registrations through the same hooks, contract-tested on three laws — AGREEMENT (the same
view through both doors, _hex for _hex, even anonymously), PARITY (the refusal matrix, row by
row through both), and VERSIONING (§17's amendment, PR #59: publishing is append-only; vN
aliases per name in ground order; the registration hash is the version's true name; a struck
version answers 410 Gone). Phase19 lived it against the almanac, 4/4 twice.

Learnings worth keeping: (1) the auth-parity review earned every token — it found the
anonymous @hash probe was a registration-existence ORACLE over the whole ground (the
410-vs-404 distinction is now the full door's alone), that the 410 could LIE (it answers only
for lawful, name-matching, operator-struck registrations now), and that declaring a name
public would have retroactively published every historical policy — resolved conservatively:
the PUBLIC door serves only the LATEST version per declared name; history is not anonymous.
(2) rhizomatic's resolveView covers every hview bucket, so a bucket the old policy never
named still resolves through its DEFAULT — "v1 without the new prop" is false; the true
statement is "v1 resolves it differently," and both the REST tests and phase19 pin the honest
version (one tags fact: scalar under v1's default, list under v2's all, two content
addresses). This also rewrites tutorial lesson 6's beat. (3) A vacuous smaller-world test
(nothing undeclared existed to be missing) is exactly the reward-hack shape CLAUDE.md warns
about — the fixture now registers a real undeclared Book. (4) Main went red on a merge from
the recurring Windows-CI timeout class (archive fs work under load, vitest's 5s default);
the store contract now carries the same 15s hang-guard the pack test learned first (PR #62).
