## Containers, channels, pools and federation: where Loam built around rhizomatic instead of on it

Main finding: a separate-posture container is already a SPEC-6 `Peer` in all but name. The inbox pools and channel pools are the same kind of peer. Loam rebuilt the parts of the peer by hand: the offered set, admission, the negation closure, arrival records and the wire format. In several places its version disagrees with SPEC-6 on purpose. I did not edit, run or check out anything.

### 1. Forward negation closure appears in four copies around every transfer
- **Loam does:** `withNegationClosure` (`src/gateway/ingest.ts:366`) runs on the offered lens (`:485-495`) and on container seeding (`memberAdmit`, `src/gateway/container.ts:~1711`). `withBatchNegationClosure` (`ingest.ts:423`) runs on inbound admission (`federateImpl`, `:680`). `withNegationClosureAcross` (`ingest.ts:395`) runs on multi-ground gathers.
- **Substrate gap:** SPEC-6 §4 says lens fidelity is "offered ≡ `eval(lens, log)` — no more, no less". Loam breaks this on purpose (H1). SPEC-6 §5 step 3 admission is a single-delta `Pred`, so it cannot express "admit a strike of what you admitted". The comment at `federateImpl` names rhizomatic#2.
- **vNext candidate:** the federation tier defines the offered set and admission as forward-negation-closed. Lens fidelity is then stated modulo that closure. One closure is written over a "grounds" interface.
- **Class:** rhizomatic contract · **Tier:** algebra (closure), federation (fidelity) · **Confidence:** CONFIRMED

### 2. Loam uses its own wire protocol, not the rhizomatic binding
- **Loam does:** it serves `GET /:mount/federate` → `{deltas: WireDelta[]}` with an `id` field (`src/server/http.ts:3432`, `src/federation/wire.ts:41-63`). Every pull takes the whole offer, with no WANT/`have`. There are no BUNDLEs, and unsigned deltas are refused outright (`ingest.ts:659`). Two HTTP clients do the same fetch: `pull.ts:196` and `channel.ts:2769` (`sourceFor`).
- **Substrate gap:** SPEC-6 F5 is `POST /rhz/v0/sync {have}` → `{bundles, loose}`, with no id on the wire. F2 is have-list reconciliation. F3 lets members covered by a manifest travel without a signature.
- **vNext candidate:** Loam adopts the substrate transport binding and adds only authentication and a size cap. That leaves one pull client.
- **Class:** rhizomatic contract · **Tier:** federation · **Confidence:** CONFIRMED

### 3. A separate container is a Peer built by hand, and it shares the operator's key
- **Loam does:** `openSeparate` (`container.ts:1527`) calls `Gateway.open(backend, {seed: gw.options.seed})`. It seeds the pool with `pool.federate(gw.offeredDeltas(), admit)` (`reseed`, `~1718`), and the membership Term acts as the want-side filter. This is `Peer.pullFrom` (`peer.ts:56`) done by hand. `quarantine-pool.ts:18-24` makes the shared operator seed load-bearing, because the operator's tombstones must pass `eraseDefect` inside the pool.
- **Substrate gap:** SPEC-6 §3 says `PeerId` = public key. Every pool has the parent's PeerId, which contradicts the settled ruling that a container has its own governing key pair.
- **vNext candidate:** each container has its own key pair. The parent's authority over it (erasure reach, the envelope) becomes a delegation the principal tier can express.
- **Class:** decision for Myk · **Tier:** principal / federation · **Confidence:** CONFIRMED

### 4. A shared-posture container is not a peer at all
- **Loam does:** a shared container is a membership Term evaluated over the primary ground (`containerScopeImpl` `membersOf`, `container.ts:~905-926`). It has no set of its own, no admission and no arrival records.
- **Substrate gap:** the ruling "a container is a peer" does not cover a peer defined as a lens over another peer's storage.
- **vNext candidate:** either (a) a Peer whose log is a view over a host's log, or (b) shared containers are reclassified as "readings", not containers.
- **Class:** decision for Myk · **Tier:** federation / storage · **Confidence:** CONFIRMED

### 5. A container read composes several peers' logs at read time
- **Loam does:** `containerScopeImpl` (`container.ts:873-1000`) takes the union of the parent ground and every `inboxOf` pool (so channel pools too). It subtracts excluded containers, then closes over all the grounds together. `connectionScopeImpl` (`:1267`) walks the subtree the same way.
- **Substrate gap:** the reactor (SPEC-4) and Peer (SPEC-6) read only one log. Nothing expresses "read the union of N peers without copying". NOTE-12 §5's local aggregator assumes copying through `pullFrom`.
- **vNext candidate:** a reactor or resolve-tier "federated read" over several logs, with closure across all of them. This is the in-process transport binding with zero copies.
- **Class:** rhizomatic contract · **Tier:** reactor / resolve · **Confidence:** CONFIRMED

### 6. Arrival records exist twice, and neither is atomic with ingest
- **Loam does:**
  - `loam.arrival` stamps (`channel.ts:316-470`): receiver-signed, with an "optimistic debt" journal to cover the crash window between `federate` and the stamp (`~1545-1600`).
  - §59 `received` events (`loam.local.channel.event`, through `receiveChannelOfferInCommit`, `ingest.ts:163`).
- **Substrate gap:** SPEC-4 §7 says wall-clock receipt MAY be recorded as annotation deltas under the reactor's key. SPEC-6 §3 treats relay provenance as optional. There is no ingest that returns an arrival record in the same commit.
- **vNext candidate:** federation-tier ingest writes one arrival record per admitted batch, atomically. This matches the ruling that arrival time is the receiving peer's testimony. It removes both Loam copies and the debt machinery.
- **Class:** rhizomatic contract · **Tier:** federation · **Confidence:** CONFIRMED

### 7. The inbox counts only later writes by trusting the author's timestamp
- **Loam does:** `bindConnectionImpl` (`container.ts:~2070`) sets `boundAt = gw.nextTimestamp()`. Pool membership is then "this key's deltas, timestamped after boundAt".
- **Substrate gap:** that is the author's claim about time, not the receiving peer's testimony about arrival. There is no arrival clock to select on.
- **vNext candidate:** membership is a predicate over arrival records (item 6).
- **Class:** rhizomatic contract · **Tier:** federation · **Confidence:** CONFIRMED from the code and its comment. I did not read the membership Term in full.

### 8. Per-container admission is declared but never consulted
- **Loam does:** `containerAdmission` (`container.ts:734`) is only exported (`src/index.ts:134`) and has no internal caller. The channel door calls `ground.federate(...)` with no `admit` (`channel.ts:~1622`; `ingest.ts:196`). The pool therefore applies `admitForImpl` over its own reactor's store-wide `loam:trust`, which is a seeded copy of the primary's.
- **Substrate gap:** none. `Peer.admission` (`peer.ts:30`) is exactly a per-peer rule. Loam does not use it.
- **vNext candidate:** each Peer's admission comes from its own declaration (§28.6). Until then this is a gap in Loam's policy.
- **Class:** Loam policy, possibly a bug · **Tier:** federation · **Confidence:** CONFIRMED that there is no caller. Whether the §28.6 promise is broken is PLAUSIBLE.

### 9. Loam's own lawfulness checks sit inside admission, and they cause the import cycle
- **Loam does:** before the Pred, `federateImpl` (`ingest.ts:651-676`) refuses protected local events, tombstoned ids, public/artifact/tombstone/slate defects and slate citations. Protected ingress comes from `protectedIngressIds` in `federation/local-channel-events.ts:72`. That file imports `gateway/container.ts` and `federation/channel.ts` (`:12-13`). `connection-authority.ts` imports `channel.ts` as well. The result is the 20-file value cycle across `gateway/` and `federation/`.
- **Substrate gap:** SPEC-6 §5 gives a fixed four-step pipeline. It has no stage for app guards and no concept of a "receiver-only context".
- **vNext candidate:**
  - Admission becomes an ordered, composable list of guards (verify → app guards → Pred → closure → ingest), owned by the federation tier.
  - Contexts that a peer may never supply become a declared substrate notion.
  - The boundary then falls between `ingest.ts` and `local-channel-events.ts`: Loam registers guards and does not import channel state into the ingest door.
- **Class:** rhizomatic contract, plus Loam policy for the guard contents · **Tier:** federation · **Confidence:** CONFIRMED

### 10. Dropping a pool has to be proven at the bytes, and erasure has to reach child peers
- **Loam does:**
  - `drop` purges, then checks `holds` and refuses if anything survives (`container.ts:~1790-1830`).
  - §59 adds `holdsAny` and `ids` to the store contract.
  - `openSeparate` settles "erasure debt" before a pool attaches (`:1570-1600`).
  - Tombstones always pass the seeding edge (`reseed`, `:1722`).
- **Substrate gap:** SPEC-8 has no whole-store probe. SPEC-6 §7 does not cover forgetting across a parent → child peer relation.
- **vNext candidate:**
  - The storage tier gets `holds`, `holdsAny` and `ids` with fail-closed semantics.
  - The forgetting tier gets "drop a peer" and tombstone propagation to child peers.
- **Class:** rhizomatic contract · **Tier:** storage / forgetting · **Confidence:** CONFIRMED

### 11. Each gateway has one offered lens, and the offered set subtracts slates
- **Loam does:** there is one `options.offeredLens` per gateway (`gateway.ts:227`). `offeredDeltasImpl` subtracts `egressWithheld` (`ingest.ts:496`). `/federate` requires the operator token (`http.ts:566`). §46 says federation is "container to container", but the sending side offers the whole mount.
- **Substrate gap:** SPEC-6 §4 HELLO carries `offeredLenses[]`, and NOTE-11 says one published query per subscriber. `peer.ts` has a single lens.
- **vNext candidate:** a Peer offers a lens per subscriber (publish/subscribe). Slate withholding stays Loam policy, expressed as a lens term.
- **Class:** rhizomatic contract, with the slate part as Loam policy · **Tier:** federation · **Confidence:** CONFIRMED

### 12. Module versions use Loam's own set digest
- **Loam does:** `freezeMembers` hashes the sorted member ids with a domain tag (`container-identity.ts:62-80`).
- **Substrate gap:** SPEC-6 §4 leaves the set digest open (§9). The D10 `digest()` is marked provisional (`set.ts:75`).
- **vNext candidate:** a normative set digest, preferably Merkle, which also enables incremental pull.
- **Class:** rhizomatic contract · **Tier:** algebra · **Confidence:** CONFIRMED

### 13. Nesting, leeway, envelope ceilings, mounts and the bound fence are Loam's own
- **Loam does:**
  - `attachedTo` walks to the root and envelope ceilings resolve from the root's live table (`container.ts:1615-1680`).
  - `governingLeeway` and `leewayFits`; `chainBreaksAt` and `connectionStands` (`connection-authority.ts:16`).
  - Mount-table tier 3 is derived from attachments (spec/31 §31.1-31.2).
- **Substrate gap:** none. This is the hierarchy that the ruling assigns to Loam. Mounts are the transport binding.
- **vNext candidate:** none — Loam policy.
- **Class:** Loam policy · **Tier:** — · **Confidence:** CONFIRMED

### 14. Channel prefixes: the receiver names the law
- **Loam does:** the receiver assigns the prefix, and law binds as `prefix:Name` (spec/46 §46.2). Law identity leaves out the name.
- **Substrate gap:** none. This is NOTE-12 §3(c), no merge across a boundary, applied to law.
- **vNext candidate:** none — Loam policy that agrees with NOTE-12.
- **Class:** Loam policy · **Tier:** — · **Confidence:** CONFIRMED from the spec text

## Recording targets
Record the current outputs of these functions over fixed corpora before anything moves. Pin `Date.now` wherever slates are involved.

- **Negation closures:** `withNegationClosure`, `withNegationClosureAcross`, `withBatchNegationClosure` (`src/gateway/ingest.ts`).
  - Inputs: reactor corpora with chains of strikes, strikes of strikes and purged negations; multi-ground splits; batches.
- **Offered set and admission:** `offeredDeltasImpl` and the lawful/admitted partition inside `federateImpl`, together with `admitForImpl`, `readTrustPolicy` and `readTrustPolicyAt` (`ingest.ts`, `trust.ts`).
  - Inputs: store corpus, offered lens, slates, tombstones, trust declarations, the offered batch and a pinned clock.
  - Record the verdict for each delta and the report counts.
- **Container table and tree walks:** `readContainerTable`, `everDeclared`, `chainBreaksAt`, `withinSubtree`, `subtreeUnder`, `danglingAncestor`, `governingLeeway`, `receivesNow` (`container.ts`); `leewayFits` and `parseLeeway` (`leeway.ts`).
  - Inputs: declaration corpora that include flips, cycles, detaches, exclusions and struck parents.
- **Scopes:** `containerScopeImpl` and `connectionScopeImpl`.
  - Inputs: a gateway fixture with attached, unattached and detached pools, and strikes placed across grounds.
  - Record the member id sets and the refusals.
- **Channel events and status:** `parseLocalEvent`, `protectedIngressIds`, `localChannelLifecycle`, `localChannelEvidence`, `localChannelsInContainer` (`federation/local-channel-events.ts`); `channelStatusImpl` and `channelsEverImpl` (`channel.ts`).
  - Inputs: event and stamp corpora that include erased, dropped, orphaned and legacy channels.
- **Receiving and selection:** `projectLiveReceiving` (`receive-policy.ts`), `selectReceivingSnapshot` (`receive-snapshot.ts`), `selectRendererForActivation` (`federation/renderer-selection.ts`).
  - Inputs: decisions, sources and bindings.
- **Census:** `containerCensusImpl` and `survivingContextsOf` (`container-census.ts`).
- **Wire, digest and mounts:**
  - `freezeMembers` (`container-identity.ts`).
  - `fromWire`, `toWire` and `parseOffer` (`federation/wire.ts`, `offer.ts`). Inputs: a corpus of corrupt and unknown-key offers.
  - Name resolution in `makeMountTable` (`server/mounts.ts`). Inputs: static, dynamic and container collisions.
