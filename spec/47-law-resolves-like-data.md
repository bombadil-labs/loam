## 47. Law resolves like data

Two sentences, and between them they retired four open defects. A binding is a delta that points a
NAME at an ADDRESS, and the set of live bindings is a **reading** — resolved from those deltas by
declared law, like every other reading in the store. And a binding belongs to the **container** it
was blessed into, not to the store.

The binding table used to be one hand-rolled rule: last write wins, in ground order, per (entity,
lens). That is a Policy — `pick byTimestamp desc` — written as a loop nobody chose. Data had the
whole Policy vocabulary; law had that.

### 47.1 The declared policy

One operator-signed declaration at `loam:binding-policy` names how contested names resolve —
`byTimestamp` (the later registration takes the name), `byAuthorRank` (a direct registration at the
root outranks law that arrived by federation, whatever recency says), or `conflicts` (a contested
name serves *nobody*, and `readContestedBindings` names every contender, so the gap is a stated
refusal rather than a silent 404-shaped hole). Within one entity, versions supersede by ground order
under every mode: a republish is evolution, never a contest.

The declaration is data — changing it is a delta and the next read obeys it; a struck declaration
stops governing (latest-*surviving*, with revival); a malformed one is refused at the door. It
carries an optional container qualifier now, unused, so per-container policy is a later delta rather
than a migration — the same path trust walked from §8 to §28. A store that declares **nothing**
behaves exactly as it always has, loud publish-time collision included: an existing store upgrades
without choosing anything.

Under a declared policy, a name contest stops being a publish-time refusal. Both registrations land
as deltas — resolution is a *reading*, never a write, so the loser's deltas survive unstruck and can
win later if the policy changes — and the publish outcome reports `bound: false` with the policy
named. `byAuthorRank` is the recommended declaration for a federating store: a peer can never take a
name from you, and a federated schema arrives prefixed anyway.

### 47.2 The fast path is a cache with a proof

The bootstrap ships hard-coded, *provided the declared law would resolve to the same shape* — Myk's
rule, made mechanical. `interpretBindingPolicy` is the spec as code, and the equivalence rail holds
the production reader's table to the interpreter's answers over a corpus with a contested name, a
superseded binding, and a struck one. The contest semantics themselves are pinned by hand-written
literals in the sibling rails, because production calls the interpreter and a shared resolver cannot
witness its own bug (H10, stated in the rail's header rather than discovered later).

### 47.3 Many names, one law — and `as` never takes

The adoption witness keys on (address, **the explicitly requested name**): the same law re-blessed
under the same name witnesses — an hourly `blessAll` appends nothing — while the same law under a
*new* requested name is a second binding and publishes. A plain `adoptLaw` with no `as` asked for the
law, not a name, and keeps the address-only witness whole. So two peers who both ran
`loam register --stock note` both bind, each under its own receiver-assigned name, and both serve.

And `as` **names, never takes**: blessing `{ as }` onto a name answered by different-content law
refuses, exactly as the door's own refusal text always promised — only an explicit `supersede` (or a
confirmed re-point) takes a name. A naming request cannot silently become a retirement.

### 47.4 A binding lives in its container

A channel's blessing is published on the pool's own gateway — the operator's act in a narrower
ground. The receiver's root never holds a channel's law; the surface serves it by **aggregation** at
replay, each pool's rows folded in under the channel's own prefix, refolded on bless, on drop, and
after boot resumes the pools. Cross-origin contests resolve by the declared policy before the trial
fixpoint, and rank is **origin rank** — root over channel — because every blessing is
operator-signed and raw author rank would be vacuous.

Dropping a channel therefore takes its law with its data: nothing to retire, nothing to fail closed
over. A peer's sibling readings over one definition (§21.7) arrive as siblings — the channel's
manifest is minted per **lens**, read from each binding's own `schema:<name>` bytes, and
classification honors the row's alias among an entity's live bindings. The peer's exports are the
peer-authored bindings, so a channel never re-blesses its own blessings.

**Provenance.** Landed across [#441](https://github.com/bombadil-labs/loam/pull/441),
[#442](https://github.com/bombadil-labs/loam/pull/442) (the declared policy, and both friends'
names), [#443](https://github.com/bombadil-labs/loam/pull/443),
[#444](https://github.com/bombadil-labs/loam/pull/444) (frozen-rail authorizations),
[#445](https://github.com/bombadil-labs/loam/pull/445) (bindings live in their container), and
[#446](https://github.com/bombadil-labs/loam/pull/446) (sibling lenses). Implementation:
`src/gateway/binding-policy.ts`, the aggregation in `src/gateway/lifecycle.ts`, the policy pass in
`src/gateway/registration.ts`, and the witness, `mayTake`, and alias-honoring `classify` in
`src/gateway/adopt-law.ts`. The §47 rails are the five `test/gateway/binding-*.test.ts` files,
`test/gateway/adopt-as-never-takes.test.ts`, and `test/federation/identical-law-two-peers.test.ts`
and `sibling-lenses.test.ts`. Edge interactions parked with reasoning on ticket T202.
