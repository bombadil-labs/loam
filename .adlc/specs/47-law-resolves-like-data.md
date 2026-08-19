# §47 (working spec). Law resolves like data

**Ticket:** T200 · **Stage:** design · **Tier:** Myk's merge

A binding is a delta that points a NAME at an ADDRESS. The set of live bindings is a **reading** —
resolved from those deltas through a Schema, like every other reading in the store — rather than a
table assembled by hand. And a binding belongs to the CONTAINER it was blessed into, not to the
store.

Two sentences, and between them they answer four open tickets.

## 47.1 What is wrong today

`readRegistrations` resolves the binding table in bespoke code: a Map keyed by (entity, lens), last
write wins by ground order. That is a Policy — `pick byTimestamp desc` — written as a loop instead of
declared as law. Data gets the full Policy vocabulary; law gets one hardcoded rule nobody chose.

And §46's channels bless a peer's law into the RECEIVER's primary ground while the peer's data lives
in a container. Effectiveness is meant to be a property of a container (§28). Reads were scoped to
the pool; the binding was not. Every federation defect this arc found falls through that seam.

## 47.2 The user stories

**S1 — Myk chooses what happens when two things want one name.** He declares how his store resolves a
contested binding. He picks "the newest wins", or "mine outranks a peer's", or "show me both and
serve neither until I say". He does not read code to find out which one he has.

**S2 — two peers on the stock shelf both work.** Myk and his friend each ran `loam register --stock
note`. He opens channels to both. `alice:Note` answers alice's data and `bob:Note` answers bob's.
Neither name is missing, and he did nothing special to get that.

**S3 — a peer's own naming does not reach him.** Alice serves two readings over one shape. Both arrive
under names Myk assigned, and he can tell them apart.

**S4 — severing takes the law with the data.** Myk drops a channel. The lens it served stops existing.
`federate list` and his surface agree, immediately, with no orphan to explain.

**S5 — Myk's own law outranks a stranger's, without ceremony.** He registers `Note`. A peer federates
law that also wants `Note`. His answers; theirs is reachable under its channel's name. He set no
prefix rule and read no collision report.

**S6 — a contested name says so.** Where Myk chose "show me both", the store refuses to serve that
name and names the two candidates, rather than picking one and being quiet about it.

## 47.3 The bootstrap, which decides the size of this

Resolving through a Schema needs a Schema, and Schemas come from registrations. Law-about-law must
start where the fixpoint can reach it.

**The precedent is §8.** Trust is data, and its roster resolves through the substrate — an `inView`
predicate over the very declaration deltas admission reads, one live lens, base law in genesis.

**The gap is that `inView` is a PREDICATE.** trust.ts says so itself: it "cannot validate any of this
(a predicate sees pointers, not shape rules)". A Policy-resolved View is a step beyond a predicate.
Criterion 1 exists to measure that step before anything is built on it, because it decides whether
this section is an afternoon or an arc.

## 47.4 What this folds

T197 (sibling lenses federate as one), T198's second half (two peers with identical law), T199 (a
severed channel's lens fell back to the receiver's ground), and the binding half of T193. None of
them is a separate problem once law resolves like data and binds where it was blessed.

## Acceptance criteria

1. A spike resolves a two-delta binding set through a real Schema and Policy, with its base law in
   genesis and no dependency on `readRegistrations` — establishing that the bootstrap closes before
   anything else is built — verified by `test/gateway/binding-reading-spike.test.ts`.
2. Two bindings naming one address under different names both resolve, and both serve — verified by
   `test/gateway/binding-two-names.test.ts`.
3. Two bindings naming different addresses under one name resolve by the store's DECLARED policy, and
   `pick byTimestamp desc`, `pick byAuthorRank` and `conflicts` each produce their own documented
   outcome — verified by `test/gateway/binding-contested-name.test.ts`.
4. Under `conflicts` the contested name is not served, and the refusal names both candidates —
   verified by `test/gateway/binding-conflicts-refuses.test.ts`.
5. Under `byAuthorRank` the operator's own binding outranks a federated peer's for the same name,
   with no prefix involved — verified by `test/gateway/binding-author-rank.test.ts`.
6. A binding blessed into a container is live in that container and absent from the store's root
   reading — verified by `test/gateway/binding-container-scoped.test.ts`.
7. Dropping a container removes the bindings blessed into it, and a named bystander container's
   bindings still serve — verified by `test/gateway/binding-drop-scoped.test.ts`.
8. Two peers publishing byte-identical law through two channels both bind, each under its own
   receiver-assigned name, and both serve real reads — verified by
   `test/federation/identical-law-two-peers.test.ts`.
9. A peer's two readings over one hyperschema entity arrive as two bindings — verified by
   `test/federation/sibling-lenses.test.ts`.
10. Every existing lens in the repo's suite resolves exactly as it does today, so the change is a
    generalisation rather than a new behaviour — verified by `npm run check`.
11. The declared policy is DATA: changing it is a delta, the next read obeys it, and no restart is
    involved — verified by `test/gateway/binding-policy-is-data.test.ts`.
12. A store with no declared policy behaves exactly as today's hardcoded latest-wins, so an existing
    store upgrades without choosing anything — verified by `test/gateway/binding-default-policy.test.ts`.

## Deliberately out of scope

Changing what a content address covers. `schemaLawAddress` excluding the living name is correct and
load-bearing — it is what makes "the same law under another name" mean something, and this section
depends on it rather than revising it.

## Open questions for Myk

- **Q1.** Should the default policy be `byAuthorRank` rather than latest-wins? It is the safer default
  for a federating store (a peer can never take a name from you), and it is a behaviour change for
  every existing store, which is why criterion 12 keeps today's behaviour as the no-declaration case.
- **Q2.** Is the policy declared per store, per container, or both? Per container is the §28-shaped
  answer and the more work.
- **Q3.** If the bootstrap in criterion 1 does NOT close cheaply, is the fallback acceptable: keep the
  hand-rolled resolution and make its policy a declared parameter rather than a literal? That buys
  S1, S5 and S6 without the full reading.
