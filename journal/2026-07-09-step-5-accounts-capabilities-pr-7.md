## 2026-07-09 — Step 5: Accounts & capabilities (PR #7)

No ambient authority, anywhere. A tenant is an entity; membership and grants are signed deltas
under three constitutional contexts (`loam.tenant` / `loam.members` / `loam.grants`); revocation
is negation; audit is a query; a grant on one tenant is nothing on another (full multi-tenant,
per Myk's decision). Callers act as themselves (`{ actor }` per request) — mutations are signed
by the actor, resolving audit-1's ambient-authority deferral. Governance begins with the
operator: no operator, no constitution (an ungoverned local store, and a test pins it). 107/107.

Learnings worth keeping:

- **Effectiveness is a chain, not a flag.** The review's sharpest find: grants planted while a
  store was ungoverned would bind the moment an operator opened it (self-signed admin,
  unauthorized strikes). The fix is real capability semantics — a constitutional delta is
  effective only if
  its authority chain roots in the operator — and the chain is TIMELESS: reachability, not
  arrival order, so it needs no history replay and a cycle of self-appointed admins roots
  nowhere. The same discipline applies to strikes (a revocation without standing is inert),
  which also made **un-revocation** work: striking the strike restores the grant.
- **Malformed law is refused for everyone, the operator included** — a grant-shaped delta with
  a bogus verb would sit in the audit looking like law while binding nothing.
- **Every reference channel is governed or closed**: a delta-ref under any role but `negates`
  is refused for non-operators — some future schema might resolve it, and nothing rides free.
- Enforcement reads the reactor's own indexes (`byTarget`/`negationsOf`) — no extra state, no
  ordering dependence, exactly the shape federation (step 9) will need: authority that merges.
