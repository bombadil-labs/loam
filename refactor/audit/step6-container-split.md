# Step 6: the container split (design note)

Status: design note, 2026-09-29, reviewed by Myk. No code. Ruling 13 (README) makes this the last
part of step 6. Steps 1 and 2 start now; steps 3 to 7 start after merge 3 (new pools under their
own key) lands.

## Myk's direction (2026-09-29, in chat)

"You can keep the gateway name but the important thing is that it stops being the god-object
around which the entire store is organized. We could for instance have in theory the ability to
different peers to open their own gateways on different ports within the same store, or a root
gateway that uses container nesting as path nesting to serve different stuff, idk, but it's
crucial that a single stateful Gateway no longer be the source of truth for everything." And:
"sure do the split steps."

## The promise

- A person sees no change. Every door, command and page answers as before.
- No single stateful `Gateway` is the source of truth. The store is a tree of containers. A
  `Gateway` is a serving facade over one container, and it holds no store state of its own.
- So more than one `Gateway` can serve the same store: one per container on its own port, or one
  root `Gateway` that maps container nesting to path nesting. The split makes both possible; it
  does not build either.
- Each container is one peer type. The host is only the root container. It has no special class.
- A container does only its own work: its journal, its admission, its reads, its erasure and its
  law (ruling 11).
- One container reaches another only through a small peer interface. No container reads or
  writes another container's members.
- The census shows 0 import cycles. Today it shows 2 (22 files).

## Today's shape (measured on main, 9bc70e31)

- `src/gateway/gateway.ts` has 2,195 lines. The `Gateway` class has 176 members.
- 35 source files reach into `Gateway` members. The top five are `container.ts` (30 members),
  `http.ts` (29), `lifecycle.ts` (25), `channel.ts` (23) and `renderers.ts` (23).
- One class plays four roles: host, channel pool, quarantine pool and inbox pool. A pool is a
  second `Gateway`, and it holds its host in `attachedTo`.
- 23 lines in 7 files use `attachedTo`, the link from a pool to its host.
- 88 lines in 19 files read a host's child maps (`quarantinePools`, `channelPools`,
  `connectionInboxes`) and then call into the child `Gateway`. Counted together with the
  `attachedTo` lines, 105 distinct source lines touch a child map or the parent link.
- The value-import cycle has 20 files and 74 edges. `container.ts` is its hub: 14 files in the
  cycle import it. Most of them take only pure readers from it, such as `readContainerTable`
  (11 files) and `containerClaims` (5 files). `container.ts` also opens pools, so it imports
  `Gateway`, and `gateway.ts` imports it back.

## The cross-container calls, by kind

| kind | what happens today | where |
|---|---|---|
| A. lifecycle | the host opens, attaches, detaches and closes a child `Gateway` | `container.ts`, `channel.ts` |
| B. reads across | the host reads a child's reactor to gather a container scope, a bound surface, an admin row or a census count | `reads.ts`, `renderers.ts`, `admin*.ts`, `container-census.ts`, `mounts.ts` |
| C. writes into a child | the host signs a delta and appends it straight into a child | `channel.ts` (sync), `adopt-law.ts`, `user-recover.ts`, `slate.ts` |
| D. erasure fan-out | the host calls `eraseReplica` on each child; the child walks `attachedTo` to find its authority | `erase.ts` |
| E. child reads its host | users (`readUsersFrom`), selected host law (`childLaw`), and the root for a renderer context | `container.ts`, `renderers.ts`, `local-channel-events.ts` |
| F. identity checks | "is this pool still attached to me?" (`ground.attachedTo !== gw`) | `ingest.ts`, `channel.ts`, `erase.ts`, `local-channel-events.ts` |

## The peer interface (proposal)

What a container offers to another container:

- `id`: its PeerId (its own key after merge 3).
- `admit(deltas, origin)`: the federation door. It returns the report the door returns today. It
  replaces kind C: a host act reaches a child only as deltas the child admits.
- `deliver(order)`: an erasure order that names this container as its receiver (SPEC-6 §3). The
  child admits it, purges, settles, and returns an erasure report. It replaces `eraseReplica` and
  the `attachedTo` authority walk in kind D.
- `read(request)`: the read surfaces a host needs from a child: a container scope, a bound
  surface, a health row and a census count. It returns data, never the child's reactor. It
  replaces kind B.
- `close()`.

What a container receives from its parent when it opens (ports, not the parent object):

- `users`: a read-only user ground (replaces `readUsersFrom`).
- `hostLaw`: the selected host law per context, as a lawful read (replaces the reads through
  `childLaw` that reach the host's reactor).
- `erasureGovernors`: the keys it pins (merge 3 already sets these).
- `rootContext`: what a renderer context needs from the root (replaces the root walks in
  `renderers.ts`).

The tree's shared services (one per store, owned by the store, not by any container or
`Gateway`):

- **The container table:** `PeerHandle`s by name and by parent, in place of the three child maps.
  The identity checks in kind F become "is this handle still the one in the table?".
- **The backend registry:** every store backend open in the tree. A new open is checked against
  all of them, so a later drop can never purge a sibling's bytes (`container.ts` does this today
  by walking to the root).
- **The commit coordinator:** the per-channel commit queue that sync, drop and erase work share
  across the tree (`channelCommitTails`, reached today by walking to the root in
  `local-channel-events.ts`).
- **Live root policy:** the reads a child must take from the root at use time, not at open time,
  such as the leeway table behind a child's envelope ceiling. A later leeway change then takes
  effect, as it does today.

A container receives these as ports too. It never receives the root container itself.

The facades: a `Gateway` serves doors (GraphQL, REST, MCP, pages) over one container, and reads
the store through the peer interface and the shared services. It owns no deltas, no table and no
queue. The CLI and `http.ts` keep calling `Gateway`, so their code does not change.

## The move order (each step is one small PR, and no step changes behaviour)

1. **Leaf modules.** Split `container.ts` into `container-law.ts` (the pure table readers, no
   `Gateway`) and `container-open.ts` (the pool opener). Move `NUL` to a leaf module. Make the
   `renderer-context.ts` import of `Gateway` type-only. Measure: the cycle shrinks.
2. **Pure readers out of effectful files.** Move the erasure, slate and account readers that other
   files need into law modules, apart from `eraseImpl`, `appendImpl` and the other effects. The
   remaining cycle is then the effect files that call each other.
3. **Ports at open.** `container-open.ts` gives each child its ports. Replace the `attachedTo`
   walks (kinds E and F) with ports and handle checks.
4. **Writes as admission.** Host writes into a child (kind C) go through `admit`.
5. **Erasure as delivery.** The fan-out (kind D) goes through `deliver`.
6. **Reads as requests.** Reads across (kind B) go through `read`.
7. **The split.** `Container` holds the per-peer core. A `Store` object holds the tree and its
   shared services. `Gateway` becomes a facade over one container of a store, for `http.ts`, the
   CLI and embedders, so their code does not change. Its child maps become the container table.

## Rails

- The census ratchet gains one count: distinct source lines outside `container-open.ts` that
  touch `attachedTo` or a child map (105 today). It must fall with each PR, and it ends at 0.
- Two rails prove that no state lives in a `Gateway`:
  - Two `Gateway`s over the SAME container: a write through one is served through the other.
  - Two `Gateway`s over two containers: a write admitted to one is not served through the other,
    unless the other composes it explicitly (ruling 11: an operation is scoped to its peer).
- `importCycles` must fall to 0, and the ratchet then holds it there.
- A new test asserts that no container module imports the host facade.
- The full suite and every recording stay unchanged. A moved recording means a behaviour change,
  and that is a finding.

## Myk's answers

1. The public name stays `Gateway`, and it stops being the god object (see "Myk's direction").
2. Steps 1 and 2 start now.
3. (2026-09-30) Step 6 closes after the peer interface is small, not before ("B"). Reads keep a
   read-only view of a child's rows; named read answers wait for the audit.

## The narrowing (Myk's "B", 2026-09-30)

Split steps 1 to 3, the gateway views and 0 import cycles landed first (#670, #674 to #677). The
peer interface then narrows in four PRs:

1. **Handles and reads.** Each container's table of children lives in the Store. Container code
   (`src/gateway`, `src/federation`) holds a child only as a `Peer` (`src/gateway/peer.ts`), a
   `Pick` of the `Gateway` members one container may use of another. The census counts them
   (`peerSurface`). `Gateway` keeps its table names as getters over the Store, for the facades.
2. **Pool operations.** A pool signs its own strikes, manifest rows, arrival stamps, grants and
   revocations (`strike`, `exportManifestRows`, `arrivalStamps`, `issueGrant`, `revocations`), and it
   already adopts law itself (`adoptLaw`). No code signs with a pool's key except the pool's own
   operations, the opener included. `signer`, `stamp` and `def` leave `Peer`. The doors (`append`,
   `federate`) stay: they admit deltas their own authors signed. The opener still stamps a
   person's own delegation or revocation with the pool's clock, when that person signs it.
3. **Erasure as delivery.** A pool answers read-only questions about its own stored bytes
   (`probe`: one id, a batch, any bytes at all, the inventory), and it still takes an erasure as a
   delivered order (`eraseReplica`) that it admits, purges and settles itself. `backend` leaves
   `Peer`: only the opener, which attaches, discards and closes a pool, reaches a child's store.
   A pool reads the chain above it as peers (`Store.chainAbove`); the rule for which local-control
   orders it admits is one function (`localOrderAuthorized`), railed case by case.
4. **Lock.** `treeReach` is 0 and the ratchet holds it there. A channel's record carries its
   pool as a `PeerEntry`, so container code builds no record from the opener's table. The opener
   marks a channel pool before it attaches it. `npm run peer-probe` type-checks `src/` with each
   child handle typed as a `Peer` and fails on any container code, outside the opener, that uses
   more. Step 6 is closed.

**The census, as of PR 1.** `treeReach` counts lines of container code that reach the tree as
gateways: a table name, `tableOf`, a parent or root walk, a channel record, or a binding's pool as a
gateway. The opener (`container.ts`) and the Store are exempt, and so is a facade's own definition
of one of those names. The doors and commands (`src/server`, `src/cli`) are not counted: each is a
facade over one container of the store, so it may look a container up in the table and serve it.
This replaces the first definition above (all source outside the opener, 105 lines), which counted
the facades as containers.

## Size

About 7 PRs. Steps 1, 2 and 7 are mostly mechanical moves. Steps 3 to 6 change how containers
call each other, and they carry the review risk.
