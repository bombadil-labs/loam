# §36 phase 2/15 — A user is a fact (T123)

**Ticket.** T123. **Status.** Working spec, build-stage. Implements a decision Myk already
settled (plan §9, §9a — CLI-only role assignment, every operator equivalent). Self-merges on the
ordinary bar: `npm run check` green, P5 clean, post-work audit clean.

**One sentence.** A user and a role binding are ordinary operator-signed claims in the ground; a
HyperSchema selects only the store's seed's assertions, and a Schema resolves the role context as
a SET so a user may hold many roles at once.

## 36.2.1 The model

1. **A user is an ENTITY.** Its name, and the roles it holds, resolve through a Schema over a
   HyperSchema — a View, not a delta. A user is never "half of a delta"; that phrasing collapses a
   claim into a fact.
2. **A role binding is data, not a grant.** Nothing at the append door refuses an ordinary write
   from claiming a role at `user:<name>`. The one and only defence is the READ: `userHyperSchema`
   selects claims authored by the store's seed and nothing else.
3. **The role read names the store's own seed, and nothing wider.** `<home>/operator.seed`
   belongs to the store, not to a senior operator — §9a says there is no such tier. The read stays
   exactly `authoredBy: <the store's seed key>`. Widening it to a trust set is the escalation
   revision 1 shipped and Myk's ruling deleted (plan §9, §9.1).
4. **Roles resolve as a SET.** The Policy for `loam.role` is `all`, never `pick`. A user holding
   `operator` and `actor` resolves both, and revoking one leaves the other. `rolesOf` is the only
   reader; there is no `roleOf` returning a single value, because a singular name invites a caller
   to compare instead of testing membership.

## 36.2.2 What this phase does NOT do

It does not touch `credentials.json`. It does not add a door — no HTTP route, no GraphQL field, no
CLI command reads a user or a role yet. It does not widen the role read past the store's seed. It
does not add on-wire migration: every delta shape here is new (no older store holds a `loam.user`
or `loam.role` claim), so no §20 step is owed.

## Acceptance criteria

Every criterion is proved in `test/server/users-ground.test.ts` unless a bare command is named.
Rails are declared at P3, once these tests exist and are red.

1. A user is an ENTITY whose properties resolve through a Schema — stated in `src/server/users.ts`'s
   header prose, and the collapsed phrasing ("the half of a user that IS a delta") does not
   recur. Verified by `test/server/users-ground.test.ts` (a rail reads the source file's header and
   asserts the vocabulary) and `grep -c "half of a user that IS a delta" src/server/users.ts`
   returning `0`.
2. "Operator-signed" is enforced on the READ, not asserted on the write: an ordinary author with no
   special standing signs a user or role claim, and the ground accepts it (the delta is admitted),
   because `userHyperSchema`'s select is what excludes it, not the append door. Verified by
   `test/server/users-ground.test.ts`.
3. A stranger's negation does not retract what the store's seed said, asserted at both levels: the
   negation delta IS in the store (`reactor.negationsOf` / `reactor.get` finds it), and
   `resolveUserView`/`rolesOf` still show the struck-at claim as live. Verified by
   `test/server/users-ground.test.ts`.
4. A store with no operator (`operator: undefined`) yields no user and no role: `resolveUserView`
   and `rolesOf` both answer empty/undefined. Verified by `test/server/users-ground.test.ts`.
5. A struck role binding leaves the user readable and that role absent from the set, asserted at
   both levels: the negation is in the store, and `rolesOf` no longer contains the role while
   `resolveUserView` still resolves the user. Verified by `test/server/users-ground.test.ts`.
6. A user holds many roles at once: grant `operator` and `actor` to one user with the Policy `all`,
   and `rolesOf` contains both. A `pick`/`pickLatest` policy would let the later grant silently
   displace the earlier one; the rail grants both and asserts both survive. Verified by
   `test/server/users-ground.test.ts`.
7. A user with no grants resolves to an EMPTY SET — never `undefined`, never a default role.
   Verified by `test/server/users-ground.test.ts`.
8. The reading function is `rolesOf`, returning a `ReadonlySet<UserRole>`; there is no `roleOf`
   naming a single role. Verified by `test/server/users-ground.test.ts` (calls `rolesOf` and
   asserts the return is a `Set`) and `grep -c "export function roleOf" src/server/users.ts`
   returning `0`.
9. A user name is safe in an entity id, a JSON object key, and an HTML page — one expression,
   `userNameDefect`, stated once and reused by both the id constructor and any future rendering.
   Verified by `test/server/users-ground.test.ts`.
10. Many users may hold the operator role: each user is its own entity, so the shape carries no
    limit of one. Assign `operator` to two users and `rolesOf` contains it for both; revoke one and
    the other survives. Verified by `test/server/users-ground.test.ts`.
11. The role read names the store's own seed and nothing else — never widened to a trust set, and
    the prose never calls it "the genesis operator's" (§9a: every operator is equivalent, the seed
    belongs to the store). Verified by `test/server/users-ground.test.ts` and
    `grep -ic "genesis operator" src/server/users.ts` returning `0`.
12. A role claim signed by any key other than the store's seed resolves to nothing, asserted at
    both levels: append it, and `reactor.get` finds the delta (it IS in the store) while
    `rolesOf` for that user is empty; append the same claim signed by the store's seed instead, and
    `rolesOf` contains the role. Verified by `test/server/users-ground.test.ts`.
13. A role the user does not hold is simply absent from the set (never guessed at on read), and an
    unknown role NAME is refused before it can be asserted — a pure validator over the role string
    that a future write path (phase 3's CLI) consults before it ever signs a claim — never silently
    admitted into the set. Verified by `test/server/users-ground.test.ts`.
