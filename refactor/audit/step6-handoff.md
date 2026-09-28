# Step 6: the pool handoff (working spec)

Status: working spec, reviewed by Sol (#648). No constructor changes until the substrate's prerelease peer API.
It builds on Sol's contract and the inventory (`step6-inventory.md`, #647).

Marks: **[SUBSTRATE]** is a call Loam needs from rhizomatic's peer and admission layer, and must
not invent locally. **[LOAM]** is Loam's own mechanism.

## The promise

Today a pool is a surface of its host: both sign with the host's key. After the handoff the pool
is a peer of its own, with its own governing key, and it keeps every promise the old surface
made:

- nothing it refused comes back;
- every byte it owed to a purge is still owed, and reported;
- no delta is admitted twice, dropped, or admitted by both surfaces;
- until the handoff commits, the old surface stays responsible, and the new peer serves nothing.

A person sees one thing: the pool keeps answering as before, and a report names which peer owns
it.

## The parties

- **Old peer**: the host, the key that governs the pool today. It is the authority for the
  barrier, and it writes the commit or abort record.
- **New peer**: the pool under its own key, K_p. It holds no authority until it reads a durable
  commit proof that names it.
- **Handoff record** [LOAM]: host-signed claims at a host index entity (`loam:handoffs`), one set
  per attempt: `prepared`, then exactly one of `committed` or `aborted`. They are durable and
  store-local, are never offered, and cannot be erased while the attempt is open (the recovery
  barrier's rules, #640).

## The steps

### 0. Preflight (old peer)

All refusing checks run first, and a refusal writes nothing:

- the pool is attached and has no open handoff attempt;
- an INBOX pool has one readable owner (`poolOwner`, which reads an inbox's effective admin
  grants). A channel, quarantine or separate pool has no owner grant by design: its preflight is
  its own attachment and constitutional check (it resolves its declaration, its pool handle is
  attached, and its store reads without quarantined constitution);
- the pool has no open recovery attempt (a prepared recovery cut): a handoff waits for it, or the
  operator aborts it first;
- the backend can provide the shared durable commit record that step 4 needs. If it cannot, the
  pool stays a surface of the host.

Only then is the new key K_p minted and written to a staged key file. That action is staged and
reversible: an abort archives the file, and nothing reads it until the commit.

### 1. Barrier (one transition under the old peer's admission lock)

The old peer takes the pool's admission lock (#640) and, in one transition:

1. waits for every admission that started before the barrier to settle. An admission whose backend
   write is in flight is never called failed until its outcome is known: it settles as landed or
   refused, and is part of the old surface's record either way;
2. durably installs `prepared {attempt, pool, poolIncarnation, newPeer: K_p}` AND the routing that
   sends every later arrival for the pool to the hold queue;
3. releases the lock.

So no admission can pass its check before `prepared` and commit after it.

The **hold queue** belongs to the old peer's durable admission boundary until the outcome
[SUBSTRATE]. An item carries the candidate bytes and their coverage, the sender, the original
trusted receive time, the attempt id, and its disposition. After a commit each item goes through
the new peer's admission; after an abort, through the old peer's. No item is ever without an
owner. Until its bytes are physically removed, or transferred and then removed, the queue is a
declared surface in the old peer's erasure report.

From the barrier on, the old surface serves reads as before and admits nothing for the pool.

### 2. Fence (old peer, before the carry)

1. The fence is installed as part of `prepared`: every old purge worker for the pool (the erase
   fan-out `eraseReplica`, a heal, a slate cut) is fenced.
2. The fence is enforced where bytes change, not only where a worker starts: the pool's storage
   mutation (`purge`, the backend's truncation) rejects a caller that holds the old owner or
   generation [SUBSTRATE, with a LOAM backend hook]. Otherwise the handoff must prove that every
   old worker finished before the commit. A worker that passed its first check and stalled cannot
   delete bytes after the commit.
3. The old peer drains the old workers: each finishes, or stops at its next byte mutation.
4. A purge that was half done stays a durable obligation, with its stable id, generation and
   surface, not merely an `owed` label.

### 3. Carry (old peer snapshots; a staged, closed new peer receives)

After the fence has drained:

1. **The full refusal set** that applied to the surface: every refusal event the pool honours
   today, including the host's erasures fanned out before the barrier, each qualified by its
   source PeerId.
2. **The active byte obligations**: every obligation of the pool (standings `owed` or `unasked`,
   the backend's purge debt, the half-done purges of step 2), each with its stable id, generation,
   surface and source PeerId.
3. The new peer exists only as a STAGED, CLOSED peer. **Constructor obligation [LOAM]:** today's
   `Gateway.open` cannot open it. It appends a fresh incarnation marker before any proof is
   checked (gateway.ts:587-600) and replays registrations. The handoff path needs a closed staging
   open over the pool's backend that reads only: no append, no marker, no materialization, no
   admission and no serving, until the substrate proof and both digests validate. Only then does
   the peer establish K_p's incarnation and serve. It receives the carried sets through the
   substrate's import [SUBSTRATE]. Import is allowed only into a staged, closed peer during a
   handoff, or at the creation of an empty peer; never into a serving peer. It must keep the
   source-qualified events and the obligation ids and generations. Nothing is written as ordinary
   deltas the new peer could later strike.
4. **The destination's policy and config** is staged and authenticated beside that state: its
   own-law key K_p; its explicit host-law selections (the law contexts where it selects the host
   as a trusted author, for example seeded registrations and the container table); its external
   host user ground (the host key that governs user facts); and any pinned host erasure governor.
   The carried refusals prevent re-entry, but only this policy preserves which held claims bind in
   its views, so "keeps answering as before" depends on it. SPEC-6 already requires the erasure
   pins in the handoff commit.
5. The carried state gets a canonical digest over the full qualified refusal events and the
   obligation identities, generations and surfaces, not only sorted ids. The policy gets its own
   digest over those four fields.

### 4. Commit (substrate CAS, then the new peer's ack)

1. The old peer keeps reporting the carried pending obligations, and stays responsible, until the
   new peer's import and proof are durable.
2. The ownership transfer is substrate peer state [SUBSTRATE]: a compare-and-set that only the old
   peer can make, naming the attempt, K_p, the state digest and the policy digest, and a durable
   import acknowledgement
   from the new peer. One transaction on a single backend; a shared durable commit record across
   separate backends. That fact, not a Loam delta, moves responsibility.
3. Loam writes `committed {attempt, newPeer: K_p, carried: digest, policy: digest, heldFrom}` as a
   host-signed
   AUDIT witness of the same attempt and digest. The new peer never opens on it alone.
4. After the substrate commit and ack, the old surface stops serving the pool and names the new
   peer in its reports. Byte ownership moves in the same substrate step: the old owner's handle
   can no longer mutate the store (step 2).

### 5. The new peer opens (fail closed)

1. The new peer serves nothing and admits nothing until the substrate reports its commit durable
   for K_p, and both digests match its imported state and its staged policy [SUBSTRATE]. Loam's pool door calls
   admission with the new peer as the explicit receiving peer, and admission refuses while that
   peer is not open.
2. Then it admits the held items in order, through its own admission boundary, with their original
   receive times. Its arrival testimony starts at its own import: imported bytes keep their authors
   and ids, and it never re-labels the host's earlier sequence.
3. Its own law (cuts, outcomes, owner grants, strikes, arrival stamps, incarnation) is signed by
   K_p. Host-seeded copies stay host testimony (contract, decision 1).

## Abort and reopen

- Any refusal or failure before the substrate commit ends in `aborted {attempt, reason}`, written
  by the old peer, which stays responsible throughout.
- On abort: the fence lifts. The held items go through the OLD peer's admission in order, with
  their original trusted receive time, sender and bundle coverage, never as if they had just
  arrived. The staged new peer is discarded. Its key file is archived, never deleted.
- A reopen is a new attempt from step 0. It never reuses an aborted attempt's carried state.

## Crash recovery

The old peer decides from its own durable records and the substrate's commit state:

- **No `prepared`**: nothing happened. A staged key file with no record is archived.
- **`prepared`, no substrate commit, carry incomplete or its digest mismatched**: abort, as above.
- **`prepared`, no substrate commit, carry complete**: the operator's rerun commits; an unattended
  restart aborts. Until then the old surface stays responsible, and the held items stay held.
- **Substrate commit made, new peer's ack not durable**: the old peer keeps reporting the carried
  obligations. The rerun completes the ack and opens the new peer.
- **Commit and ack durable**: open the new peer. The old surface never serves the pool again. If
  the new peer then fails to open, the pool is reported unavailable, never empty (H9).
- **`aborted`**: finish the abort idempotently.

A worker that restarts meets the fence at its byte mutation, and does nothing.

## Fresh pools need no handoff (the control)

A pool created after step 6 starts as its own peer:

1. Mint K_p, write it durably, and create the peer with empty refusals and obligations
   [SUBSTRATE], before its first admission.
2. The host writes the pool's declaration (host law), as today.
3. The pool's first incarnation marker and its first law are signed by K_p. No `prepared`, no
   carry, no fence.

## Acceptance criteria

Each names the rail that will prove it. The rails are written at P3, against the substrate API.

1. A handoff with no failures ends with the new peer serving the pool, the old surface serving
   nothing for it, and every refusal and obligation present in the new peer's state.
   `test/gateway/handoff-commit.test.ts`
2. Nothing a surface refused returns after the handoff, at the door or by federation, including
   an id refused only by a host erasure fanned out before the barrier.
   `test/gateway/handoff-refusals.test.ts`
3. An obligation owed before the handoff is still reported owed by the new peer until its bytes
   are gone; a roll-up reports the conjunction. `test/gateway/handoff-obligations.test.ts`
4. An arrival during the barrier is held, admitted once by the new peer after the commit, or by
   the old surface after an abort, and never by both. `test/gateway/handoff-held.test.ts`
5. A fenced purge worker does nothing to the pool, and its half-done purge is carried as owed.
   `test/gateway/handoff-fence.test.ts`
6. The new peer admits and serves nothing without a verified commit proof naming its key and its
   carried digest; a forged, unsigned or mismatched proof leaves it closed.
   `test/gateway/handoff-proof.test.ts`
7. Each crash point (before `prepared`, after `prepared`, after the carry, after `committed`)
   recovers to exactly one responsible surface. `test/gateway/handoff-crash.test.ts`
8. An abort releases the held items to the old surface in order, with their original receive
   times, and archives the new key; a reopen is a new attempt. `test/gateway/handoff-abort.test.ts`
9. An admission whose check passed before the barrier either lands before `prepared` is installed
   or is refused; none lands after it without being carried. `test/gateway/handoff-barrier.test.ts`
10. A fenced worker that stalled after its first check cannot delete a byte after the commit: the
    mutation itself refuses the old owner. `test/gateway/handoff-fence.test.ts`
11. Between the substrate commit and the new peer's durable ack, every carried obligation is
    reported by exactly one peer. `test/gateway/handoff-crash.test.ts`
12. After a handoff, a host-seeded registration still binds in the new peer's views only under the
    declared host-law selection of its trust policy; with that selection absent from the staged
    policy, the commit refuses. `test/gateway/handoff-policy.test.ts`
13. A staging open with a missing, forged or mismatched proof leaves the pool's backend
    byte-identical: no K_p incarnation marker, no registration replay, no append.
    `test/gateway/handoff-staging.test.ts`
14. A channel pool and a quarantine pool, which have no owner grant, pass their own preflight and
    hand off. `test/gateway/handoff-commit.test.ts`
15. A fresh pool starts under its own key with empty state and serves its first admission with no
   handoff records. `test/gateway/handoff-fresh-pool.test.ts`

## Settled with Sol

1. The hold queue belongs to the old peer's durable admission boundary until the outcome, and it is
   never a provisional arrival history of the new peer.
2. The ownership proof is substrate peer state: an old-peer-authoritative CAS and the new peer's
   durable import ack. Loam's host-signed record is an audit witness only. If the backend cannot
   provide the commit record, the old surface stays.
3. Inherited refusals and obligations are imported only into a staged, closed peer during a
   handoff, or at the creation of an empty peer. Later changes go through that peer's own
   admission and erasure pipeline.
