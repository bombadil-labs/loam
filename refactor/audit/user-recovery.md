# User recovery: `loam user recover <name>` (step 5, PR 3e)

Status: design, for Sol's review. No code lands until it is approved.

## What a person sees

The operator runs `loam user recover ada` in the operator's home. Ada has lost her key, or it was
exposed. Afterwards:

- Ada signs with a new key, K2. Every grant that names `user:ada` now stands for K2.
- K1 loses its standing here. Recovery strikes every grant naming `user:ada`'s old root through the
  user (they move to K2), every grant naming K1 itself, and every delegation K1 signed, in the host
  and in every attached inbox pool. A pool that is not attached is named in the report, because
  recovery cannot reach it.
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
record superseding exactly the one before it. Two records with no `supersedes`, or two superseding
the same record, are competing heads. With competing heads, the user reads as having no root, and
`keysEverOf` answers the key alone. This fails closed. `loam user recover` refuses too, and names
the records. The operator resolves it by erasing the wrong record.

**K2's binding.** A SPEC-14 binding `{principal: K2, kind: binding, key: K1}`, signed by K2. It is
held in the host only.

## `keysEverOf` after 3e

`keysEverOf(K)` is K plus each K1 where both are true:

1. A record in a user's recovery chain names K1 as `previous` and K as `root`.
2. K's SPEC-14 binding for K1 is held (negated or not: history is history).

It follows the chain back: if K1 was itself a recovered root, its predecessors join by the same
rule. It reads the HOST's ground, also from a pool (the host is the user ground the pool declares).
A pool with no host, or a user with competing heads, answers K alone. This fails closed.

A writer who binds a stranger's key gains nothing: no operator record names that pair. The #629
rails stay green.

## The root fence

The fence is causal, not timed. A key is RETIRED for a user when a record in the user's chain names
it as `previous`, and no record LATER IN THE CHAIN (a descendant, by `supersedes`) names it as
`root`. Signed timestamps play no part. An ordinary root claim never lifts a retirement.

The root readers apply the fence FIRST, then pick the latest. `userRootAt`, `rootOf` and
`userRootsRaw` all drop every root claim that names a retired key, and only then choose among the
rest by timestamp. A fenced K1 claim with a later timestamp therefore cannot hide an eligible K2
claim. The raw reader drops them too, so raw machinery never trusts a retired key.

The operator also strikes, for good, every held root claim naming K1. The fence does not depend on
those strikes; they keep the delta record honest.

The promise is: K1 is not Ada's root again without a new operator recovery that supersedes this one
and names K1 as `root`.

## The command

1. **Preconditions.** The operator seed is readable. A standing user record for `<name>` exists.
   The user's recovery chain has one head. K1 is the current root, or absent.
2. **Standing preflight.** Refuse unless a user-named `write` or `admin` grant stands for the user,
   so K2 can write after the re-point. Without one, report and change nothing. For a user with no
   K1, the report says "root created" and says whether the key can write.
3. **Journal first.** Mint K2 in memory. Write `<name>.recovery` (0600, `wx`, fsync, then fsync the
   directory): `{attempt, previous: K1, root: K2 public key, archive: <name>.replaced-<attempt>,
   phase: "begun"}`. No seed file moves before this is durable.
4. **Seed file.** If a seed is present, refuse unless `--replace-seed` is passed. With the flag,
   rename the old file to the journal's archive name. The rename refuses an existing target and
   keeps 0600. Write K2's seed with the existing `wx`+rename writer.
5. **First append, by the operator, atomic:** the recovery record (with `attempt` and
   `supersedes`), K2's root claim, permanent strikes of every held root claim naming K1, and
   permanent strikes of K1's standing in the host: every grant naming K1 and every delegation K1
   signed.
6. **After an append error, read before undoing.** The append may have committed before the error
   reached the command. So the command re-reads the store for a recovery record with this
   `attempt`. If it is there, the attempt committed: continue at step 7. If it is not, undo: remove
   K2's seed, rename the archive back, remove the journal, and report that nothing changed.
7. **Pools.** In each attached inbox pool, the operator strikes, for good, every grant naming K1
   and every delegation K1 signed. The report names each pool not attached.
8. **Second append, by K2:** the binding. It needs K2's write standing, which exists only after
   step 5, so it is a separate batch. Then the journal is set to `phase: "bound"`, and then removed.
9. **Rerun.** If a journal is present, the command resumes that exact attempt. It reads the store
   for that `attempt`. If it committed, it finishes steps 7 and 8. If it did not, it undoes as in
   step 6. It never starts a new attempt while a journal exists.
10. **Report.** It states the new root; the old root retired; the standing struck, by host and pool;
    the binding written or pending; that connections must be re-authorized; and where the old seed
    was archived.

## Rails

Each rail asserts the delta and the door (or the View). Each has a bystander.

- **E1.** After recovery, K2 writes and holds admin through user-named grants. K1 is refused: a
  literal write grant naming K1 is struck, and K1's delegation in an attached pool is struck. A
  literal grant naming a bystander key survives, and that key still writes.
- **E2.** Ownership: K2 clears a value K1 wrote. A bystander's value on the same field stays. A
  writer who binds the bystander's key still cannot clear it (the #629 case, again).
- **E3.** The fence. The root stays K2 after each of these: a counter-strike of a retired K1 claim;
  a new operator K1 root claim; a late-arriving old K1 claim; a K1 claim with a future timestamp; a
  second recovery record that does not supersede the first. A recovery record that supersedes the
  first and names K1 as `root` makes K1 the root. `userRootAt`, `rootOf` and `userRootsRaw` agree
  on each case.
- **E4.** Durability: a negation of the recovery record, and a record written with `validUntil`,
  change neither the fence nor `keysEverOf`.
- **E5.** Competing heads: the user reads as having no root, `keysEverOf` answers the key alone,
  and `loam user recover` refuses and names the records.
- **E6.** Connections: an inbox bound by K1 is refused. Re-binding by K2 works (the #627 rails).
- **E7.** Preflight: a user with no standing grant is refused, and nothing is written.
- **E8.** Seed and journal: refusal without `--replace-seed`. A failure BEFORE the append commits
  restores the archived seed and leaves no journal. A failure AFTER the append commits (the backend
  writes, then throws) resumes: the rerun writes only the pool strikes and the binding. A crash
  after the journal and before the archive rename leaves a journal that the rerun rolls back.
- **E9.** A user with no root gets one, no binding, and the report says whether the key can write.
- **E10.** Pools: a pool's `keysEverOf` reads the host's recovery evidence. A pool with no host
  answers the root alone.

## Not in 3e

- A fresh write budget after recovery (M4, deferred).
- Reading `associatedKeys` for container membership (3f, `lowerMembership`).
- A web recovery flow. Recovery is an operator act, from the operator's home.
