# Current work — Step 5: Accounts & capabilities (full multi-tenant)

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**The model (SPEC §7, no ambient authority):**

- A **tenant** is an entity. An entity belongs to a tenant via a membership delta (filed at both
  the tenant under `loam.members` and the entity under `loam.tenant`); latest claim wins.
- A **grant** is a signed delta filed at a tenant under `loam.grants`: subject (an author
  string), verb (`write` | `admin`). **Revocation is negation** — rhizomatic-native, auditable.
- **Enforcement is gateway code over resolved data**: a write to entity E is authorized iff the
  delta's verified author holds a surviving `write`/`admin` grant on E's tenant. Writes to a
  tenant's own `loam.grants`/`loam.members` require `admin` on it. An entity with no tenant is
  the operator's alone. The **operator** (the gateway's seed) roots the chain: it creates
  tenants, plants the first grants, and is always authorized.
- **Callers act as themselves**: `query(source, vars, { actor: seed })` signs mutations as the
  actor, not the gateway — grants finally have something authentic to key on (audit-1's
  deferral). Raw `append` is enforced by each delta's own verified author.
- **Full multi-tenant** (Myk's decision): a grant on tenant A permits nothing on tenant B.

**Success criteria (from CLAUDE.md):** unauthorized mutation rejected; a grant permits it;
revocation re-denies; grants are auditable via query; tenant isolation holds; the admin chain
works (operator → admin → write); `npm run check` green.

**Sub-tasks:**

- [ ] `test/gateway/auth.test.ts` — tests first: deny-by-default, grant→permit,
      revoke→re-deny, audit query, tenant isolation, admin chain, raw-append enforcement,
      operator bootstrap
- [ ] `src/gateway/accounts.ts` — tenancy/grant claim builders + the authorization resolver
- [ ] `src/gateway/gateway.ts` — actor context; enforcement in mutate + append
- [ ] `src/gateway/gql.ts` — actor threading (context value)
- [ ] Gate green → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
