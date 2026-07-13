## 7. Object-capability & accounts

No ambient authority, anywhere. A user's write permission and a function's effect access are the same
construct: an explicit, signed, reified **capability grant** (a delta granting a reference). Accounts
/ capabilities are core genesis schemas; enforcement is gateway code, rooted in an operator identity.
Capabilities are auditable, time-traveled, revocable. Multi-tenancy at deployment scale is the mount:
one mount = one store = one isolated world.

**(revised 2026-07-09 — authors, not owners.)** The original step-5 model gated writes on the
tenancy of every entity a delta touched — an ownership model of ids. That was wrong, and Myk
called it: **entities are unowned.** Pointer resolution is string matching; nobody owns an id; a
delta is never a free-floating fact about an entity but an assertion _from a perspective_ — some
author, originating on some instance. Anyone with standing may point at anything. The question is
never "may this be said?" but "who listens?", and that question is answered on the
**read/merge/accept side**, by composable policy — exactly as the constitutional slice already
works (foreign grants, registrations, and definitions merge freely and bind nothing).

- **The write gate is the author's standing on the instance, not the target's tenancy.** A store
  signs and persists only for authors its operator's chain granted `write` — a grant rooted at
  the store entity (`loam:store`), minted by the operator or an `admin` grantee. It is a
  publishing relationship ("may this author publish through this door"), resource gating rather
  than truth gating. The operator needs no grant; an ungoverned store (no operator) welcomes any
  verified author. Callers act as themselves (`{ actor }` per request); grants key on authentic
  authorship; **revocation is negation**; audit is a query.
- **Effectiveness is a chain, unchanged.** A grant governs only if it roots in the operator; a
  registration binds only if the operator authored it; a binding definition installs only if the
  operator blessed it. Open writes make nothing governable that wasn't — they only stop
  pretending the store can fence what ids mean.
- **Negations are assertions like any other.** Standing to append one is the same publishing
  standing; _whose negations a reader honors_ is lens policy. Constitutional readers
  (`grantHeld`, `readRegistrations`, `readBindingDefinitions`) honor only lawful strikes — the
  operator's, or an effective store admin's. **For DATA, the principled lens landed with
  rhizomatic 0.2.0** ([rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2)
  delivered): `governedGatherBody(operator)` masks with an `inView` trusted set — the operator
  plus the operator's grantees, resolved from the live delta-set — so a federated stranger's
  strike is inert while the community's bind, and revoking a grant un-binds its author's
  strikes on the very next read. `tenantSchemaFor(operator)` gives the AUDIT view the same
  discipline (operator + operator-minted admins — what `standsFor` demands), so **audit and
  door move together through the chain's first link** (an operator-minted admin's strike binds
  both — pinned by test). Residuals, stated plainly: the trusted sets reach ONE link — subjects
  of OPERATOR-authored grants surviving OPERATOR-signed strikes (stratification bans
  inView-in-inView, so the chain cannot recurse inside a lens) — therefore standing minted by
  an admin binds enforcement but never enters a lens's trusted set, and an admin's revocation
  bars the door without, by itself, removing the revoked author from the trusted sets; plain
  `mask drop` bodies still honor every present negation BY CHOICE; pre-striking a
  not-yet-arrived delta id remains possible for whomever a lens trusts (narrowed, not
  confined, by governed bodies); and per-tenant admin chains still mint community-vocabulary
  grants while constitutional strikes require store standing — revisit with trust-is-data
  (step 13).
- Tenant machinery (`loam.tenant` / `loam.members` / `loam.grants`) survives as **vocabulary for
  author-communities and read lenses**, not as write fences.

**Provenance.** Landed — [#7](https://github.com/bombadil-labs/loam/pull/7) (step 5: tenants, membership, grants as signed deltas), [#14](https://github.com/bombadil-labs/loam/pull/14) (step 11: the authors-not-owners revision — the write gate moved to author standing), and [#17](https://github.com/bombadil-labs/loam/pull/17) (rhizomatic 0.2.0 adoption: `inView` lenses). Lives in `src/gateway/accounts.ts` (`authorize`, `holdsGrant`, `governedGatherBody`, `tenantSchemaFor`, `constitutionalDefect`). Key correction (Myk, out of the village field test): entities are unowned — the write gate asks only "does this author have standing," never what the delta points at; truth-telling moved entirely to the read/merge side.
