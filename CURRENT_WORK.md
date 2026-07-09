# Current work — Step 1: Confirm the rhizomatic surface (the spike)

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):**

- Tests against the **real** `@bombadil/rhizomatic` dependency pass for each SPEC §2 claim Loam
  will stand on:
  - `loadSchema(deltas) → HyperSchema` — schemas are data; publish → load round-trips.
  - `resolveView(Policy, HView) → View` across `pick` / `all` / `conflicts` `PropPolicy`s
    (latest-wins, set-union, contested-kept).
  - A reactor materialization stays current on `ingest`, and `subscribe` fires with a
    `MaterializationChange` naming the changed props.
  - A `DerivationHost` binding fires on ingest and emits deltas (definition → application →
    execution).
- `JOURNAL.md` records what is confirmed vs. what differs from SPEC §2; SPEC is corrected where
  reality differs.
- `npm run check` green (all stages, all tests).

**Sub-tasks:**

- [ ] Read rhizomatic's own tests for schema-deltas, policy, reactor, derivation — learn the
      real call shapes before writing ours
- [ ] `test/spike/schema.test.ts` — publishSchemaClaims → loadSchema round-trip
- [ ] `test/spike/resolve.test.ts` — eval a HyperSchema to HView; resolveView under
      pick/all/conflicts; snapshot hashes stable (`viewCanonicalHex`)
- [ ] `test/spike/reactor.test.ts` — register a materialization; ingest; subscribe fires;
      materializedHex changes
- [ ] `test/spike/derivation.test.ts` — install a DerivedFn + BindingSpec; ingest; outputs
      emitted; pure replay verifies (`verifyPureDerivation`)
- [ ] SPEC §2 corrections (if any) + JOURNAL entry (confirmed vs. differs)
- [ ] Feature branch → PR → adversarial review → resolve → merge

**Left off here:** plan written; next is reading rhizomatic's tests (stage 2 prep), then the
spike tests.
