# Step 6: the container split (design note)

Status: design note, 2026-09-29, for Myk's review. No code. Ruling 13 (README) makes this the last
part of step 6. It starts after merge 3 (new pools under their own key) lands.

## The promise

- A person sees no change. Every door, command and page answers as before.
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
  `connectionInboxes`) and then call into the child `Gateway`.
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

What the host keeps: a container table of `PeerHandle`s by name, in place of the three child maps.
The identity checks in kind F become "is this handle still the one in my table?".

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
7. **The split.** `Container` holds the per-peer core. `Gateway` stays as the root's public
   facade for `http.ts`, the CLI and embedders, so their code does not change. Its child maps
   become the container table.

## Rails

- The census ratchet gains one count: lines outside `container-open.ts` that touch
  `attachedTo` or a child map (88 today). It must fall with each PR, and it ends at 0.
- `importCycles` must fall to 0, and the ratchet then holds it there.
- A new test asserts that no container module imports the host facade.
- The full suite and every recording stay unchanged. A moved recording means a behaviour change,
  and that is a finding.

## Questions for Myk

1. **The public name.** I propose to keep `Gateway` as the name of the root's facade, so callers do
   not change, and to name the per-peer core `Container`. The other choice is to rename the facade
   `Host`, which changes 46 source files and about 320 test files. My recommendation: keep `Gateway`.
2. **Timing.** I propose to start after merge 3 lands, because merge 3 changes the same pool
   opener. The other choice is to start with steps 1 and 2 now, because they touch only module
   boundaries. My recommendation: start steps 1 and 2 now, in parallel with merge 3's review.

## Size

About 7 PRs. Steps 1, 2 and 7 are mostly mechanical moves. Steps 3 to 6 change how containers
call each other, and they carry the review risk.
