# A recovered user's history, cut per store (step 5, ruling 8 M1)

Status: design, for Sol's review. Ruling 9 (delegated to Claude and Sol).

## The promise

After a recovery from K1 to K2, the user's containers still show what K1 wrote BEFORE the
recovery. They never show what K1 signs AFTER it, even if that arrives late or backdated. The new
key vouches for the old one with a binding, and can withdraw it (ruling 8).

## Why a signed time cannot draw the line

K1 may be stolen. A thief can sign a delta with any timestamp. So "before the recovery" must be
the store's own fact: where in its own arrival order the recovery happened. Each store has its own
arrival order, so each store needs its own cut. Step 6 brings arrival testimony; this is the rule
until then.

## The records

**A cut.** An operator-signed claim in one store (an inbox pool, or the host), filed at the index
entity `loam:recoveries` in context `loam.cut`:

- `attempt` and `recovery`: the attempt id and the id of the recovery record it belongs to. The
  record is signed before any cut is written, so its id is known.
- `key`: K1, the key being retired.
- `index`: the store's arrival-log length just before the cut was written.

A cut is INERT unless the host holds its recovery record, verified and not erased. A cut whose
recovery never committed changes nothing.

## The barrier

`loam user recover` runs these steps, journaled (the #633 journal gains the roster and the cuts
written):

1. **Freeze the roster.** Read the declared inbox pools that reference the user's keys or
   containers. Every one must be attachable. If any is not, refuse before anything is written.
2. **Write the cuts.** In each pool, append the cut. From that moment the pool is PAUSED for K1:
   its door (append and federate) refuses a delta signed by K1 while a cut for K1 stands whose
   recovery the host does not yet hold, and which is not withdrawn. So no K1 delta can land between
   the cut and the commit, and none is wrongly left out of history.
3. **Recheck the roster.** Read the declared pools again. A pool declared since step 1 gets its cut
   (back to step 2). The command repeats until the roster is stable.
4. **Commit on the host.** The #633 atomic append, plus a host cut with `index` the host's arrival
   length just before the record.
5. **Abort.** If the host commit provably did not land (#633's read-before-undo), the command
   withdraws each cut with a permanent operator strike. That ends the pause, and K1 writes again.

After the commit, the fence refuses K1 everywhere, as today, so the pause is no longer needed.

## The reader

History is a separate branch of a lowered membership, never an author set:
`union(select(author inSet present), select(id inSet eligible))`.

A delta is ELIGIBLE history for a user in a store when all hold:

- It is signed by a key K1 that an unbroken recovery chain retired, with the operator record and
  K2's binding for K1 held.
- K2's binding for K1 is NOT withdrawn: a verified strike by K2 on the binding removes the
  history (ruling 8: the new key can disown a thief's writes). This corrects the #631 reader, which
  counts a negated binding as history.
- The store holds a standing cut for that recovery and K1, and the delta's arrival index is below
  the cut's `index`.
- A store with no such cut has no history for that recovery. This fails closed.

Arrival order must be the same after a restart. The sqlite backend replays in insertion order; a
rail pins it.

## Crash rails

- **H1.** A K1 delta held before recovery is a member after it (host, and a pool). A K1 delta that
  arrives after, even backdated, is not.
- **H2.** Between a cut and the commit, a K1 delta offered to the pool is refused (append and
  federate). After an abort, K1 writes again and history is unchanged.
- **H3.** A crash after some cuts and before the commit: the rerun finds the attempt did not land,
  withdraws the cuts, and the pool is not paused.
- **H4.** A crash after the commit with a pool's cut missing: that pool shows no history for K1. It
  never shows a post-recovery K1 delta.
- **H5.** A pool declared during the barrier gets its cut before the commit.
- **H6.** A pool that cannot be attached refuses the recovery before anything is written.
- **H7.** K2 withdraws its binding: K1's history leaves every container.
- **H8.** After a restart, arrival order and every cut read the same.
