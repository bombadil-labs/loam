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

**A cut.** An operator-signed claim in one store, filed at the index entity `loam:recoveries` in
context `loam.cut`:

- `store`: the store INCARNATION it was written for. Each pool, when it is created, writes one
  operator-signed incarnation claim with a random id; the host has one too. A store's incarnation
  is the incarnation claim with the lowest arrival index it holds, so a replayed older claim never
  replaces it. A cut counts ONLY in the store whose incarnation it names. A copy that reaches a
  sibling pool, or a later pool re-created under the same name, is testimony there, never a
  usable cut. (Step 6 replaces the incarnation id with the pool's own key.)
- `attempt` and `recovery`: the attempt id and the id of the recovery record. The record is signed
  before any cut is written, so its id is known.
- `key`: K1, the key being retired.
- `index`: the store's arrival-log length just before the cut was written.

**An outcome.** An operator-signed claim in the same store, context `loam.cutoutcome`, naming the
cut and one of `committed` or `aborted`. It is written after the host commit (or the abort) and is
the cut's terminal state. It is durable and does not depend on the recovery record staying visible.

An outcome is DURABLE. The reader counts it whatever strikes it. The erase door refuses to erase an
outcome on its own: a cut and its outcome are erased together or not at all. A PREPARED cut (no
outcome yet) cannot be erased at all while the host may still commit: its pause holds until an
outcome lands. Two outcomes that contradict each other for one cut make that cut PREPARED: fail
closed.

The store's incarnation marker has the same durability. A new store writes its own marker before it
admits ANY other delta, replay and federation included, so no replayed older marker can be the
lowest-arrival one. The active marker cannot be erased, and the reader counts it whatever strikes it,
so an older marker can never become the lowest held one later.

A cut's state in its store:

- No outcome, and the host holds the record (verified, unerased): committed. The outcome marker has
  not landed yet.
- No outcome, and the host does not hold the record, or cannot be read: PREPARED. This fails closed:
  the store pauses K1 and shows no history for it.
- Outcome `committed`: committed, whatever the host shows now.
- Outcome `aborted`: inert.

## The barrier

`loam user recover` runs these steps, journaled (the #633 journal gains the roster, the cuts and
their outcomes):

1. **Read the roster.** The declared inbox pools, as a set, and its hash. Every one must be
   attachable. If any is not, refuse before anything is written.
2. **Write the cuts.** In each pool, append its cut. From that moment the pool PAUSES K1: its door
   (append and federate) refuses a delta signed by K1 while a PREPARED cut for K1 stands there.
3. **Commit on the host, against the roster.** The recovery record carries `roster`, the roster
   hash. The host door refuses the record if the declared-inbox roster at authorization has a
   different hash. Host appends are serialized, so no declaration can land between that check and
   the commit. (The build confirms the gateway serializes appends, or adds that lock.) The same
   append writes the host's own cut, with `index` the host's arrival length just before the
   record.
4. **Write the outcomes.** In each pool, append the `committed` outcome. A pool whose outcome did
   not land stays in the journal, and the rerun writes it. Until then the pool reads the cut as
   committed if it can see the record, and fails closed if not.
5. **Abort.** If the host refused the record (the roster moved), or it provably did not land
   (#633's read-before-undo), the command writes `aborted` outcomes to the cuts. That ends the
   pauses. A moved roster starts a new attempt from step 1.

After the commit, the fence refuses K1 everywhere, as today.

## The reader

History is a separate branch of a lowered membership, never an author set:
`union(select(author inSet present), select(id inSet eligible))`.

A delta is ELIGIBLE history for a user in a store when all hold:

- It is signed by a key K1 that an unbroken recovery chain retired, with the operator record and
  K2's binding for K1 held.
- K2's binding for K1 is NOT withdrawn at the read's `now`: a verified K2 strike in force on the
  binding removes the history, and a verified K2 counter-strike in force restores it (ruling 8: the
  new key can disown a thief's writes). This corrects the #631 reader, which counts a negated
  binding as history.
- The store holds a cut naming ITSELF, that recovery and K1, in state committed, and the delta's
  arrival index is below the cut's `index`.
- A store with no such cut has no history for that recovery. This fails closed.

Arrival order must be the same after a restart. The sqlite backend replays in insertion order; a
rail pins it.

## Crash rails

- **H1.** A K1 delta held before recovery is a member after it (host, and a pool). A K1 delta that
  arrives after, even backdated, is not.
- **H2.** Between a cut and the commit, a K1 delta offered to the pool is refused (append and
  federate). After an abort, K1 writes again and history is unchanged.
- **H3.** A crash after some cuts and before the commit: the rerun finds the attempt did not land,
  writes `aborted` outcomes, and the pool is not paused.
- **H4.** A crash after the commit with a pool's cut missing: that pool shows no history for K1. It
  never shows a post-recovery K1 delta.
- **H5.** A pool declared after the roster was read and before the host commit: the host refuses
  the record, the cuts are aborted, and the rerun covers the new pool.
- **H6.** A pool that cannot be attached refuses the recovery before anything is written.
- **H7.** K2 withdraws its binding (a verified strike in force at the read's `now`): K1's history
  leaves every container. A K2 counter-strike restores it.
- **H8.** After a restart, arrival order, every cut and every outcome read the same.
- **H9.** A cut copied into a sibling pool counts there for nothing; the sibling's own cut governs.
- **H10.** The record is committed, its outcome lands in a pool, and the record is later erased:
  the pool does not pause K1 again.
- **H11.** After the record is erased, a strike on the pool's `committed` outcome changes nothing,
  and an erasure of the outcome alone is refused.
- **H12.** Contradictory outcomes for one cut: the pool pauses K1 and shows no history.
- **H13.** A pool is dropped and re-created under the same name; its old cut and incarnation claim
  are replayed into it. Offered BEFORE the new marker lands, they are refused (the store admits
  nothing until its marker is committed). Offered after, they are inert.
- **H14.** The active incarnation marker: an erasure is refused, and a strike changes nothing.
- **H15.** A PREPARED cut: an erasure is refused, and the pause holds until an outcome lands.
