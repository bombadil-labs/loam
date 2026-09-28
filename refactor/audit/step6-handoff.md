# Step 6: the pool handoff (working spec)

Status: working spec, for Sol. No constructor changes until the substrate's prerelease peer API.
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

### 0. Preflight (old peer; nothing is written)

- The pool is attached, has one readable owner (`poolOwner`), and has no open handoff attempt.
- The pool has no open recovery attempt (a prepared recovery cut). A handoff waits for it, or the
  operator aborts it first.
- The host holds no running purge for this pool that cannot be fenced (step 3).
- The new key is minted and written durably first (a key file beside the pool's store), as
  `loam user recover` writes a new user key.

A refusal here writes nothing.

### 1. Barrier (old peer)

1. The old peer writes `prepared {attempt, pool, poolIncarnation, newPeer: K_p}`, host-signed.
2. **Drain or fail**, under the pool's admission lock (#640): an admission that started before the
   barrier finishes and is part of the old surface's record. One that cannot finish (a slow
   backend) is failed explicitly, and its caller gets a refusal that names the handoff.
3. **Hold** every arrival after the barrier: appends and federation offers addressed to the pool
   are recorded durably, in order, and neither admitted nor refused. [SUBSTRATE] The held queue is
   peer-admission state: the boundary must accept a candidate as "held for a named receiving
   peer" with its trusted receive time, and later deliver it to that peer's admission unchanged.
   Loam must not keep a side queue that bypasses the boundary.
4. From the barrier on, the old surface serves reads as before and admits nothing for the pool.

### 2. Carry (old peer computes; the new peer's state receives)

1. **The full refusal set** that applied to the surface: every id the pool refuses today
   (`refusedIds` over the pool, which includes the host's fanned-out erasures), plus every host
   refusal that bound the pool's admission. Each is carried as a refusal of the new peer, not as a
   copied erasure delta (contract, decision 2).
2. **The active byte obligations**: every id whose standing is `owed` or `unasked` for the pool
   (`erasureStandings`), plus the backend's own purge debt (the sqlite truncation debt, a mirror's
   purge failures). Each is carried as an obligation of the new peer, with its origin.
3. [SUBSTRATE] Writing a peer's permanent refusals and purge obligations at its creation is the
   substrate's durable peer state (Sol's API: "permanent refusals, and purge obligations"). Loam
   calls it with the carried sets. It must not write them as ordinary deltas the new peer could
   later strike.
4. The carried state gets a canonical digest [LOAM]: the sorted refusal ids, and the sorted
   obligation ids with origins. The commit record names the digest.

### 3. Fence (old peer)

1. Every old purge worker for the pool stops before the commit: the erase fan-out
   (`eraseReplica`), a heal, a slate cut. Each checks the fence first, and a fenced worker refuses
   to act on the pool. [LOAM] The workers are Loam's.
2. The fence is part of the `prepared` record, so a crashed worker that restarts sees it.
3. An obligation a fenced worker had half done is not lost: the carry (step 2) reads the
   standings AFTER the fence, so a half-done purge is still `owed` and is carried.

### 4. Commit (old peer, exactly once)

1. The old peer writes `committed {attempt, newPeer: K_p, carried: digest, heldFrom: cursor}`,
   host-signed. It is the commit proof. At most one outcome per attempt: contradictory outcomes
   fail closed (as recovery cuts do).
2. From now on the old surface is no longer responsible for the pool. It stops serving the pool,
   and names the new peer in its reports.
3. [SUBSTRATE] Ownership of the pool's bytes moves in the same step: the old peer's handle over the
   store is closed, and the new peer's handle is the only one that can admit into it.

### 5. The new peer opens (fail closed)

1. The new peer serves nothing and admits nothing until it reads a durable commit proof that is
   verified, signed by the old peer, names K_p, and matches the digest of its carried state.
   [SUBSTRATE] Admission with an explicit receiving peer refuses when that peer is not open;
   Loam's pool door calls it.
2. Then it admits the held arrivals, in order, through its own admission boundary. Its arrival
   testimony starts here: imported bytes keep their authors and ids, and the new peer never
   re-labels the host's earlier sequence.
3. Its own law (cuts, outcomes, owner grants, strikes, arrival stamps, incarnation) is signed by
   K_p from now on. Host-seeded copies stay host testimony (contract, decision 1).

## Abort and reopen

- Any refusal or failure BEFORE the commit ends in `aborted {attempt, reason}`, written by the old
  peer.
- On abort: the fence lifts; the held arrivals go to the OLD surface's admission, in order, as if
  they had just arrived; the new peer's durable state is discarded, and its key file is archived,
  never deleted.
- A reopen is a new attempt from step 0. It never reuses an aborted attempt's carried state.

## Crash recovery

The old peer decides from its own durable records:

- **No `prepared`**: nothing happened. A minted key file with no record is archived.
- **`prepared`, no outcome, carried state not complete** (digest missing or mismatched): abort,
  as above.
- **`prepared`, no outcome, carried state complete and matching**: the command may commit or
  abort. The default is abort on an unattended restart, and commit only when the operator reruns
  the handoff. Until then the old surface stays responsible, and arrivals stay held.
- **`committed`**: open the new peer on the proof (step 5). The old surface never serves the pool
  again, even if the new peer fails to open. It then reports the pool as unavailable, never as
  empty (H9).
- **`aborted`**: finish the abort (release the held arrivals, archive the key), idempotently.

A worker that restarts reads the fence from `prepared` and does nothing until an outcome.

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
8. An abort releases the held arrivals to the old surface in order and archives the new key; a
   reopen is a new attempt. `test/gateway/handoff-abort.test.ts`
9. A fresh pool starts under its own key with empty state and serves its first admission with no
   handoff records. `test/gateway/handoff-fresh-pool.test.ts`

## Open questions for Sol

1. Does the substrate's held-candidate state live with the receiving peer (created before the
   commit), or with the admission boundary itself?
2. Is the commit proof a substrate record (peer ownership transfer), or Loam's host-signed claim
   that the substrate's open call verifies?
3. Can the substrate import refusals and obligations into a peer after creation, or only at
   creation? The carry assumes "at creation, in one call".
