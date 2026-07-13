## 26. As-of reads — the temporal promise, kept

The spec's first sentence calls the substrate **temporal**; §7 calls capabilities
**time-traveled**; §19's tutorial audit names **as-of replay** as explicitly out until built. Three
promises, one debt. The ground already holds everything needed to pay it: every delta carries a
timestamp, every negation is dated, and a materialization is a pure replay of the surviving deltas
in order — so "the ground as it stood at T" is not an archive to keep but a filter to apply. This
section keeps the promise the small way: one optional parameter, no new storage, no second timeline.
The past is not a copy Loam hoards; it is a reading the present ground can still perform.

- **The shape — an optional `asOf` on `query` (Myk, 2026-07-13).** A read may carry a timestamp:
  *resolve this view against the ground as it stood at T*. It is an optional argument, exactly like
  any optional field-argument in a GraphQL query — omit it and you read the present tense (the warm
  materialization, unchanged); supply it and you read a moment. It rides the read, not the
  connection: a single query may ask one node `asOf` last Tuesday and another node as of now, the
  way any two fields carry different arguments. The default is always the live present, so every
  query written before this section existed keeps meaning exactly what it meant.

- **How it threads the resolve path.** Today `query` resolves a node through
  `resolvedNode(name, entity)` → `gather(name, entity)` → `resolveView(schema, hview)`, where
  `gather` reads the warm materialization when one is watching and falls back to `reactor.eval` over
  the live snapshot otherwise (`src/gateway/gateway.ts`). An `asOf` read cannot use the warm
  materialization — that is the present tense by construction — so it takes the one honest path: the
  live `DeltaSet` snapshot **filtered to the deltas in force at T** (author-timestamp `≤ T`, and a
  negation counts only if *its own* timestamp is `≤ T` — a fact un-negated at T reads as present, a
  fact whose retraction had not yet been spoken reads as still standing), then `evalTerm(body,
  groundAtT, entity, registry)` → `resolveView`. Same gather, same resolution program, a narrower
  ground. The `_hex` of an as-of view is as real as a live one's: the same canonical bytes over the
  same schema, an honest content address of a past moment — and `_hviewHex` witnesses the evidence
  that produced it, exactly as it does for a present read (§5). Nothing about resolution is special-
  cased for time; only the delta-set handed to the gather changes.

- **The doors surface it uniformly (§17).** As-of is a read-side projection parameter, so it belongs
  to every door, not to GraphQL alone — "two doors that disagree about lawful data are a bug by
  definition." A surface generator threads `asOf` the way each language names an optional read
  argument: GraphQL as a field argument (`node(id: …, asOf: …)`), REST as a query parameter
  (`GET /:mount/rest/<schema>/<entity>?asOf=<T>`), a compiled read-only projection as one more input
  to its resolve call. The contract test extends to the time axis: one ground, one registration,
  every door, the same `asOf` → the same view, `_hex` for `_hex`. A door may omit the parameter
  (a smaller world is a generator's right; widening never is), but a door that offers it must answer
  the same past every other door answers.

- **Erasure wins, even in the past (§11) — load-bearing.** An as-of read filters the **surviving**
  ground; it is never a replay from a hoard of deleted bytes, because there is no such hoard. Purge
  removes a delta's bytes from every tier, and the store keeps only a signed tombstone that remembers
  *that* it forgot, never *what*. So a delta purged today is simply absent from `reactor.snapshot()`,
  and no timestamp filter can conjure it back: **an as-of read can never resurrect tombstoned or
  purged content, no matter how far in the past T points.** The honest consequence, stated plainly:
  the reconstructible past is the past *minus what has since been lawfully forgotten*. As-of answers
  "the ground as the surviving ground remembers that moment," not "a perfect archive of that moment"
  — and that is correct, not a leak to paper over. Erasure is the stronger promise; where the two
  meet, erasure wins. **This is a required test at implementation time:** erase a delta, then read
  `asOf` a T strictly before its authorship — the purged content MUST NOT appear in the view, in any
  door. A test that can pass without exercising a genuinely purged (not merely negated) delta is a
  bug in the test.

- **The erasure annotation — the exception is visible even when its content is not (Myk, review).** A
  perfect-looking reconstruction of a moment that SILENTLY omits a since-erased fact would mislead: the
  reader would trust a completeness the past no longer has. So an as-of read whose resolved window spans
  at least one tombstone carries an ANNOTATION saying so — the response is flagged, and counted (N facts
  in this window were lawfully forgotten), drawn from the tombstones themselves, which remember *that*
  they forgot without keeping *what*. It reveals nothing erased — only that an erasure fell inside the
  moment being read — turning a silent gap into an honest footnote: *this reconstruction has an exception
  here.* The flag rides the as-of response beside the view (a door surfaces it as it surfaces `_hex`),
  never inside the resolved data, so it colors the reading without polluting the ground. A live
  (non-as-of) read needs no such mark — the present already reflects every erasure as ordinary absence;
  the annotation exists precisely because as-of PROMISES a faithful past and must confess where that past
  was redacted.

- **Subscriptions: the snapshot is in, the replay is out (v1).** `query(asOf:)` is a snapshot of one
  past moment, and it lands here. A **replaying subscription** — "start at T and stream the ground
  forward, tick by tick, as it actually unfolded" — is a different and larger machine (it must
  reconstruct not just a moment but the ordered sequence of moments, and reconcile that replay with
  the live tail) and it is **out for v1**, exactly as §19's tutorial copy already names it. `subscribe`
  keeps meaning "a snapshot of the present, then a patch per change from here forward"; it grows no
  `asOf`. This is the honest seam: a reader who wants the past reads it as a snapshot; a reader who
  wants the future subscribes to it; stitching the two into a replay is a later question, named and
  deferred rather than half-built.

- **Two independent axes: the schema pin and the time pin (§21).** A reader may pin a **schema
  version** (`name@hash`, §21/§17 — the registration delta's content address is a version's true
  name) and a **time** at once, and the two do not interact — they are orthogonal coordinates on one
  reading. The schema pin chooses **which lens** adjudicates; the `asOf` chooses **which ground-
  moment** it adjudicates over. The gateway already resolves an arbitrary registration over today's
  ground (`resolvePinned` in `src/gateway/gateway.ts`: an old lens, the live ground); as-of supplies
  the other half (the latest lens, an old ground); composing both is an old lens over an old ground,
  and the four combinations are a clean square:

  | | ground: now | ground: as-of T |
  | --- | --- | --- |
  | **lens: latest** | the live read | as-of (this section) |
  | **lens: pinned `@hash`** | `resolvePinned` (§21) | full time travel |

  Concretely: both pins narrow the same resolve — the schema pin selects the `(HyperSchema, Schema)`
  the gather and `resolveView` use, the time pin selects the delta-set the gather runs over — so the
  composition is just "gather the pinned body over the ground-at-T, resolve with the pinned schema."
  Cross-schema references still resolve through the live registry, as they do for a bare pin (a pin
  names its own lens, not the whole world's). Neither axis is privileged; a reader who supplies
  only one gets the present value of the other, which is why every existing query keeps its meaning.

- **What it is not.** As-of is not a branch, an edit, or a write into the past — the ground stays
  append-only and grow-only; `asOf` reads, never mutates. It is not a causal clock: timestamps are
  testimony, gameable by construction (§13, "no causal order"), so an as-of read reconstructs *what
  the surviving ground says was true at T by its own dated testimony*, not a globally-ordered
  happened-before. And it is not a promise of a complete past, per the erasure boundary above. Within
  those honest edges it is exactly what the first sentence claimed: a temporal substrate you can
  actually read temporally.

**Provenance.** Design accepted (Myk, 2026-07-13); pending the implementing PR. Section number
**§26 is provisional** (the next free number after §20; §21–§25 are reserved for the in-flight arc).
Nothing here has landed: no `asOf` parameter, door threading, or erasure-in-the-past test exists in
the code yet. The shape (an optional `asOf` on `query`, resolving against the ground as it stood at
T) is Myk's call, recorded 2026-07-13; this file argues it into spec prose and answers the ticket's
scoped design questions (erasure precedence, subscriptions out, the schema-pin × time-pin square) so
the implementing PR can rail and build against a settled design.
