# The survivor inventory — the catch-up, measured instead of imagined

**2026-07-23.** The original fear was that the repo's merged code sat behind rails that were never
written — two weeks of ADLC's advisory half with none of its enforcing half. The plan was never to
backfill rails by hand (an author writing rails around merged code shares its premise; the repo
paid for that lesson on 2026-07-21). The plan was to let `hollow-test` measure the gap: mutate the
merged code, and every mutant the suite fails to kill is a missing rail found with no premise to
share and no tokens spent.

## What was swept

Eight clusters over the high-hazard surfaces — the admission door (`ingest.ts`), the law readers
(`registration.ts`), grants (`accounts.ts`), trust (`trust.ts`), the pool fan-out
(`quarantine-pool.ts`), the constitution (`genesis.ts`), the open door (`public.ts`), and row
quarantine (`store/quarantine.ts`) — each against a scoped slice of the suite, plus the whole
store layer swept earlier in the night as part of T67's lap.

## What it found

**The fear was mostly unfounded.** In-target, the suite killed everything on six of the eight
surfaces. Three survivors total, triaged:

- `registration.ts:45` (edgeRoles role-kind inversion) — **false survivor.** The scoped test
  command omitted the write-surface suites; the mutant applied by hand fails 7 tests in
  `link.test.ts` and friends. Covered.
- `genesis.ts:40` and `genesis.ts:58` (the marker timestamp and the clock base) — **real, one
  class**: genesis constants are inputs to content addresses, both mutants keep genesis
  deterministic while silently re-minting every genesis id, and nothing pins the ids themselves.
  Ticketed as **T74** (golden ids for the constitution).

Plus the store-layer survivors already found during T67's lap and ticketed then (T71's freelist
pair, the ride-alongs it names).

## The method's own lesson

`hollow-test --base main` mutates the branch DIFF as well as the `--target`, so a scoped test
command reports cross-file "survivors" that are scoping artifacts, not gaps — the per-cluster
totals looked alarming (20 of 22 surviving on genesis) while the in-target truth was two. Filter
to the target before believing anything, and confirm candidates by applying the mutant by hand
against the suites the scope omitted. One false ticket avoided that way tonight.
