# User recovery: `loam user recover <name>` (step 5, PR 3e)

Status: design, for Sol's review. No code lands until it is approved.

## What a person sees

The operator runs `loam user recover ada` in the operator's home. Ada has lost her key, or it was
exposed. Afterwards:

- Ada signs with a new key, K2. Every grant that names `user:ada` now stands for K2.
- Her old key, K1, can do nothing here. It cannot write, administer, or delegate.
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

**K2's binding.** A SPEC-14 binding `{principal: K2, kind: binding, key: K1}`, signed by K2. It is
held in the host only.

## `keysEverOf` after 3e

`keysEverOf(K)` is K plus each K1 where both are true:

1. A standing operator recovery record for some user names K1 as `previous` and K as `root`.
2. K's SPEC-14 binding for K1 is held (negated or not: history is history).

It follows chains: if K1 was itself a recovered root, its predecessors join by the same rule. It
reads the HOST's ground, also from a pool (the host is the user ground the pool declares). A pool
with no host answers K alone. This fails closed.

A writer who binds a stranger's key gains nothing: no operator record names that pair. The #629
rails stay green.

## The root fence

The operator strikes, for good, every held root claim for the user that names another key. That
alone is not enough. A counter-strike, a new operator claim, or a late-arriving old claim could make
K1 the root again.

So `userRootAt` (and `rootOf`, which must agree) ignores a root claim that names a key a standing
operator recovery record for that user retired. The exception is a LATER recovery record that names
that key as `root`. Records are ordered like the root reader: latest by timestamp, ties to the
smaller id.

The promise is: K1 is not Ada's root again without a fresh operator recovery act.

## The command

1. **Preconditions.** The operator seed is readable. A standing user record for `<name>` exists.
   K1 is the current root, or absent.
2. **Standing preflight.** Refuse unless a user-named `write` or `admin` grant stands for the user,
   so K2 will be able to write after the re-point. Without one, the command reports and changes
   nothing. For a user with no K1, the report says "root created" and says whether the key can
   write.
3. **Seed file.** If a seed is present, refuse unless `--replace-seed` is passed. With the flag, the
   old file is renamed to `<name>.replaced-<attempt>`, keeping 0600. The name cannot collide,
   because the attempt id is random and the rename refuses an existing target.
4. **Journal.** Before any append, write `<name>.recovery` (0600, `wx`):
   `{attempt, previous: K1, root: K2, phase: "minted"}`. Write K2's seed with the existing
   `wx`+rename writer.
5. **First append, by the operator, atomic:** the recovery record, K2's root claim, and permanent
   strikes of the other held root claims. On failure: remove K2's seed, restore the archived K1
   seed, remove the journal. Report that nothing changed.
6. **Second append, by K2:** the binding. It needs K2's write standing, which exists only after
   step 5, so it is a separate batch. Then the journal is set to `phase: "bound"`, and then removed.
7. **Rerun.** If a journal is present, the command resumes that exact attempt. It checks that the
   operator record with that attempt id stands, and that the seed file holds that K2. Then it writes
   only the missing binding. A journal whose record never landed is rolled back, as in step 5.
8. **Report.** It states the new root; the old root retired; the binding written or pending; that
   connections must be re-authorized; and where the old seed was archived.

## Rails

Each rail asserts the delta and the door (or the View). Each has a bystander.

- **E1.** After recovery, K2 writes and holds admin through user-named grants. K1 is refused. A
  bystander user is unaffected.
- **E2.** Ownership: K2 clears a value K1 wrote. A bystander's value on the same field stays. A
  writer who binds the bystander's key still cannot clear it (the #629 case, again).
- **E3.** The fence: a counter-strike of a retired K1 claim, a new operator K1 claim, and a
  late-arriving old K1 claim each leave the root at K2. A later recovery record naming K1 as root
  makes it the root.
- **E4.** Connections: an inbox bound by K1 is refused. Re-binding by K2 works (the #627 rails).
- **E5.** Preflight: a user with no standing grant is refused, and nothing is written.
- **E6.** Seed: refusal without `--replace-seed`. With it, the old file is archived and restored on
  a failed first append.
- **E7.** Rerun: a failed second append, rerun, writes only the binding.
- **E8.** A user with no root gets one, no binding, and the report says whether the key can write.
- **E9.** Pools: a pool's `keysEverOf` reads the host's recovery evidence. A pool with no host
  answers the root alone.

## Not in 3e

- A fresh write budget after recovery (M4, deferred).
- Reading `associatedKeys` for container membership (3f, `lowerMembership`).
- A web recovery flow. Recovery is an operator act, from the operator's home.
