# 64 — Erasing a live channel opening slates it until the drop; lifecycle files under the container

Working design, T289. Stacks on T288 (#566), which is not yet merged. Nothing here is shipped.
Baseline: `origin/main` at `74bd30ce`, 2026-09-08.

## The people and the acts

1. Myk opens a channel from a peer into `friends`. Later he erases the channel's opening event
   while the pool is still attached. He expects the store to refuse to nuke anything on its own:
   the opening is condemned, the channel stops receiving, and the store tells him the container
   must be dropped to finish. He can still read and extract deltas from the pool first. When he
   drops it, the erase completes and a fresh open of the same name starts clean.
2. Myk erases one receipt of a channel, not its opening. He expects the channel to keep working
   and that receipt's contribution to be gone, exactly as T288 promises today.
3. Alice, bound to `friends`, opened a channel there through her connection. She expects to see
   that channel's lineage, its open, receipts and close, through her own container's surface, and
   nothing about channels in other containers.
4. Myk reads the lineage of `friends` as its operator. He expects each event to say which
   container it belongs to, so a tool can list a container's channels without a name scan.

## Decision ledger

**Decided by Myk, 2026-09-08 and corrected 2026-09-09, in chat:**

- A random erasure must not be able to nuke a whole subset of the database. Erasing a live
  channel opening does NOT purge the pool. The opening stays SLATED and uneraseable until the
  container is dropped. The store makes that clear, and the container must be dropped, which
  leaves room to extract other deltas first. This corrects the 2026-09-08 ruling "erasing an
  opening is tantamount to a drop", which is withdrawn.
- Channel lifecycle events are tracked by the parent container, not only at the root.

**Decided by Myk, 2026-09-08, in chat, after the premortem:**

- The channel's ordinary status stamps stay when the opening is erased. The marker says the lineage
  is gone; the status says what it was about. Erasing the status would make the hole unexplainable.
- One container pointer, at `into`, never one per ancestor. A pointer per ancestor would carry a
  container's records outside the context that bounds them, and would freeze the tree shape into
  every event.

**Superseded by these rulings:** PR #567's cleanup vocabulary (`cleanup` events, the `erased`
history state, the retry protocol). It is not to be merged. T288's ability to erase a LIVE opening
outright, and its "erased opening" refusal of `drop`, stay only as the transitional state between
#566 landing and this ticket landing.

**Not decided here:** the channel token file left behind by `federate drop`; MCP-opened channels
recording no address. Both belong to a separate ticket.

## Contract

### Erasing a live opening slates it; the drop is the cut

`Gateway.erase(openingId)` on a protected `open` event whose pool is still attached (a pool whose
`declarationId` equals the opening's `poolDeclaration` is in `channelPools`) does not erase and
does not purge. It:

- runs under `withChannelCommit(channel)`;
- writes a §29 slate over that incarnation: the opening, its `received` events and its `close` if
  any, pinned by content address on the slate record, with `reason` naming the erase and the
  channel's pool container as the thing that must be dropped;
- refuses the erase with a message that says the opening is slated and the container
  `<pool name>` must be dropped to complete it, and that the pool's deltas can be read or
  extracted until then;
- purges nothing and detaches nothing.

While the slate stands: the channel's `sync` refuses ("slated"), because the slate closes
propagation over the opening and no new receipt may cite it; `channelStatus` shows the channel
standing and slated; every read of the pool works as before, so the operator can extract what
they want to keep; a second `erase(openingId)` refuses and names the standing slate; a fresh
`openChannel` of the same name refuses and names the slate.

`dropChannel` on a slated channel is the cut. It purges the pool at the bytes through the existing
byte-verified drop, detaches it, and then completes the slated erase: the opening, its receipts and
its close each receive a marked tombstone, and the slate is retired the way §29.5 retires a cut
slate. If the pool purge refuses, the drop refuses as today and the slate stays standing; nothing
is erased. After the cut, `localChannelEvidence(channel)` reports `unavailable` with reason
`erased`, and a fresh `openChannel` of the same name is a new protected opening.

`Gateway.erase(openingId)` on an opening whose pool is NOT attached (the incarnation was dropped,
or the store booted without it) erases directly: the opening, that incarnation's receipts and
close, each with a marked tombstone naming the channel and the pool declaration. It touches no
pool. This is what T288 promised and what its "previous incarnation" gap needed: a later
incarnation's history is unaffected, because the erased receipts no longer reference a hole.

`erase(receiptId)` and `erase(closeId)` behave as T288 promises today. They are not openings and
slate nothing.

### Where lifecycle events live

Every protected lifecycle event (`open`, `received`, `close`) carries an entity pointer at the
parent container: role `into`, context `loam.local.channel.event`, id = the `into` container name,
in addition to the `channel:<name>` event entity. It must NOT use role `container` at context
`loam.container`: that pair is the container-declaration vocabulary, `containerDefect` refuses a
delta in it that lacks trust and posture, and the container table would read the event as law.

The record still lives in the receiver's root reactor: the operator signs it and the root is the
operator's authority. The pointer scopes READS, not membership: a shared container's members come
from its membership term, and the pointer joins no term.

- The bound connection's lineage read (the same read that serves `channelStatus` to a bound door)
  filters lifecycle events by the `into` pointer equal to its binding's container. It lists that
  container's channels and no others.
- The operator's read may filter by the pointer to list one container's channels without a name
  scan.
- Container reach walks and the container table never treat a lifecycle event as law.
- Dropping a shared container does not cascade over these events; there is no such road today
  (`drop()` is a separate container's total forget). That stays out of scope here.

### Migration

No store migration: T288 has not merged, and T289 stacks on #566, so no store holds an event
without the pointer or a marker without the declaration.

Two T288 cases in `test/federation/local-channel-events.test.ts` pin the transitional behaviour
this spec replaces: "erase(open) loses incarnation without removing receipt/source/bystander" and
"erase(open) before any receipt is erased history, never legacy: a resumed handle cannot sync
unprotected". Both erase a LIVE opening outright; under this spec that erase slates instead. They
must change. They are not frozen until #566 lands, so T289 lands in the same
stack before #566 merges, or, if #566 merges first, through the authorized whole-file revision
road in `scripts/rail-renames.json` (the #560 precedent). No quiet rewrite.

## Acceptance criteria

Each rail is two-sided: the target gone at the bytes AND a named live bystander surviving. Each
criterion names its verification.

1. Erasing a live opening purges nothing and detaches nothing: the pool, the sibling channel's
   pool and the root ground hold the same bytes before and after; a §29 slate stands over the
   opening, its receipts and its close, pinned by address; the refusal names the pool container
   that must be dropped. Verify:
   `npx vitest run test/federation/local-channel-slated-opening.test.ts`
2. While slated: `sync` refuses as slated and no new receipt lands; a read of the pool returns
   every delta it held; a second erase and a fresh same-name open both refuse and name the slate.
   Verify:
   `npx vitest run test/federation/local-channel-slated-opening.test.ts`
3. `dropChannel` on a slated channel purges the pool at the bytes, detaches it, then tombstones
   the opening, its receipts and its close with marked tombstones and retires the slate; the
   sibling pool and the root ground are unchanged; evidence reads `unavailable: erased`; a fresh
   same-name open is a new protected opening that receives cleanly. Verify:
   `npx vitest run test/federation/local-channel-slated-opening.test.ts`
4. A pool purge that refuses leaves the slate standing and erases nothing; the report says the
   content is still held; a retry of the drop completes the cut. Verify:
   `npx vitest run test/federation/local-channel-slated-opening.test.ts`
5. Erasing the opening of a dropped incarnation erases that incarnation's opening, receipts and
   close directly, touches no pool, and leaves a later incarnation of the same name open and
   receiving; erasing a receipt or a close slates nothing and behaves as T288 promises. Verify:
   `npx vitest run test/federation/local-channel-slated-opening.test.ts test/federation/local-channel-events.test.ts`
6. Every lifecycle event carries the `into` pointer at the event context; `containerDefect` does
   not see it; the container table does not read it; the generic append and federate doors still
   refuse it. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
7. A bound connection's lineage read lists the channels opened into its container and none from
   another container; the operator's read filtered by pointer lists one container's channels.
   Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
8. The two T288 cases named under Migration are revised in the same stack or through the
   authorized revision road; the header of the file records which. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
9. rails-red: every new rail file copied onto the #566 tip fails to load or fails its cases; the
   header of each file records the run. Verify:
   `git -C <worktree-at-566-tip> stash && npx vitest run test/federation/local-channel-slated-opening.test.ts test/federation/local-channel-container-scope.test.ts`
10. Full bar green and hollow-test run first on the clean tip, then recorded. Verify:
    `npm run check` and `adlc hollow-test --base origin/t288/local-channel-events --max 300 --test-cmd "timeout -k 10 600 npx vitest run test/federation/local-channel-*.test.ts"`

## Premortem, 2026-09-08

Six findings, all folded above: the `container`/`loam.container` pointer collided with the
declaration vocabulary; the pool must be found by declaration, not by name, or an erase of an
old opening purges a re-opened pool; two T288 cases pin the behaviour this replaces; the erase
order writes the tombstone first, so "nothing written" was false; the erase needs the channel
commit lock; and story 4 named a container drop road the code does not have, and criterion 7 a
scoping mechanism the gather does not have.
