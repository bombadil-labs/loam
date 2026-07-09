# Step 11 — Authors, not owners: the write gate moves to the author's standing

Myk's correction (2026-07-09, from the village field test): **entities are unowned.** The step-5
model gated writes on the tenancy of every entity a delta touched — an ownership model of ids
that forced the "re-tenanting ritual" (field note #5) and conflated "may this author publish
here" with "may this author speak about this entity." The second question was never ours: it is
answered read-side, by lenses — exactly as foreign grants/registrations/definitions are already
handled. SPEC §7 is rewritten (rides this branch); step 12 (writes-become-claims: templates,
`_claim`, raw-append, `_hviewHex` — SPEC §5 addendum) is QUEUED behind this step.

## Success criteria

1. **`authorize()` gates on standing, not targets**: a delta is permitted iff its verified
   author is the operator OR holds a surviving, operator-rooted `write` grant at the store
   entity (`loam:store`). What the delta points at is irrelevant to authorization.
2. **The village ritual is dead**: a granted author's multi-pointer delta touching arbitrary
   entities (incl. "foreign vocabulary" like `person:wren`) lands with NO membership setup.
   Pinned by a test that would have failed under step-5 rules.
3. **Effectiveness chains survive untouched**: a non-operator's grant-shaped, registration-
   shaped, or binding-shaped delta may now LAND (open writes) but still GOVERNS nothing
   (read-side operator filters — existing tests keep passing, some negative tests move from
   "refused at append" to "landed but inert").
4. **Negation interim discipline**: appending a negation needs the same standing as any claim;
   a federated hostile negation is stoppable by a pull-side `admit` predicate (test + docs);
   the mask-drop heckler's-veto hazard is documented plainly in README until the substrate
   grows dynamic trust predicates (flag raised with Myk).
5. **Grant vocabulary migrates**: standing grants root at `loam:store`; `grantClaims` /
   `holdsGrant` / genesis / README updated. Tenant machinery survives as vocabulary (memberships
   still writable, meaningful to read lenses), no longer consulted by `authorize`.
6. **`Gateway.boot` gains an options passthrough** (offeredLens et al) — the small API gap.
7. **Docs**: SPEC §7 rewritten (done, on branch); README capabilities section rewritten;
   the cross-vocabulary re-tenanting note replaced by the new model.
8. `npm run check` green; feature branch `authors-not-owners`; PR; one review agent (neutral
   register); resolve; merge; JOURNAL.

## Sub-tasks

- [x] Branch; SPEC §7 rewrite + §5 writes-become-claims addendum (step-12 design, marked queued)
- [ ] Tests first:
  - [ ] accounts: standing = operator | surviving store-rooted write grant; revocation by
        negation still bites; admin can mint standing; chain effectiveness (non-operator-rooted
        grant confers nothing)
  - [ ] gateway: multi-pointer delta at arbitrary entities from a granted author lands (the
        ritual-is-dead test); ungranted verified author refused with a standing refusal;
        ungoverned store still welcomes all
  - [ ] constitutional inertness: granted author lands a registration-shaped delta → binds
        nothing (was: refused at door); same for binding definitions — rework existing tests
        that asserted door-refusal
  - [ ] negation: granted author may negate; federated hostile negation suppressed by admit
        predicate at pullFrom (the interim boundary)
  - [ ] boot options passthrough (lens via `Gateway.boot`)
- [ ] Implement: accounts.ts `authorize` rewrite + standing helpers; genesis/README/fixtures
      migration; boot options
- [ ] Rework `_testing` harness constitution (drop entity memberships; store-rooted grants) —
      keep the village runnable
- [ ] Gate → PR → review → resolve → merge → JOURNAL → re-plan (open step 12)

**Left off here:** stage 1 done (plan + SPEC on branch `authors-not-owners`). Next: tests
first, starting with accounts standing semantics. NOTE for resumption: a substrate flag is open
with Myk — dynamic trust predicates for negation masks (see SPEC §7 bullet) — discussion may
adjust criterion 4, but the interim (admit predicates) is self-contained and implementable now.

## Queued next (step 12 — writes become claims, SPEC §5 addendum already drafted)

Claim templates in registrations (trial-proven at registration), the generic `_claim` mutation,
`POST /:mount/append` (raw, non-custodial), `_hviewHex` beside `_hex`. Depends on step 11's
standing model.
