# Loam's side of the vNext audit

The question: where did Loam build around rhizomatic instead of on it? Each such place is a
candidate change to the substrate, or it is Loam policy. Six read-only auditors each took one area.
Their reports are the other files here. Each entry cites `file:line` and says CONFIRMED (read in
code) or PLAUSIBLE. This file joins them into themes, and it lists the decisions for Myk.

Audited tree: branch `claude/fervent-bohr-djmmsw` at `a9276e96`, with `@bombadil/rhizomatic` 0.8.0.

| Report | Area |
| --- | --- |
| [time.md](time.md) | timestamps, clocks, ties, as-of, arrival, deadlines |
| [principals.md](principals.md) | keys, operator, users, connections, rotation, custody |
| [admission.md](admission.md) | grants, `authorize`, trust rosters, binding policy |
| [peers.md](peers.md) | containers, pools, channels, federation, wire |
| [law.md](law.md) | registration, adoption, schemas, resolvers, anchors, derivation |
| [forgetting.md](forgetting.md) | tombstones, purge, slates, receipts, sealed payloads |

## Themes

### 1. The substrate cannot say "the deltas that key K governs"

This is the largest theme. It appears in every report.

- Every law reader keeps only deltas signed by the operator's key (`lawfulSnapshot`,
  `lawfulDeltasAt`). About 30 sites do this by hand.
- The operator's key comes from a seed file on the host. It is never read from the ground.
- Well-known anchors such as `loam:trust` merge when two stores are unioned. Only the signer filter
  keeps them apart. In an ungoverned store they really do merge.
- `loadHyperSchema` and `loadSchema` take no trust argument. They hard-code "latest surviving".

Candidates: the principal tier states "peer P is governed by key K" as signed data. The schema and
resolve tiers get a governed read: definitions and law resolved under a trust set that the caller
supplies.

### 2. Suppression trust is a third judgment, and it has no name

SPEC-6 §3 separates transport trust from claim trust. `mask(trust(Pred))` is a third judgment:
whose strikes bind. The spec does not name it, so Loam filled it in four different ways
(`lawfulNegated`, `dataStruck`, `struck`/`standsFor`, `survivalOver`). The result: an admin can
revoke a grant, but cannot strike a trust declaration or a registration.

Candidates:
- Name suppression trust in the spec.
- Add an indexed reactor query, "negated under Pred". Without it, a mask reads the whole store
  (H8), which is why the hand-written walks exist.
- Add a relative trust form, "the striker is the target's author".

### 3. Negation closure is not part of admission or the offered set

A per-delta admission predicate cannot admit "a strike of something admitted". So Loam wraps every
transfer in one of four closure functions. SPEC-6 §4 lens fidelity ("no more, no less") is broken
on purpose (H1; rhizomatic#2).

Candidate: in the federation tier, define admission and the offered set as closed under forward
negation, and state lens fidelity modulo that closure.

### 4. One timestamp does three jobs

- It is a per-process counter: `max(Date.now(), last+1)`. It is not seeded from history, so it can
  go backwards after a restart.
- It is part of identity. So adoption backdates re-signed law to get a stable id.
- It is the author's claim of time.

No arrival time exists. As-of reads use author time, so a late, backdated delta rewrites the past.
One latest-wins reader may leak arrival order on ties. No door checks for timestamps in the future.
Loam imitates arrival with `loam.arrival` stamps, which are not atomic with ingest and need a
crash-debt journal.

Candidates: the ruled three-time split. Arrival is testimony written atomically at admission, and
an index makes "known here by T" queryable. The timestamp-sanity predicate becomes possible once
arrival exists.

### 5. Principals are local conventions

- A key maps to a user by file name (`user.<name>.seed`). A key maps to a connection only in
  `oauth.json`.
- A container belongs to a person by naming convention.
- Rotation is "revoke, then mint a new key". Nothing links the two keys. Author-equality checks
  (retract your own, meters, law adoption) break after a rotation.
- The server holds every user's and every connection's signing seed.
- Every pool shares the operator's key. A channel peer is named by URL, not by key.

Candidates, all in the principal tier: a self-certifying root, key binding ("K acts for P"),
succession ("B succeeds A"), delegation chains, and a chain resolver. Grants, rosters and
`byAuthorRank` can then name principals.

### 6. Admission is not one pipeline

- The append door runs 10 shape checks. The federation door runs 5. Malformed grants and trust
  declarations can enter through federation.
- App guards sit inside admission, and they cause the 20-file import cycle across `gateway/` and
  `federation/`.
- `containerAdmission` exists, but no door calls it.

Candidate: in the federation tier, admission becomes an ordered, composable list of guards:
verify, app guards, predicate, closure, ingest, arrival. A local append is a degenerate admission.
Guards are registered, not imported, which also breaks the cycle.

### 7. A separate-posture container is a hand-built peer

- A separate container does what `Peer.pullFrom` does, but by hand.
- A shared container is not a peer at all: it is a lens over the parent's storage.
- A container read unions several peers' logs at read time, and nothing in the substrate expresses
  that.
- Loam's wire protocol is not the SPEC-6 binding: it has no have-list, no bundles, and it sends an
  id field.
- Each gateway offers one lens. It does not offer one lens per subscriber.
- Module versions use Loam's own set digest.

Candidates: a federated read over N logs, in the reactor or resolve tier; per-subscriber offered
lenses; one normative set digest; Loam adopts the substrate transport binding.

### 8. Forgetting has no place in the substrate

- P2 says deltas are never deleted. Loam deletes bytes, and it says so.
- Refusing re-entry is a Loam admission step. It scans the whole store.
- Purge and the byte check are a storage-seam exception. The reactor cannot forget, so Loam rebuilds
  the gateway after every purge.
- Heal and rehydrate need an exclusion set.
- There is no vocabulary for requests, receipts, a posture or sealed payloads.
- Point reads still serve a tombstoned delta whose bytes survived a failed purge.

Candidates:
- Amend P2: meaning is append-only, and bytes may be forgotten.
- Admission gains a "refuse forgotten id" step, with an indexed forgotten set.
- Storage gains `forget` and a three-state probe: gone, held, unproven.
- The reactor gains `forget`.
- The forgetting tier owns orders, requests, receipts, the posture and sealed payloads.

### 9. Law is data, read by hand

The trust, binding-policy, public and budget readers are SPEC-5 Policies written as loops.
Resolvers ship code inside a binding and run it after the Policy, which SPEC-0 P4 forbids. Derived
authors use a Loam vocabulary with a free-string function id. A lens has no substrate identity,
which is the root of hazard H6. The Schema hash is computed two ways (Sol showed that both give the same bytes).

Candidates:
- `applyPolicy(policy, candidates)` in the resolve tier.
- A resolver hook after the Policy, in the resolve tier, on the derivation WASM ABI.
- The binding-definition vocabulary with content-addressed artifacts, in the derivation tier.
- One Schema hash, and pinned Schema refs.

### 10. Loam defects found on the way

These are Loam bugs whatever vNext decides, except where marked PLAUSIBLE. A recording that pins one
is named.

- `holdsGrant` and `grantsHeldBy` disagree. `holdsGrant` lets an admin-minted `register` grant
  through, and it answers `federate` without looking at scope (`out/admission.holdsGrant.json`).
- PLAUSIBLE: the channel status reader may keep the first record it sees on a timestamp tie
  (`channel.ts:529`). It is not recorded yet.
- `nextTimestamp` is not seeded from the store, so order can go backwards after a restart
  (`out/time.restart.json`).
- The federation door skips half the shape checks.
- `trustRosterPred` ignores the mode, and nothing in `src/` calls it.
- `containerAdmission` has no caller.
- `select`, `freeze` and `offeredDeltas` serve a tombstoned delta if its bytes survived.

## Decisions for Myk

Superseded by [../PLAN.md](../PLAN.md) §6, which merges these with Sol's audit. Kept as the
record of this audit.

1. **Forgetting a strike.** Today, erasing a negation revives its target. Recommendation: a forget
   record keeps the strike's suppression in force, so forgetting never revives anything.
2. **A foreign forget order.** Today, the door refuses it. Recommendation: store it as a request,
   which is data and testimony, never as an order.
3. **Unforget.** Recommendation: keep it local. It is the peer's own choice to readmit an id.
4. **Key custody.** Today, the server holds every user's seed. Recommendation: a delegation chain,
   so the root key can stay with the person. The server holds only delegated keys.
5. **Per-container keys.** The ruling says a peer has a governing key pair. Recommendation: every
   container and pool gets its own key, and the parent's reach is a signed delegation.
6. **Shared-posture containers.** Is a lens over the parent's storage a peer, or a reading?
   Recommendation: a reading. A peer owns its set.
7. **Anchors.** Key-scoped anchor ids, or a governing key read from the ground? Recommendation: the
   governing key from the ground. Key-scoped ids change every anchor's bytes and fix only the
   symptom.
8. **Lens identity.** Should a rhizomatic spec fix "name → (HyperSchema pin, Schema pin)"?
   Recommendation: yes. H6 comes from this gap.
9. **Adoption.** Re-sign foreign law, or admit it by pin under a governed read? Recommendation:
   admit by pin.
10. **Suppression trust.** Should it stay derived from `write` grants? Recommendation: no. Declare
    it separately, and decide whether an admin may strike law.
11. **Time sanity.** Should admission refuse timestamps far beyond arrival? Recommendation: yes,
    once arrival exists. Also: should grants expire? Recommendation: allow it through valid-until.
12. **Tenancy.** `tenantOf` and memberships have no callers. Recommendation: remove them unless a
    story needs them.

## Recordings

`../recordings/` holds the harness. The first slice records grants, trust, `authorize` and the
binding policy over one corpus, in forward and in reverse ingest order. A revert probe on
`grantsHeldBy` turned the recording red. The other reports list more targets under
"Recording targets", ordered by area.
