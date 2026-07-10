# The large unit: the reader's republic (steps 11–14 + the gauntlet)

One arc, four steps, each its own PR through the full loop, in dependency order. The thesis:
**anyone may write; the reader decides everything.** Standing gates publishing (step 11); the
schema is a protocol whose write shapes are declared and guaranteed (step 12); what a store
admits is a live view over its own deltas (step 13); what arrives in a foreign dialect is
normalized by more deltas, never mutated (step 14). Then the village puts it all through its
paces (the gauntlet). Substrate dependency: reflective predicates are FILED
([rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2), Myk's option 2) — the
negation-mask half waits for Myk's rhizomatic iteration; everything below is Loam-side.

## Step 11 — Authors, not owners — ✅ MERGED (PR #14, journaled)

## Step 12 — Writes become claims (IN FLIGHT, branch `writes-become-claims`)

The schema as protocol: read program + write discipline, both data, both traveling.

1. **Claim templates** in registrations: named pointer skeletons with arg holes; GraphQL
   mutations derived from holes; one call → one signed multi-pointer delta (the
   host/film/guests/date screening is ONE delta). Trial-proven against the schema's own body at
   registration (specimen → gather → refuse invisible templates).
2. **`_claim`** generic mutation (pointer list in, one delta out) for unanticipated shapes.
3. **`POST /:mount/append`**: pre-signed wire deltas, verified; the TOKEN authenticates
   transport, each delta's own verified author is what append authorizes — non-custodial.
4. **`_hviewHex`** beside `_hex` (same-evidence vs same-answer).
5. Primitive-prop mutations remain as the auto-derived degenerate path.

Design decisions (stage 1):

- Template JSON (rides the registration delta under a `mutations` role):
  `{ "<name>": { "pointers": [ { "role", "at"?: {"arg"}, "context"?, "value"?: {"arg"}|literal,
  "each"?: true } ] } }`. `at`+`context` → entity pointer (arg: GraphQL ID, `each` → [ID!]);
  `value` arg → PrimitiveValue; literal `value` → fixed. Exactly one of at/value per pointer.
- Template mutations return a receipt `{ delta: ID! }` (one fact may serve many entities; no
  single view is THE result). `_claim(pointers: [...])` returns the same receipt.
- Trial-prove at publish: substitute sentinel ids/values for args, build the specimen delta,
  evaluate the schema body at each entity-arg sentinel — refuse a template whose specimen no
  entity it touches can see through this schema. At READ, a malformed template is dropped
  (the schema still binds; the surface just lacks that mutation).
- `_hviewHex` computed in resolvedNode from the same gathered hview (hviewCanonicalHex).

Checklist:

- [x] Stage 1: journal step 11; plan + design decisions here
- [x] Tests first: test/gateway/claims.test.ts (8 tests: one-call-one-delta with `each`,
      standing, invisible-template refusal, malformed-template-drops-quietly, template
      evolution, `_claim` incl. shape validation, `_hviewHex` same-evidence/different-answer)
      + POST /append trio in http.test.ts. Field note: at Wren's root the multi-pointer delta
      resolves as the event FROM HER PERSPECTIVE (her anchor pointer elided) — lovely.
- [x] Implement: registration.ts (ClaimTemplates types + parseClaimTemplates + serde in the
      registration delta), gql.ts (template mutations + `_claim` + ClaimReceipt + PointerInput
      + `_hviewHex` meta field), gateway.ts (claimEntity + assertTemplatesVisible + hviewHex in
      resolvedNode/captured streams + boundKey includes templates + fixpoint binds a
      bad-template registration WITHOUT its templates), http.ts (/append + register accepts
      mutations), genesis passthrough, index exports, README (Writes are claims section)
- [x] Gate: 204/204
- [ ] PR → review (one agent, neutral register) → resolve → merge → JOURNAL → step 13
      ← **left off here**

## Substrate adoption — rhizomatic 0.2.0 (PR #17, checks running, merge imminent)

0.2.0 published and adopted: fully additive (207/207 untouched), then `governedGatherBody` +
`tenantSchemaFor` (inView trusted sets — stranger strikes inert, community strikes bind,
revocation un-binds LIVE) and chain-order trusted-then-latest, all pinned (212 tests + village
phase 8, 3/3, watched live on the dashboard: three lenses disagreeing over one ground).
Review resolved EMPIRICALLY — the reviewer's depth-1 claim was wrong one way, our docs wrong
the other; the failing pin taught the truth (lenses reach ONE link: operator-minted admins
move lens+door together; chain-minted standing moves the door alone). The LOOP GREW STAGE 7
(Myk): every step now extends the village (`_testing/` is tracked; `_testing/README.md` keeps
the demonstration ledger; homes/ stays disposable). NOTE: repo now has a `green-gate` CI on
PRs (ubuntu+windows).

## Step 13 — Trust is data (IN FLIGHT, branch `step-13-prep`)

What a store admits at federation is a live view over its own deltas — and with 0.2.0 adopted,
the SAME roster can reach eval-side masks (`inView` at `loam:trust`), one source of truth for
admission and resolution alike.

Stage-1 decisions (carried from the earlier opening, upgraded post-0.2.0):

- **The trust policy lives at `loam:trust` under context `loam.trust`**, operator-authored to
  bind (lawful reads): one delta shape, latest-lawful-wins — `declares` → entity(loam:trust,
  loam.trust); `mode` → "open" | "roster" | "closed"; repeatable `admit-author` primitives for
  roster mode. Helpers: `trustClaims(mode, authors, author, ts)` + `readTrustPolicy(reactor,
  operator) → { mode, roster }`. **Default when no policy survives: `open`** (union is the
  substrate's nature; the operator narrows deliberately). Document.
- **`Gateway.admitFor(): (d: Delta) => boolean`** re-resolves the policy per call; `pullFrom`
  and `federate` use it when no explicit `admit` is given (explicit override wins — existing
  tests keep passing).
- **0.2.0 bonus**: a `trustRosterPred()` builder so schema bodies/policies can reference the
  SAME roster via `inView` at `loam:trust` (extract role of the admit-author pointers) —
  admission and read lenses share one live source of truth.
- Tests first (test/federation/trust.test.ts): default open; roster admits only listed
  authors (delta accounting proves it); closed admits nothing; ONE roster delta flips the next
  pull (live-ness); explicit admit override wins; roster + negation compose (a stranger's
  strike refused at the door); the inView-roster lens reads the same set.
- Village stage 7 (after merge): the almanac gets a trust-policy delta; the dashboard shows
  the roster; an act flips the mode mid-run and the pulse obeys — groundwork for the gauntlet's
  cinelog stranger.

Checklist:

- [x] Stage 1: plan (this section); journal folded (step 12 + adoption entries in order)
- [x] Tests first: test/federation/trust.test.ts — default-open, roster admission with delta
      accounting, closed, one-delta live flip, override precedence, stranger's strike refused
      at door, foreign declarations inert, roster-lens one-source-of-truth
- [x] Implement: trust.ts (trustClaims / trustDefect / readTrustPolicy / trustRosterPred),
      gateway.admitFor + federate default, pullFrom docs, exports, README federation section
- [x] Gate 221/221 → PR [#18](https://github.com/bombadil-labs/loam/pull/18) → review
      resolved: malformed declarations are MALFORMED LAW at append (the lens can't validate
      shape, so the door must — invariant restored provably); ungoverned stores ignore trust
      declarations (no stranger lockout, pinned); closed-means-closed said deliberately;
      removal-by-negation + closed-reopen + bogus/duplicate-mode pins. 224/224, CI CLEAN
- [x] Village stage 7: the door acts VERIFIED LIVE (roster declared → Mallory's forgery
      bounced, accepted 0 → reopened by choice); ledger updated
- [x] MERGED (PR #18) → journaled

## Step 14 — Normalization (IN FLIGHT, branch `step-14-normalization`)

Divergent dialects are normalized, never mutated (SPEC §8): a TRANSLATION is data — an
operator-blessed spec pairing a recognizer with an emit template — executed by ONE generic
translator running as a runner binding; emissions are canonical-dialect deltas signed by the
translator, each CITING its source (`translates` delta-ref pointer). Originals immortal;
re-translation is another pass; idempotent by content-address on source ids.

Stage-1 decisions:

- **Translation spec as data** at `translation:<name>` under context `loam.translation`,
  operator-authored to bind (lawful reads, like bindings/registrations): pointers —
  `defines` → entity(translation:<name>, loam.translation); `recognize` → JSON pred (the
  0.2.0 `Pred` grammar over a candidate delta, evaluated with exported `evalPred`); `emit` →
  JSON template: pointer skeleton whose holes bind from the RECOGNIZED delta
  (`{"from": {"role": "<srcRole>", "part": "id"|"context"|"value"}}` plus literals), same
  shape family as step-12 claim templates.
- **The generic translator**: `readTranslations(reactor, operator)` + a `Translator.attach`
  companion (mirrors Runner.attach) OR a DerivedFn factory installed via the existing runner —
  DECIDE while implementing; simplest honest v1: `translate(gateway, {seed})` — a peer-client
  pass that scans surviving deltas, applies each spec's recognizer (skipping deltas that ARE
  translations or already have one citing them — idempotence by provenance query), emits
  one delta per (spec, source) signed by the translator seed with the `translates` citation +
  fixed timestamp = source's timestamp (determinism → content-addressed idempotence).
- Tests first (test/federation/normalize.test.ts): a foreign-dialect delta (cinelog shape)
  translated into the village dialect; the canonical view lights up; the original untouched;
  provenance pointer resolves to the source id; re-running translates nothing twice; a
  non-operator's spec binds nothing; recognizer misses don't emit; translator needs standing.
- Village/gauntlet stage after merge: the FIFTH store (`cinelog`) with an alien dialect
  federates into the open almanac; a translation spec normalizes; Wren's dossier gains a
  stranger-recorded screening; PLAN.md's gauntlet checks run.

Checklist:

- [x] Stage 1: journal step 13; this plan
- [ ] Tests first ← **left off here**
- [ ] Implement: translate.ts (spec claims/read/apply + the pass), exports, README/SPEC touch
- [ ] Gate → PR → review → resolve → merge → JOURNAL → village/gauntlet stage → arc close

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
