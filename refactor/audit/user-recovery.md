# User recovery: `loam user recover <name>` (step 5, PR 3e)

Status: design, for Sol's review. No code lands until it is approved.

## What a person sees

The operator runs `loam user recover ada` in the operator's home. Ada has lost her key, or it was
exposed. Afterwards:

- Ada signs with a new key, K2. Every grant that names `user:ada` now stands for K2.
- Every key Ada's recovery chain retired, K1 included, holds no standing here: not in the host, not
  in any inbox pool, and not in a pool that attaches later. The door enforces this, so it holds from
  the moment the recovery lands.
- What K1 wrote stays readable, and it is still Ada's own. Ada can clear it and retract it.
- Her connections do not carry over. She re-authorizes each one she wants to keep.

## The rulings this follows

- PLAN step 5 and ruling 5: a user is a principal rooted at a key. The operator re-points the user
  record to recover. The new root binds the old key for continuity. Connections do not carry over.
- Ruling 8 (M1): a recovered user's container still shows what the old key wrote.
- The #629 fix: a SPEC-14 binding alone makes nothing "own". Ownership needs an operator record.

## The records

**The operator's recovery record.** One operator-signed delta at `user:<name>`, context
`loam.recovery`:

- `user`: the name.
- `previous`: K1, the root it replaces. It is absent for a user who had no root.
- `root`: K2.
- `attempt`: a random id. It ties the record to the local journal.
- `supersedes`: the id of the user's previous recovery record, or absent for the first one.

**Recovery is durable history.** A recovery record counts from the moment it is held. A negation of
it changes nothing, and a `validUntil` on it is ignored. Only erasure removes it, because erasure
removes the bytes. To reverse a recovery, the operator runs a new one that supersedes it.

**The chain.** A user's recovery records must form one chain: one first record, and each other
record superseding exactly the one before it. The chain is BROKEN, and fails closed, when any of
these holds:

- two records have no `supersedes` (two first records);
- two records supersede the same record (competing heads);
- a record's `supersedes` names an id that is not held (an orphan: the record it names was erased,
  or never arrived);
- a root claim written by a recovery names, in its `recovery` pointer, a record that is not held
  (the head was erased while its root claim stands).

With a broken chain the user reads as having no root, and `keysEverOf` answers the key alone.
`loam user recover` refuses and names the records.

**Erasing a recovery record.** Erasure is the operator's act, and it removes bytes; this design does
not narrow what the operator may erase. It makes every erasure it can see fail closed: an erased
first or middle record orphans its successor, and an erased head leaves its root claim pointing at
nothing. An operator who erases a head AND its root claim has reversed the recovery on purpose; the
erasure records say so, and the user then has no root until the operator writes one.

**K2's binding.** A SPEC-14 binding `{principal: K2, kind: binding, key: K1}`, signed by K2. It is
held in the host only.

## `keysEverOf` after 3e

`keysEverOf(K)` is K plus each K1 where both are true:

1. A record in an unbroken recovery chain names K1 as `previous` and K as `root`.
2. K's SPEC-14 binding for K1 is held (negated or not: history is history).

It follows the chain back: if K1 was itself a recovered root, its predecessors join by the same
rule. It reads the HOST's ground, also from a pool (the host is the user ground the pool declares).
A pool with no host, or a user with a broken chain, answers K alone. This fails closed.

A writer who binds a stranger's key gains nothing: no operator record names that pair. The #629
rails stay green.

## The root fence

**The head's root is the only eligible root.** Once a user has a recovery chain, the root is the
chain head's `root`, and only if a standing operator root claim names that key (read at the read's
as-of cut). No other root claim is eligible, whatever its timestamp, strikes or counter-strikes. So
an older K0 claim cannot revive when K2's claim is struck: the root then reads as none. Signed
timestamps never order recoveries; `supersedes` does. A user with no chain reads roots as today.

`userRootAt`, `rootOf` and `userRootsRaw` all apply this rule. The raw reader answers the head's
root alone once a chain exists.

**A retired key holds no standing.** A key is RETIRED when a record in an unbroken chain names it
as `previous`, and no descendant in that chain names it as `root`. A key is also retired, for as
long as the conflict stands, when ANY held recovery record of a BROKEN chain names it as `previous`
or `root`: a broken history cannot tell which key is the user, so none of the keys it implicates
stands. Resolving the conflict (the operator erases the wrong record) restores the single chain's
answer.

`grantHeld` refuses a retired author before any grant is read, whatever the grant names: a literal
grant, a user-named grant, or a delegation. The governed striker set drops retired keys. This holds
in every ground that reads the host's users, so a pool refuses K1 even before its own strikes land,
and a pool that attaches later refuses K1 at once. There is no race window after the scan.

The operator also strikes, for good, every other held root claim for the user, and K1's grants and
delegations. The fence does not depend on these strikes; they keep the delta record honest.

The promise is: a retired key is not the user's root, and holds no standing, without a new operator
recovery that supersedes the chain head and names it as `root`. The one exception is a deliberate
operator reset: the operator erases the head and its root claim. After a reset the user has no
root until the operator writes one, and the erasure records say what was reset.

## The command

1. **Preconditions, before anything is written.** The operator seed is readable. A standing user
   record for `<name>` exists. The user's recovery chain, if any, is unbroken. If a seed file is
   present, `--replace-seed` is passed; otherwise refuse. A refusal here leaves no journal and no
   file change.
2. **Standing preflight.** Refuse unless a user-named `write` or `admin` grant stands for the user,
   so K2 can write after the re-point. Without one, report and change nothing. For a user with no
   K1, the report says "root created" and says whether the key can write.
3. **Journal first.** Mint K2 in memory. Write `<name>.recovery` (0600, `wx`, fsync, then fsync the
   directory): `{attempt, previous: K1, root: K2 public key, archive: <name>.replaced-<attempt>,
   phase: "begun"}`. No seed file moves before this is durable.
4. **Seed file.** Rename the old seed, if any, to the journal's archive name. The rename refuses an
   existing target and keeps 0600. Write K2's seed with the existing `wx`+rename writer.
5. **First append, by the operator, atomic:** the recovery record (with `attempt` and
   `supersedes`); K2's root claim, with a `recovery` pointer to the record; permanent strikes of
   every other held root claim for the user; and permanent strikes of K1's host grants and
   delegations. From this moment the fence holds everywhere.
6. **After an append error, read before undoing.** The append may have committed before the error
   reached the command. So the command re-reads the store for a recovery record with this
   `attempt`.
   - The read succeeds and the record is there: the attempt committed. Continue at step 7.
   - The read succeeds and the record is not there: undo. Remove K2's seed, rename the archive back,
     remove the journal, and report that nothing changed.
   - The read fails or is indeterminate: change nothing. Leave the seed files and the journal as
     they are, and report "pending". A rerun decides.
7. **Pools (hygiene).** In each attached inbox pool, the operator strikes, for good, K1's grants and
   delegations. The journal records each pool done. A pool whose append fails, or that is declared
   but not attached, stays in the journal as pending. The fence already refuses K1 there.
8. **Second append, by K2:** the binding. It needs K2's write standing, which exists only after
   step 5, so it is a separate batch. The journal records it.
9. **Complete or pending.** The journal is removed only when the binding and every declared pool are
   done. Otherwise the report says "recovery landed; pending: <pools>, <binding>", and a rerun
   retries exactly those from the journal. It never starts a new attempt while a journal exists.
10. **Report.** It states the new root; the retired keys; the standing struck, by host and pool;
    what is still pending; that connections must be re-authorized; and where the old seed was
    archived.

## Rails

Each rail asserts the delta and the door (or the View). Each has a bystander.

- **E1.** After recovery, K2 writes and holds admin through user-named grants. K1 is refused at the
  door in the host and in an attached pool, through a literal grant and through a delegation. A
  literal grant naming a bystander key survives, and that key still writes.
- **E2.** Ownership: K2 clears a value K1 wrote. A bystander's value on the same field stays. A
  writer who binds the bystander's key still cannot clear it (the #629 case, again).
- **E3.** The fence. The root stays K2 after each of: a counter-strike of a K1 claim; a new operator
  K1 root claim; a late K1 claim; a K1 claim with a future timestamp. With K0 at 10, K1 at 20 and
  the recovery K1→K2 at 30, striking K2's root claim leaves NO root: K0 does not revive. A
  superseding recovery naming K1 as `root` makes K1 the root. An as-of read before the recovery
  still reads K1 (a control). `userRootAt`, `rootOf` and `userRootsRaw` agree on each case.
- **E4.** Durability: a negation of the recovery record, and a record written with `validUntil`,
  change neither the fence nor `keysEverOf`.
- **E5.** A broken chain fails closed: a second record that does not supersede; an orphan whose
  `supersedes` is not held; a root claim whose `recovery` record is not held. In each the user reads
  as having no root, `keysEverOf` answers the key alone, and `loam user recover` refuses and names
  the records. In each, K1 also holds a literal write grant, and a counter-negated one: the door
  refuses K1, and K1's strike does not bind in a governed read. A bystander key's literal grant
  still writes, and its strike still binds. Erasing the wrong record restores the single chain's
  answer.
- **E6.** Connections: an inbox bound by K1 is refused. Re-binding by K2 works (the #627 rails).
- **E7.** Preflight: no standing grant, a present seed without `--replace-seed`, or a broken chain
  is refused, with nothing written and no journal left.
- **E8.** Seed and journal:
  - a failure BEFORE the append commits restores the archived seed and leaves no journal;
  - a failure AFTER the append commits (the backend writes, then throws) resumes;
  - an indeterminate read after an append error leaves everything and reports "pending";
  - a crash after the journal and before the archive rename leaves a journal that the rerun rolls
    back.
- **E9.** Pools: a failed pool append leaves the recovery "pending" and K1 still refused there; a
  rerun completes it. A detached pool refuses K1 as soon as it attaches, and a rerun then strikes
  its records.
- **E10.** A user with no root gets one, no binding, and the report says whether the key can write.
- **E11.** A pool's `keysEverOf` reads the host's recovery evidence. A pool with no host answers the
  root alone.

## Not in 3e

- A fresh write budget after recovery (M4, deferred).
- Reading `associatedKeys` for container membership (3f, `lowerMembership`).
- A web recovery flow. Recovery is an operator act, from the operator's home.
