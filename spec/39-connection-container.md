# §39. A connection binds to a container

An MCP connection binds to exactly one container. Reads gather that container — everything in it,
wherever a delta originated. Writes land in it, through a per-connection **inbox** pool, signed by the
connection's own key. The key is provably the owner's, and every write it makes is attributable to
that one connection.

## 39.1 The model

1. **A connection binds to exactly one container.** The binding is the connection's whole world.
   Reads gather that container; writes land in it.
2. **The binding is an upper bound, not a routing rule.** A connection bound wide addresses
   sub-containers by naming them (`connectionScope` walks the parent chain and refuses a target
   outside the bound subtree). A connection bound narrow cannot reach outside. Same mechanism; the
   owner chooses the width by choosing the binding.
3. **The owner acts; the connection carries.** Every read and write through a connection is the
   owner's, in their capacity as owner. The operator is an administrative capacity of the store,
   orthogonal to ownership; it never appears on the read or write path. It appears exactly once, at
   provisioning, to establish the owner's authority over the owner's own inbox.
4. **The degenerate case is not special.** A store with no user-made containers is a root container
   with a heap in it. One connection binds to it with no extra machinery.

## 39.2 Membership decides reach

A negation is an ordinary delta. If a claim and a strike of it are both in a container's gathered
deltas, the reader's Schema resolves the claim as struck — it does not matter who signed the strike.
Reach is a property of membership, not of authorship: the deliberate act is admitting a delta to a
container, and once admitted, it is in play.

Per-container divergence falls out of this. A claim admitted to `folklore` and to `friends`, with a
strike admitted to `folklore` only, resolves absent in the folklore read and present in the friends
read. Neither read consults the other; each gathers its own members and closes over its own strikes.

## 39.3 The inbox

A shared container is a membership Term over the primary ground. A separate pool is not in that
ground, so a Term cannot reach it — "file a write into a Term-defined container" has no mechanism on
its own. The inbox is that mechanism.

Binding a connection **spawns an inbox**: a fresh separate pool, one per connection, declared with an
`inboxOf` pointer naming its parent container. The inbox is a member of the container by composition —
`containerScope` gathers, alongside the parent's own members, every active pool whose declaration
marks the parent. So the connection reads back what it wrote, and any reader of the container sees it
too. The inbox remains a container in its own right: `drop()` and forensics still reach it directly.

Three properties follow from writing landing in the inbox pool and nowhere else:

- **Write enforcement is structural.** A connection write goes to its inbox. "Outside the bound
  container" has no expression — the write physically enters the pool through the pool's own door.
- **Revocation is a strike of the connection's grant.** Striking it refuses further writes; the inbox
  and its past deltas remain, keeping their author. One connection's blast radius is one inbox.
- **A per-connection drop is a total forget.** Dropping the inbox purges its bytes (with a byte-level
  verification that refuses to close if any survive) and strikes its declaration, removing the grant
  and every delta the connection wrote, within this store's grounds, with nothing promoted out.

### Authority — the grant chain in the pool's own ground

The inbox pool keeps the store operator as its operator, so every existing lifecycle-signing site
stays valid. Authority is established by the grant chain the store already resolves recursively:

1. At **provisioning**, the store operator authors an `admin` grant naming the **owner**, in the
   inbox pool's own ground. It is effective because the operator is the pool's operator.
2. At **consent**, the **owner** authors a `write` grant naming the connection's key, in that same
   ground. It is effective because the owner holds admin from step 1.
3. A connection **write** is admitted by the pool's own door: the grant walk resolves
   connection-write → owner-admin → operator.

The grants live at the pool's store entity, in the pool's own reactor, so they never touch the real
store's authority. The connection grant is owner-authored — the owner's signature is the authority —
and the operator never signs a read or a write. Re-binding the same connection is idempotent: a
surviving grant is not re-minted, and the durable pool is resumed rather than re-spawned.

### The disconnect lifecycle

The inbox is durable. A disconnect leaves it attached — it never becomes an unattached separate
container, so a parent read never faults and never silently drops the connection's writes. A
reconnect with the same connection identity resumes the same inbox. Only an explicit revoke (strike
the grant; writes refused, deltas kept) or drop (purge the pool; total forget) changes its state. The
binding is robust to connect / disconnect / connect.

## 39.4 Negation closure is container-wide

Because a container composes its primary ground with each inbox pool, a strike of an admitted delta
can live in any of those grounds. `containerScope` gathers the admitted deltas across all contributing
grounds and closes negation **once over the union**, asking every ground for the negations of what is
admitted. A per-ground closure would treat a separate pool as a closure boundary and hand a reader a
claim while its strike sat one ground over — the H1 strand, relocated across the pool boundary. The
union closure is monotonic: it only adds strikes of admitted deltas to the gathered set, never drops a
member and never revives a struck claim.

## 39.5 What this section does not do

It does not build operator promotion of container claims, ejection (a container leaving with its
owner), or a guard on binding a connection to the store's root. It does not narrow the power a grant
carries: a granted author is a lawful author within its inbox. Narrowing is a later section.

**Provenance.** Working spec `.adlc/specs/39-connection-container.md` (T138). Landed
[#PENDING](https://github.com/bombadil-labs/loam/pull/PENDING) — the inbox model in
`src/gateway/container.ts` (`bindConnectionImpl`, `revokeConnectionImpl`, `connectionScopeImpl`, the
`inboxOf` declaration field, and `containerScopeImpl`'s inbox composition), the union closure
`withNegationClosureAcross` in `src/gateway/ingest.ts`, and the `bindConnection` / `revokeConnection`
/ `connectionScope` gateway seam. No change to root authorization: the pool's own door and the
existing grant-chain recursion carry it.
