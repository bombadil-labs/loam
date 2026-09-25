# The vNext plan (joint draft: Claude and Sol)

Status: a draft for Myk. No library code exists yet. Claude owns the Loam statements, and Sol owns
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

The target build order: delta and codec; storage and syntax above delta; evaluation; schema and
resolve; reactor; principal; federation; forgetting; derivation. Sol draws the exact graph and
adds a mechanical check before any file moves. One aggregate `@bombadil/rhizomatic` barrel stays.
Loam imports only from it.

## 2. The semantic changes, by package

| Package | Change | Source |
| --- | --- | --- |
| delta | Signed times: (a) created, (b) valid from, optional valid until. Rules for absent and invalid intervals. Every id changes. | ruling; both audits |
| delta | The author's timestamp stops doing the job of a process counter. Order and causality come from `txn.prior` or an explicit clock, not from `max(now, last+1)`. | Loam time #1 |
| syntax, evaluation | Every read that depends on validity takes `now` as an explicit input. A view can change at T with no new delta. | ruling; Sol CE2 |
| algebra | Suppression trust gets a name: whose strikes bind. It is separate from admission and from claim ranking. It also gets a relative form: "the striker is the target's author". | Loam theme 2 |
| reactor | An indexed query "negated under Pred", so that a masked read does not scan the store (H8). A `forget(id)` that updates materializations the way a negation does. | Loam themes 2, 8 |
| schema | A governed read: `loadHyperSchema` and `loadSchema` take a trust input. A named lens binding: name → (HyperSchema pin, Schema pin). One Schema hash API. | Loam themes 1, 9 |
| resolve | `applyPolicy(policy, candidates)`. A value ABI for resolvers: bucket in, value out. The pure-module profile for resolvers comes later, once its bytes are specified and two hosts run it. | Loam theme 9; Sol |
| storage | `forget(ids)` and a three-state probe: gone, held, unproven. The probe proves absence only on the surfaces it checked. Repair and rehydrate take an exclusion set. | Loam theme 8; Sol |
| principal | Self-certifying root, key binding, succession, delegation chains, locator claims, optional registries. A read of the governing key is anchored by a peer id, a pinned root or an explicit trust choice, never by the untrusted set alone. | ruling; Sol |
| federation | Peer = bounded set, governing key, admission, offered lenses, arrival testimony. Admission is an ordered list of injected guards; a local append is a degenerate admission. Arrival testimony is written atomically at admission. Per-subscriber lenses. Publish declares its negation closure and its manifest dependencies, and a closure audit lists the exact ids sent. Signed protocol messages. A normative set digest. | both audits |
| forgetting | Local forget orders, a separate request vocabulary, receipts as testimony, a published posture, sealed payloads. A foreign order is kept inert as testimony or rejected; it never becomes a request by reinterpretation. | ruling; both audits |
| derivation | A binding-definition vocabulary with content-addressed artifacts. The effectful module ABI, with host imports granted by consent. | Loam law #6; Sol |

## 3. Counterexamples to settle before any spec text

Each one becomes a vector, or a decision for Myk.

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
11. A process restarts with the clock behind its last timestamp. Latest-wins must not flip.
12. A shared container's membership changes and admits an old parent delta, with no new parent
    ingest. Its arrival testimony must say when the delta entered that peer, not copy the parent's
    earlier arrival. This test confirms or refutes the shared container as a peer.

## 4. Landing order

Each step lands in rhizomatic with spec text and shared vectors before code. The witnesses are
built independently. Sol publishes a prerelease when parity holds at each witness's declared
level. Loam then consumes it through the barrel and compares its recordings.

1. **Graph.** The package graph and the mechanical dependency check. No change in behavior.
2. **Boundaries.** Move files into packages. No change in bytes. Every witness stays green.
   Add the missing shared vector families for L2, L3 and L4.
3. **Time.** The signed time fields and explicit read time. Every id changes, so every vector is
   regenerated on purpose. Loam switches, and its recordings show exactly which decisions moved.
4. **Suppression and governed reads.** Suppression trust, "negated under Pred", the governed
   schema read, `applyPolicy`. Loam deletes most of its hand-written strike walks and law loops.
5. **Principal.** Roots, key binding, succession, delegation, locators. Loam moves user,
   connection and container keys into signed data.
6. **Peer and admission.** The peer model, the guard pipeline, arrival testimony. Loam's
   containers become peers, and the import cycle breaks.
7. **Publish and subscribe.** Per-subscriber lenses, declared closure, the closure audit, signed
   messages, the set digest, the revised HTTP binding. Loam then adopts that binding.
8. **Resolve.** The resolver value ABI and the named lens binding. Loam's resolvers move out.
9. **Forgetting.** Storage and reactor `forget`, the probe, orders, requests, receipts, the
   posture. Sealed payloads last.
10. **Derivation.** Artifact identity and the module ABI, pure first, then effectful.

Cadence: one step at a time by default. A later step may start early when it touches no package
that an open step is changing.

## 5. Loam's own track

Loam changes only after a prerelease exists, except for these:

- **Recordings.** Extend the harness to every target in the audit reports, before step 3.
- **Census ratchet.** A CI check that fails when a coupling count rises: the large import cycle,
  `options.seed` reads, `reactor.snapshot()` calls, clock reads in core code.
- **Defects.** Seven Loam bugs are listed in the audit (theme 10). Fix a bug now only if no step
  above replaces its code. Otherwise its recording pins it, and the step fixes it.

## 6. Decisions for Myk

Each item gives both positions where Claude and Sol differ.

### Forgetting

- **F1. Forgetting a strike.** Today the target comes back. It is honest, but sometimes unwanted.
  The alternative is a surviving signed suppression claim. Its cost: the claim may reveal the
  target id or relationship that the erasure meant to hide. Which do you want as the default?
- **F2. A foreign forget order.** Keep it inert as testimony, or reject it? Either way, asking a
  peer to act uses a separate request vocabulary. We both recommend keeping it inert.
- **F3. Unforget stays local.** If the peer published a receipt earlier, it publishes a
  superseding testimony. We both agree.
- **F4. P2.** Proposed text: a delta's identity and meaning are immutable; a peer's holdings can
  change; forgetting is an explicit exclusion that the peer records. The earlier wording,
  "meaning is append-only, bytes may be forgotten", was too loose.

### Identity and naming

- **N1. Ids that travel.** Equal strings merge today. That is right for names meant to be shared,
  such as a film. NOTE-12 proposes non-merge for ids that are local to one instance. How does an
  author mark which kind an id is? Claude: by a naming convention in the id itself. Sol: this is
  your choice, and ids must never be rewritten in flight.
- **N2. Key custody.** Loam's server holds every user's seed today. The principal tier will support
  delegation without saying where seeds live. Should Loam move the root key to the person?
  Claude recommends yes.

### Federation

- **P1. Declared closure.** A publish states which strikes and manifests travel with it, and the
  closure audit shows the exact ids. Nothing leaves by an automatic post-filter. We both recommend
  this.
- **P2. Time bounds.** Admission may refuse timestamps far from arrival, as a configurable guard,
  not a universal rule. Grants may expire through valid-until. We both recommend this.

### Law

- **L1. Named lens binding in rhizomatic.** It closes the H6 gap. We both recommend yes.
- **L2. Adoption by pin.** Adopting foreign law becomes a signed local claim that names the
  foreign pin, instead of re-signing a copy. We both recommend yes.
- **L3. Who may strike Loam's law.** Today an admin may revoke a grant, but not strike a trust
  declaration. This is Loam policy, and it needs your sentence.

### For your information, no decision needed

- A shared-posture container stays a peer. Its set is a view over the host's log, with its own
  key, admission, lens and arrival records. Counterexample 12 tests this model. If it breaks the model, we bring it to
  you.
- Every container gets its own key. That follows from "a container is a peer".
- Loam's unused tenancy code will be removed as a Loam-local cleanup.
