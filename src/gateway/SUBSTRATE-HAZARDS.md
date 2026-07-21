# Substrate hazards — rhizomatic semantics that bite host code

A distilled defense (ADLC P7). Every entry here is a property of **rhizomatic** that is correct in the
substrate and dangerous in Loam if you forget it. Each one cost us a real bug; each is written as a
question to ask, not a fact to admire.

**Read this before writing code that FILTERS, NARROWS, SUBSETS, or COPIES a delta-set.** That is the
operation these hazards live under. The list is short on purpose — it is a checklist, and a checklist
nobody finishes is worse than none.

Why this file exists rather than a section of the spec: SPEC.md records what Loam **is**, grown only
by landings. This records what will **hurt you** while building it. Different genre, different
lifetime — an entry retires when the substrate changes or the hazard becomes impossible by
construction, not when a PR merges.

---

## H1. `negated` ranges over the OPERAND SET, not over the delta

**The property.** rhizomatic's `negated(d, D)` (SPEC-2 §4.3) asks whether `d` is struck *within the
set `D` being evaluated*. Suppression is a property of the **set**, not an attribute carried by the
delta. Pinned substrate-side as the `select-then-mask-scopes-to-operand` conformance vector.

**The hazard.** Filter a delta-set, keep a claim, drop the negation that struck it — and the claim
comes back **LIVE** in the filtered set. Nothing errors. The result is well-formed and wrong.

**Ask.** *Does this operation narrow a delta-set? Then: does it carry the negation closure of what it
admits?* The closure runs **forward only** — from an admitted delta to the negations **of** it,
transitively (a struck strike revives, so one link is not enough). Following it backward would drag
in targets the filter deliberately excluded, turning a scope into a leak.

**Cost so far.** Three sites. The quarantine's membership seeding edge and the offered lens (T38 —
the second was federation-facing, so peers were receiving claims without their retractions);
`Gateway.freeze`, latent (T38). A fourth of the same family but a different remedy: promotion checked
PRESENCE rather than SURVIVAL, so a retracted pool output could be adopted into canonical history in
the operator's own voice (T39).

**The helper.** `test/gateway/narrowing.ts` — `assertPreservesSuppression`. Any new narrowing
operation should be run through it. Making the next one safe by construction is cheaper than
remembering.

---

## H2. `inView` is stratified at depth 1, permanently

**The property.** No `inView` inside `inView.term` — enforced at PARSE time (`term-json.js`), and
**permanent by design** rather than a gap awaiting a fix (rhizomatic#27). Nesting is *syntactic*
while the things you want to recurse over (container trees, grant chains) have *dynamic* depth, so a
bound would only ever express the case you do not have.

**The hazard.** A trusted set resolved live inside a lens reaches exactly ONE link. Write a recursive
authority chain expecting the lens to walk it and you get a silently shallow answer.

**Ask.** *Does this need to walk a chain?* Then pick a route by **freshness requirement**:

- **Host-flatten to `inSet`** — zero lag, re-resolved per request, no provenance. Use where a change
  must bind on the very **next read**. Revocation is the motivating case: §7 promises "revoking a
  grant un-binds its author's strikes on the very next read."
- **Derived author (L7), then a depth-1 `inView` over its emissions** — any depth, cycles handled
  once, real provenance (`derived.from`, `explain`, replay-verifiable). Costs **one derivation hop of
  lag**.

They **compose** — the same system may run the first on the binding path and the second alongside as
an audit artifact. They answer different questions ("does this bind now?" vs "why did it bind, and
can a third party check?"), so this is not a choice.

**And if you flatten: do not cache the result.** A stored trusted set goes stale silently into a
well-formed wrong answer. Compute per request; the guard is the absence of a cache, not a detector
(SPEC §28.6).

---

## H3. A gather body's `reading` is part of the body, not of the lens

**The property.** `expand.reading` lives in the **gather body** (SPEC-2 §4.5), and a HyperSchema body
is content-addressed data, publishable as deltas (SPEC-3 §5) — **portable by design**.

**The hazard.** Sibling lenses over one HyperSchema necessarily share the child's reading. Two
parties that adopt the same published body share its readings **even in different stores**. "Separate
stores separate readings" is false, and it is the kind of false that reads as obviously true.

**Ask.** *Do these two readers need to read embedded children differently?* Then they need different
**bodies**, not different lenses and not different stores. (Two bodies differing only in `reading` are
different programs with different `termHash`es, so a store may hold both without collision.) The
escape — `reading: {hole: …}` bound at `fix` time — is **unbuilt**, pending a real consumer.

---

## H4. A delta's content address includes its author and timestamp

**The property.** `claimsToCbor` commits to `{author, pointers, timestamp}`. The id is a hash over
all three.

**The hazard.** Two parties asserting the same fact mint **different** deltas. Any scheme that
assumes "same claim → same id" across authors is broken: existence-by-construction checks, dedup
across parties, "did someone already say this."

**Ask.** *Am I relying on two parties producing an identical delta?* They cannot, unless they share a
key. This is also why promotion must **inherit the source timestamp** to be idempotent (§24.3) — the
same operator re-signing the same content at a different moment would otherwise mint a new id every
time.

---

## H5. 0.9.0 parses fail-closed on unknown KEYS, not just unknown tags

**The property.** From 0.9.0, a misspelled or leftover key that used to be dropped silently throws by
name. Correctly-authored terms are unaffected and no canonical bytes move.

**The hazard.** Loam generates terms in at least four places — the governed gather body, the
lawful-strikers predicate, the trust roster predicate, and container membership terms. A stale key in
any generated term becomes a hard failure at upgrade.

**Ask.** *(At the 0.9.0 upgrade.)* Do a deliberate pass over every generated term. Do not trust the
suite to surface it; a term that is only built on an uncommon path will not be exercised.

---

## Adding to this file

An entry earns its place by having **cost something** — a bug, a near-miss caught in review, or a
substrate answer that contradicted what we believed. Not by being interesting.

Write it as: the property (with its SPEC citation), the hazard (what goes wrong, and whether it is
loud or silent), the question to ask, and what it cost. **The question is the load-bearing part** —
this file is used by someone scanning for "does this apply to me," and a hazard they cannot recognize
in their own diff is a hazard they will ship.
