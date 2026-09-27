# What `user:ada` means (step 5)

Status: decided under ruling 9, after Myk's correction of 2026-09-29. It replaces an earlier draft
that minted random ids; that draft was never built.

## The rule

- `user:ada` is an entity id. It happens to be readable; it is not a display name that stands for
  some other id.
- Equal entity strings are one entity (SPEC-6 §1: they merge on union). Anyone may point at it.
- What `user:ada` means is a View: the claims about that entity that the governing account of the
  peer being read chooses to honor. Two peers may make different governed claims about the same
  entity, and so render different Views of it. That is one entity seen two ways, not two hidden
  identities.
- Authority comes only from who signed a claim. A grant naming `user:ada` in a peer is that peer's
  account saying "whoever I call ada".

## Reusing a name

- There is no global uniqueness, and no reservation. Claims are just claims.
- Giving `user:ada` to a new person continues or reassigns that entity in the peer's view. The
  account's earlier standing claims about it (grants, memberships, roles, root) still bind unless
  that account strikes or erases them. That is the account's choice, not a hole.
- `loam user create` guards against doing this by accident: it refuses while standing grants or
  memberships still name the entity, and says what it found. The account strikes them first, or
  keeps them on purpose. This is tooling, not a substrate invariant and not a security boundary.
- A truly distinct person needs a distinct string, chosen when they are created.
- If the entity already has a recovery chain, giving it to a new person is a recovery to a new key,
  under the existing rules.

## Whose account

- There is no global operator. Each peer has its own governing key (SPEC-6 §1: PeerId is the
  governing public key; additional governors are pinned in that peer's local config). SPEC-14 §1
  requires the principal root to be pinned outside the evidence.
- In Loam today, the "operator" argument every reader takes IS that pinned key, for the ground being
  read. The word is legacy. Step 6 replaces it with "this peer's governing account".
- Today Loam's inbox pools share the host's key, so they are surfaces of one peer, not separate
  peers. When a pool becomes its own peer (step 6, ruling 7), following the host's user claims
  becomes an explicit cross-peer trust policy: it names which peer and account supply user claims,
  at what read time, and how they are admitted. It is never automatic because entity strings match.
  The current `userGroundOf` borrows the host implicitly; step 6 makes that input explicit.
