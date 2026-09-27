# Users are named by a stable id (step 5, before 3g)

Status: design, for Sol's review. Ruling 9 (delegated to Claude and Sol).

## The problem

Grants, memberships and recovery records name a user as `user:<name>`. A name can be reused.
If the operator erases ada, and later creates a new person also called "ada", every grant,
membership and recovery record that still names `user:ada` would stand for the new person. The
old person's standing would pass to someone else.

## The rule

- Each person has an ID that the operator mints once, at `loam user create`, and never reuses.
- The ID is `~` followed by 32 lowercase hex digits. A user name can never contain `~`
  (`userNameDefect`), so the two namespaces cannot collide.
- Everything about the person is filed at `user:~<id>`: the user record (which carries the name
  as a label), roles, the root claim, recovery records and lineage claims.
- Every subject that names a person names the id: grants (`user:~<id>`), memberships
  (`loam.memberOf.user` becomes the id) and recovery records.
- The name is only a way to find the id: the credential file, the CLI, and the login page take a
  name.

## Name to id

One reader resolves a name: `userIdOf(reactor, operator, name, now, cut?)`.

- The operator signs a NAME claim at `username:<name>`, in context `loam.userid`, whose value is
  the id.
- The reader takes the latest standing name claim: verified, operator-signed, valid at `now`, not
  struck by a verified operator strike in force at `now`, not erased. Ties go to the smaller delta
  id.
- It then proves the other direction: a standing user record at `user:~<id>` names the same
  `name`. "Standing" is the same test: a verified operator-signed claim in context `loam.user`,
  valid at `now`, not struck by a verified operator strike in force at `now`, not erased.
- An as-of read passes `cut`: only claims and strikes signed by then count, as the #625 user ground
  does for roots.
- If either direction fails, the name resolves to no one. This fails closed.
- The door, the View reader and the CLI all use this one reader.

## Erasing and reusing a name

- Erasing a person erases the records at their id and their name claim.
- A new person with the same name gets a new id and a new name claim. Grants, memberships and
  recovery evidence that name the old id resolve to nothing: no user record stands there.
- Every user record is ALSO filed at `username:<name>` (context `loam.userrecord`). So
  `nameStillHeld` finds a previous person's id through their held user record even after the name
  claim's bytes are purged. `loam user create` refuses a name while any operator claim filed at
  `username:<name>` is held, whether a name claim or a user record.
- The old id is never minted again: ids are random, and 128 bits do not repeat.

## What changes

- `userEntity(name)` becomes `userEntity(id)`, and every caller that has a name resolves it first.
- The provisioning, CLI (`user create`, `assign-role`, `remove-role`, `recover`) and login paths
  resolve name to id once, at the start.
- Bind's `ownerName` becomes `ownerId`, resolved by the server from the session's user.
- `loam.memberOf.user` takes the id. The node's validator accepts the id form only.
- Greenfield: stores that name users by name are not read. No migration.

## Rails

Each crosses login, roles, root, grants, memberships and recovery together.

- **I1.** Create ada (id A). Grant by id. Ada logs in, holds her role, writes; her membership
  selects her writes.
- **I2.** Erase ada fully. Create a new ada (id B). The old grant naming A gives B nothing; B's
  login reaches B; B holds none of A's roles; a membership naming A selects none of B's writes;
  recovery records at A do not apply to B.
- **I3.** A name claim and a user record that disagree resolve to no one, at the door, in the
  View reader, and in the CLI.
- **I4.** An unsigned or non-operator name claim is ignored.
- **I5.** A membership or grant naming a display name (`user:ada`) is refused at the door as
  malformed: only the id form is a user subject.
