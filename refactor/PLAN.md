# The vNext plan (joint draft: Claude and Sol)

Status: approved by Myk on 2026-09-25. His answers to the decisions are in §6. Claude owns the Loam statements, and Sol owns
the rhizomatic statements. Each of us audited on our own first, then compared the audits:

- Loam's audit: [audit/README.md](audit/README.md), with six area reports beside it.
- Rhizomatic's audit: `rhizomatic/vnext-audit.private.md`, and the comparison
  `rhizomatic/vnext-comparison.private.md`. Both are working files, not committed.

The rulings of 2026-09-25 are in [README.md](README.md). This plan builds on them and does not
restate them.

## 1. The package graph comes first

The current layers describe meaning, not build order. Today the TypeScript code has upward
imports:

| Edge | Problem | Fix |
| --- | --- | --- |
| `pack → reactor` (`manifestMemberIds`) | storage imports the reactor | move the manifest parser to the delta package |
| `eval → resolution` | the interpreter runs the `resolve` term | split HView evaluation from the resolve composition, or put a resolution kernel below it |
| `eval → schema` (`SchemaRegistry`) | the interpreter resolves names and pins | a registry interface below the interpreter |
| `reactor → resolution` | the reactor hashes resolved Views | split HView maintenance from View materializations |
| `hview`, `schema → term-io` hashes | codec work lives in the wrong package | a shared syntax package below them |
| `term-json → eval` | the parser imports execution | move structural validation to syntax |

A hypothesis for the build order: delta and codec; storage and syntax above delta; evaluation;
schema and resolve; reactor; principal; federation; forgetting; derivation. It stays a hypothesis
until step 1 gives a concrete acyclic graph over runtime and TypeScript declaration imports. Two
owners must be named explicitly: the `resolve` term carries a Schema and `evalTerm` calls
`resolveView`, so the terminal resolve composition needs an owner; and a generic registry
interface needs an adapter above schema. Sol draws the graph and adds a mechanical check before
any file moves. One aggregate `@bombadil/rhizomatic` barrel stays.
Loam imports only from it.

## 2. The semantic changes, by package

| Package | Change | Source |
| --- | --- | --- |
| delta | Signed times: (a) created, (b) valid from, optional valid until (see T1). Each is the author's signed claim, not an objective clock. Rules for absent and invalid intervals. Every id changes. | ruling; both audits |
| delta | Ordering is a separate question from the time fields. `txn.prior` gives claimed causal links for manifests only; it does not replace Loam's per-process counter for ordinary deltas. vNext decides whether it needs an author sequence or another ordering signal. It does not assume an HLC. | Loam time #1; Sol |
| syntax, evaluation | Every read that depends on validity takes `now` as an explicit input. A view can change at T with no new delta. | ruling; Sol CE2 |
| algebra | Suppression trust gets a name: whose strikes bind. It is separate from admission and from claim ranking. It also gets a relative form: "the striker is the target's author". | Loam theme 2 |
| reactor | An indexed query "negated under Pred", so that a masked read does not scan the store (H8). A `forget(id)` that updates materializations the way a negation does. | Loam themes 2, 8 |
| schema | A governed read: `loadHyperSchema` and `loadSchema` take a trust input, an explicit author predicate or key set, which the principal package can supply later. Raw key equality is not the only future form. A named lens binding: name → (HyperSchema pin, Schema pin). One Schema hash API. | Loam themes 1, 9 |
| resolve | `applyPolicy(policy, candidates)`. A latest-per-key primitive: candidates and a key projection in, the selected validity and trust filter applied, timestamp ties finished by ascending delta id. Loam's channel reader leaks arrival order on a tie today (`recordings/out/time.channel-tie.json`, on #573). A value ABI for resolvers: bucket in, value out. A pure-module profile comes later. Zero imports is not enough: it also needs fuel, memory limits, a canonical resolver-result ABI and vectors. The SPEC-7 proposal returns pointer lists, not Views. | Loam theme 9; Sol |
| storage | `forget(ids)` and a three-state probe: gone, held, unproven. The probe certifies only the declared storage surfaces, and the result and any receipt name those surfaces. It cannot prove that a backup or a peer forgot. Repair and rehydrate take an exclusion set. | Loam theme 8; Sol |
| principal | Self-certifying root, key binding, succession, delegation chains, locator claims, optional registries. A read of the governing key is anchored by a peer id, a pinned root or an explicit trust choice, never by the untrusted set alone. | ruling; Sol |
| federation | Peer = bounded set, governing key, admission, offered lenses, arrival testimony. Admission is an ordered list of injected guards; a local append is a degenerate admission. Arrival testimony is written atomically at admission. Per-subscriber lenses. A publish contract declares a closure rule, covering negations and manifests. Its audit lists the ids exposed now and makes future scope inspectable. Nothing expands after consent. Signed protocol messages. A normative set digest. | both audits |
| forgetting | Local forget orders, a separate request vocabulary, receipts as testimony, a published posture, sealed payloads (see F5). A receiving peer keeps a foreign order as testimony or rejects it under local admission; it never becomes a request by reinterpretation. | ruling; both audits |
| derivation | A binding-definition vocabulary with content-addressed artifacts. The effectful module ABI, with host imports granted by consent. | Loam law #6; Sol |

## 3. Counterexamples to settle before any spec text

Each one becomes a normative vector, a Loam regression recording, or a decision for Myk.

1. Two governing keys file law at one anchor (`loam:erasure`). A read under each key, and under
   none. (A TS probe returned two distinct ids at one anchor.)
2. The same test for an ordinary entity (`person:myk`). This shows whether ordinary co-reference
   needs a new rule.
3. A delta valid until T: a live view at T-1, at T and at T+1, with no ingest between them.
4. One delta arrives at peer A at time 5 and at peer B at time 50. Its id stays the same, and
   both testimonies survive a relay.
5. A published lens selects an unsigned member but not its manifest. (A probe returned
   `candidate=1, transferred=0`.) A private strike on a public target.
6. A purges an unsealed delta and signs a receipt. B keeps its copy. A sealed key was copied
   before it was destroyed.
7. A governing key rotates from A1 to A2 while the receiver cannot reach any registry. A1 and A2
   make conflicting declarations.
8. A resolver reads the clock. The host must enforce purity or grade the claim.
9. Admit A, change the roster, receive B. Batch and incremental ingest may admit different sets.
   Evaluation over the admitted set must stay order-free.
10. A strike is forgotten. Does its target come back? (See decision F1.)
11. A process restarts with the clock behind its last timestamp, then writes. Splitting the three
    times does not answer this. Question: does a later write sort earlier, unless an author
    sequence or another causal rule is declared? Answer (step 3): no ordering rule is declared. Under the
    `byTimestamp` order a later write can sort earlier, so Loam keeps its authors' clocks monotonic.
12. A shared container's membership changes and admits an old parent delta, with no new parent
    ingest. Its arrival testimony must say when the delta entered that peer, not copy the parent's
    earlier arrival. This test confirms or refutes the shared container as a peer.
13. An erasure held in one peer, and its target held in a sibling peer, read through one composed
    scope. Loam's pools share the operator's key today, so one erasure governs the whole scope.
    Once each peer has its own governing key (step 6), whose erasure governs a composed reading?

## 4. Landing order

Steps 1 and 2 change no semantics. They are checked against the existing vectors and the green
gates. Steps 3 to 10 each land in rhizomatic with spec text and shared vectors before code. The
witnesses are built independently. Sol publishes a prerelease when parity holds at each witness's declared
level. Loam then consumes it through the barrel and compares its recordings.

1. **Graph.** The package graph and the mechanical dependency check. No change in behavior.
2. **Boundaries.** Move files into packages. No change in bytes. Every witness stays green.
   `l1-eval` already covers the semantic layers L2, L3 and L5. Shared vectors for conformance
   levels 2 to 4 (reactor, federation, derivation) are added step by step, as each behavior
   becomes normative. They are not a gate for the package move.
3. **Time.** The signed time fields and explicit read time. Every id changes, so every vector is
   regenerated on purpose. Loam switches, and its recordings show exactly which decisions moved.
4. **Suppression and governed reads.** Suppression trust, "negated under Pred", the governed
   schema read with an explicit key-set or author-predicate input, `applyPolicy`, and the named
   lens binding. Loam replaces hand-written strike walks and law loops where its recordings show
   equal answers. How many go is measured, not promised.
   Step 3 left one limit for this step. Loam's negation walks (`lawfulNegated`, 34 readers, and
   `dataStruck`) ignore validity. A negation with a future start counts at once, and an expired
   negation still counts. The same holds for a negation of a registration, so a timed negation
   does not change the served surface at its boundary. Loam writes no timed negation today. The
   governed read must answer at an explicit read time, and Loam's recordings must pin a timed
   negation of a registration before this step lands.
   Every negation reader already calls `negatedAt(reactor, now, author)` in
   `src/gateway/negation.ts`, so the swap edits that body. `dataStruck` and `honoredStrikeOn` take
   `now` too, and each needs its own new body. Three caches break when negation depends on time.
   `readContainerTable` is memoized by a count of container law. `Gateway.publicOpen` is cleared on
   ingest and reseat, not at a validity boundary. Several readers keep one predicate across an
   `await` (`refactor/audit/negation-readers.md`, defect 1). Each must rebuild per read time, or be
   cleared when the validity timer fires.
5. **Principal.** Roots, key binding, succession, delegation, locators. Loam moves user,
   connection and container keys into signed data.
6. **Peer and admission.** The peer model, the guard pipeline, arrival testimony. Loam's
   containers become peers, and the import cycle breaks.
7. **Publish and subscribe.** Per-subscriber lenses, the declared closure rule, a closure audit
   of the exact transferable set and its future additions, signed peer messages, the set digest,
   and a revised HTTP binding. The current HTTP helper does not meet SPEC-6 §4. Loam adopts the
   revised binding.
8. **Resolve.** The resolver value ABI. Loam's resolvers move out.
9. **Forgetting.** Storage and reactor `forget`, the probe, orders, requests, receipts, the
   posture. Sealed payloads last.
10. **Derivation.** Artifact identity and the module ABI, pure first, then effectful.

Cadence: one step at a time by default. A later step may start early when it touches no package
that an open step is changing.

## 5. Loam's own track

Loam changes only after a prerelease exists, except for these:

- **Recordings.** Extend the harness to every target in the audit reports, before step 3.
- **Monotonic author time, at step 3.** No claim "wins" in the substrate: claims stay in
  superposition, and each Schema's Policies decide how a View renders (Myk, 2026-09-25). Step 3
  adds no ordering rule of its own. The `byTimestamp` order sorts by the author's signed creation
  time, ties broken by ascending id; a separate `byValidFrom` order sorts by valid-from. So a
  Schema that orders `byTimestamp` needs Loam to keep each author's timestamps from going
  backwards across a restart. Seeding from the operator's
  deltas is not enough, because mutations are signed with each user's key. Loam keeps a per-author
  maximum, seeded from the store and updated on every append. `recordings/out/time.restart.json`
  shows the defect today (on #573).
- **Census ratchet.** A CI check that fails when a coupling count rises: the large import cycle,
  `options.seed` reads, `reactor.snapshot()` calls, clock reads in core code.
- **Defects.** The Loam bugs are listed in the audit (theme 10). Fix a bug now only if no step
  above replaces its code. Otherwise its recording pins it, and the step fixes it. One exception:
  the point reads that serve a tombstoned delta whose bytes survived. Loam's doors can serve
  those today, so Loam fences them now and does not wait for step 9.

## 6. Decisions for Myk

### Myk's answers (2026-09-25, in chat)

Words: **negation** is a new delta that retracts another delta; its bytes stay. **Erasure**
removes a delta's bytes from one peer and leaves a signed tombstone that refuses the id's return.
The draft said "forgetting" for erasure. Use "erasure".

- **F1.** Erasing a strike brings its target back. Erasure rewrites state as if the erased delta
  never existed. To end a strike's effect as of a time, negate the strike instead.
- **F2.** A foreign erasure order is kept as testimony, at a minimum.
- **F3.** A negation is undone only by another delta (negate the negation) or by erasure. An
  erasure is eternal and provable: its bytes never come back, and the id is never re-admitted. The
  tombstone is a delta and can be negated, but a store keeps its own list of refused ids. Tombstones
  add to the list, and negating a tombstone does not remove an id from it. That list is store
  policy (Loam), not rhizomatic. Loam today lets a negated tombstone re-admit its id; that changes.
- **F4.** Accepted: "A delta never changes: its id and its content are fixed. Retraction is a
  negation, which is a new delta. A peer may erase a delta from its own holdings. Erasure is local
  to that peer, and the peer records it in a signed tombstone that refuses the id's return."
- **F5.** Encrypted payloads (the draft said "sealed") are an optional second safety for erasure,
  for the deltas that use them. Specify them in the erasure step. Build them eventually: the plan
  must not drop them.
- **T1.** Yes. A delta may negate itself at a signed time. No new delta is needed. A surface that
  shows it, such as a renderer, must update itself at that time. Without `validUntil`, only another
  delta can negate it. Every view reports the next time at which it will change, so a surface
  schedules one wake-up. `validUntil` is the first moment the claim no longer holds: at that
  exact instant, the delta is already negated.
- **N1.** Ids carry no sharing marker. Equal strings merge. What travels is a property of each
  peer's sharing model (its lenses and admission), never of the delta. This also keeps deltas free
  to move between a store's own containers. The law-anchor problem is solved by governed reads with
  an explicit key set.
- **N2.** Probably yes. Define what it means during step 5.
- **S1, S2.** Yes.
- **L1.** Yes: a lens binding is general, and belongs in a rhizomatic library.
- **L2.** Yes: adoption is a local delta that points to the foreign delta. Negating the adoption
  keeps the foreign delta and its provenance.
- **L3.** A user may negate law, including an adoption, in any peer where the user can write. The
  negation changes only that peer's reading. It does not change the rule in the store.

### The questions as asked

### Forgetting

- **F1. Forgetting a strike.** Today the target comes back. It is honest, but sometimes unwanted.
  The alternative is a surviving signed suppression claim. Its cost: the claim may reveal the
  target id or relationship that the erasure meant to hide. Which do you want as the default?
- **F2. A foreign forget order.** It never becomes a request silently. Asking a peer to act uses
  a separate request vocabulary. The protocol lets a receiving peer keep the order as testimony
  or reject it. Which is Loam's default? Claude recommends keeping it as testimony.
- **F3. Unforget stays local.** If the peer published a receipt earlier, it publishes a
  superseding testimony. We both agree.
- **F4. P2.** Proposed text: a delta's identity and meaning are immutable; a peer's holdings can
  change; forgetting is an explicit exclusion that the peer records. The earlier wording,
  "meaning is append-only, bytes may be forgotten", was too loose.
- **F5. Sealed payloads and the scope of proof.** Does sealing need a new target kind, or a
  vocabulary over the current bytes and blob references? Before the public forgetting promise is
  made, it must say exactly what a peer can prove: about its own storage, about key destruction,
  and about copies downstream.

### Time

- **T1. Signed valid-until.** Does a claim stop counting at `validUntil` automatically, with no new
  delta? If yes, the spec defines whether each end of the interval is included, and every
  evaluation takes its time as an explicit input.

### Identity and naming

- **N1. Ids that travel.** Equal strings merge in the current algebra, and they should keep
  merging for ids meant to be shared, such as a film. NOTE-12 proposes non-merge for ids that are
  local to one instance. That cannot follow from the same rule without an explicit distinction.
  Two mechanisms exist: an author mints a qualified id before signing, or a receiver reads with
  provenance qualification. No peer may rewrite a signed entity id in flight. You choose the
  marker, or the boundary rule. Claude leans toward a qualified id minted by the author, because
  it keeps reads simple.
- **N2. Key custody.** Loam's server holds every user's seed today. The principal tier will support
  delegation without saying where seeds live. Should Loam move the root key to the person?
  Claude recommends yes.

### Sharing

- **S1. Declared closure.** A publish contract declares a closure rule for strikes and manifests.
  It is not a one-time list. Its audit shows the ids exposed now and makes future scope
  inspectable. Nothing leaves by an automatic post-filter. We both recommend this.
- **S2. Time bounds.** Admission may refuse timestamps far from arrival, as a configurable guard,
  not a universal rule. Grants may expire through valid-until. We both recommend this.

### Law

- **L1. Named lens binding in rhizomatic.** It closes the H6 gap. We both recommend yes.
- **L2. Adoption by pin.** Adopting foreign law becomes a signed local claim that names the
  foreign pin, instead of re-signing a copy. We both recommend yes.
- **L3. Who may strike Loam's law.** Today an admin may revoke a grant, but not strike a trust
  declaration. This is Loam policy, and it needs your sentence.

### For your information, no decision needed

- A shared-posture container stays a peer. Its set is a view over the host's log, with its own
  key, admission, lens and arrival records. Counterexample 12 tests this model. If the model
  fails, we bring it to you.
- Every container gets its own key. That follows from "a container is a peer".
- Loam's unused tenancy code will be removed as a Loam-local cleanup.
