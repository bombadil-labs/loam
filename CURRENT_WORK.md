# The large unit: the reader's republic (steps 11–14 + the gauntlet)

One arc, four steps, each its own PR through the full loop, in dependency order. The thesis:
**anyone may write; the reader decides everything.** Standing gates publishing (step 11); the
schema is a protocol whose write shapes are declared and guaranteed (step 12); what a store
admits is a live view over its own deltas (step 13); what arrives in a foreign dialect is
normalized by more deltas, never mutated (step 14). Then the village puts it all through its
paces (the gauntlet). Substrate dependency: reflective predicates are FILED
([rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2), Myk's option 2) — the
negation-mask half waits for Myk's rhizomatic iteration; everything below is Loam-side.

## Step 11 — Authors, not owners (IN FLIGHT, branch `authors-not-owners`)

The write gate moves to the author's standing; entities are unowned. SPEC §7 rewritten (on
branch).

1. `authorize()` = operator, OR surviving operator-rooted `write` grant at `loam:store`.
   Targets irrelevant.
2. The ritual-is-dead test: a granted author's multi-pointer delta touching arbitrary entities
   lands with no membership setup.
3. Effectiveness chains untouched: non-operator constitutional deltas now LAND but still bind
   nothing (rework door-refusal tests to landed-but-inert).
4. Negation interim: standing to append; pull-side `admit` blocks hostile federated negations;
   heckler's-veto hazard documented until rhizomatic#2.
5. Grants migrate to `loam:store`; genesis/fixtures/README updated; tenants remain vocabulary.
6. `Gateway.boot` options passthrough.

- [x] Stage 1: plan + SPEC §7/§5/§8 revisions committed
- [x] Tests first: auth.test.ts rewritten as the standing contract (ritual-is-dead, citing-is-
      provenance, grant-lands-inert, writer's-strike-retires-nothing, tenant-as-vocabulary);
      federation gains the admit-predicate negation boundary; genesis gains boot-options
- [x] Implement: accounts.ts rewrite (authorize = standing at loam:store; strikes bind only
      from operator/admin; requirements machinery deleted); boot options; comments; README
      capabilities section rewritten with the negation caveat stated plainly
- [x] `_testing` harness migration (constitute = standing grants only; ritual code deleted)
- [x] Gate: 188/188, format+lint+typecheck+build green (`_testing` now ignored by the gate —
      it is the ephemeral playground)
- [x] PR [#14](https://github.com/bombadil-labs/loam/pull/14) → review (one agent) → resolved:
      the probe-confirmed runner hole (ANY negation retired binding definitions — lawful
      algebra now shared from registration.ts), audit/enforcement divergence pinned as interim
      (second concrete case for rhizomatic#2), transitive revocation + admin self-revocation +
      local rival-definition + local data-negation all pinned, SPEC §7 documents the pre-strike
      hazard and mint/strike asymmetry. Gate: 193/193.
- [ ] **Merge is Myk's button** → then JOURNAL entry on main's branch flow → open step 12
      ← **left off here**

## Step 12 — Writes become claims (queued; SPEC §5 addendum drafted)

The schema as protocol: read program + write discipline, both data, both traveling.

1. **Claim templates** in registrations: named pointer skeletons with arg holes; GraphQL
   mutations derived from holes; one call → one signed multi-pointer delta (the
   host/film/guests/date screening is ONE delta). Trial-proven against the schema's own body at
   registration (specimen → gather → refuse invisible templates).
2. **`_claim`** generic mutation (pointer list in, one delta out) for unanticipated shapes.
3. **`POST /:mount/append`**: pre-signed wire deltas, verified, standing-gated — non-custodial.
4. **`_hviewHex`** beside `_hex` (same-evidence vs same-answer).
5. Primitive-prop mutations remain as the auto-derived degenerate template.

## Step 13 — Trust is data (queued; SPEC §8)

1. `loam.trust` policy: operator-authored mode (`open` | `roster` | `closed`) + optional shape
   requirements; resolved as a live view (constitutional read, operator-filtered).
2. `pullFrom`/gateway build `admit` from the RESOLVED policy per pull — roster edits are deltas;
   the next pulse obeys them. No restart, no config file.
3. Aggregator mode: `open` admits every verified delta (the hackernews scenario); `roster`
   admits named authors; shape requirements compose with either.
4. Surfaced in `serve`/CLI so a turnkey aggregator is `loam init` + one trust delta + `serve`.

## Step 14 — Normalization: divergent dialects, more deltas (queued; SPEC §8)

1. **Translation specs as data**: operator-blessed deltas pairing a recognizer (pred over
   foreign deltas) with an emit template (step 12 shapes), holes bound from recognized pointers.
2. A **generic translator** (one DerivedFn implementation, specs as data) runs as a runner
   binding; emissions are canonical-dialect deltas signed by the translator identity, each
   CITING its source delta id (`translates` pointer — provenance, §9).
3. Originals persist untouched; re-translation is another pass over immortal sources; the
   canonical views light up for data that arrived speaking another tongue.
4. Idempotence: content-addressed emissions keyed on source ids (re-running translates nothing
   twice).

## The gauntlet — the village rides again (after 14)

Extend `_testing/PLAN.md` with phase 8+: a FIFTH store (`cinelog`, somebody else's screening
app with an alien dialect — different roles/contexts for the same ideas) federates into the
almanac running in `open` trust mode; a translation spec normalizes cinelog screenings into the
village dialect; Wren's dossier gains screenings she attended that were RECORDED BY A STRANGER'S
APP; the roster flips mid-run and the next pulse refuses the stranger; flips back and the
backlog normalizes. Plus: multi-pointer claim templates driving the dashboard's events, raw
append from a "client-held key" identity, `_hviewHex` agreement across lenses.

## Standing decisions for this arc

- Reflective predicates = rhizomatic#2 (Myk to iterate substrate; option 2 chosen). Loam does
  admission-side dynamic trust NOW; eval-side negation trust lands when the substrate does.
- Normalization NEVER mutates: foreign deltas are immortal; translations are additional deltas
  with provenance.
- Each step is its own PR through the full loop (tests first, one review agent, neutral
  register, JOURNAL entry).
