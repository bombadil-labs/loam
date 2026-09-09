# 64 — Erasing a channel opening drops its pool; lifecycle files under the container

Working design, T289. Stacks on T288 (#566), which is not yet merged. Nothing here is shipped.
Baseline: `origin/main` at `74bd30ce`, 2026-09-08.

## The people and the acts

1. Myk opens a channel from a peer into `friends`. Later he erases the channel's opening event.
   He expects the channel to be gone: no sync, no drop to run, no peer bytes left attached under
   its name. A fresh open of the same name starts clean.
2. Myk erases one receipt of a channel, not its opening. He expects the channel to keep working
   and that receipt's contribution to be gone, exactly as T288 promises today.
3. Alice, bound to `friends`, opened a channel there through her connection. She expects to see
   that channel's lineage, its open, receipts and close, through her own container's surface, and
   nothing about channels in other containers.
4. Myk drops the container `friends`. He expects the channels opened into it, and their lineage
   records, to go with it, the way the container's other records do.

## Decision ledger

**Decided by Myk, 2026-09-08, in chat:**

- Erasing an opening is tantamount to a drop. "The store's presence has been erased." The pool is
  purged as part of the erase; no later cleanup act exists.
- Channel lifecycle events are tracked by the parent container, not only at the root.

**Superseded by these rulings:** PR #567's cleanup vocabulary (`cleanup` events, the `erased`
history state, the retry protocol). It is not to be merged. T288's "erased opening" refusal of
`drop` stays only as the transitional state between #566 landing and this ticket landing.

**Not decided here:** the channel token file left behind by `federate drop`; MCP-opened channels
recording no address. Both belong to a separate ticket.

## Contract

### Erasing an opening

`Gateway.erase(openingId)` on a protected `open` event:

- purges the opening's bytes on every tier, as any erase does;
- fans out, inside the same erase, to the exact attached pool the opening's `poolDeclaration`
  names: that pool is purged at the bytes and detached, through the same path `dropChannel` uses
  today, with the same `holds` verification and the same refusal on a survivor;
- erases that incarnation's `received` and `close` events, each with its own marked tombstone, so
  no receipt references a hole;
- keeps the local-control marker naming the channel and the pool declaration, so a later reader
  sees "erased", never "legacy";
- leaves every other pool, the receiver's root ground, and every other channel's lineage untouched.

After the erase, `localChannelEvidence(channel)` reports `unavailable` with reason `erased`, and
`openChannel` for the same name is a fresh protected opening. `dropChannel` on an erased name is a
no-op refusal that says the channel is already gone.

If the pool purge refuses (a survivor at the bytes), the erase refuses as a whole and reports it,
exactly as `dropChannel` does; the opening's tombstone is not written first. No partial state.

### Where lifecycle events live

Every protected lifecycle event (`open`, `received`, `close`) carries an entity pointer at the
parent container, role `container`, context `loam.container`, id = the `into` container name, in
addition to the `channel:<name>` event entity. The record still lives in the receiver's root
reactor: the operator signs it and the root is the operator's authority. The container pointer is
what scopes it:

- a bound connection's surface over `into` includes the lifecycle events of channels opened into
  `into`, and no others;
- `dropChannel`-by-container (the container drop road) cascades over these events with marked
  tombstones, the same way it cascades over the container's other records;
- container reach walks never treat a lifecycle event as law.

### Migration

None. T288 has not merged; T289 lands as a stacked PR on #566, so no store holds an event without
the container pointer or a marker without the declaration.

## Acceptance criteria

Each rail is two-sided: the target gone at the bytes AND a named live bystander surviving. Each
criterion names its verification.

1. Erasing an opening purges its pool at the bytes and detaches it; the sibling channel's pool and
   the root ground hold the same bytes before and after. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
2. Erasing an opening erases that incarnation's receipts and close with marked tombstones; another
   channel's receipts survive. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
3. After the erase, evidence is `unavailable: erased`, `sync` on a stale handle refuses, `drop`
   refuses as already gone, and a fresh `openChannel` of the same name is a new protected opening
   that receives cleanly. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
4. A pool purge that refuses makes the whole erase refuse; the opening's bytes remain and no
   tombstone is written. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
5. Erasing a receipt, not the opening, behaves as T288 promises: the channel stays open and only
   that operand contribution is gone. Verify:
   `npx vitest run test/federation/local-channel-events.test.ts`
6. Every lifecycle event carries the parent-container pointer; the generic append and federate
   doors still refuse it. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
7. A bound connection's surface over `into` lists the lineage of channels opened into `into` and
   none from another container. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
8. Dropping the container cascades over the lifecycle events with marked tombstones; a sibling
   container's events survive. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
9. rails-red: every new rail file copied onto the #566 tip fails to load or fails its cases; the
   header of each file records the run. Verify:
   `git -C <worktree-at-566-tip> stash && npx vitest run test/federation/local-channel-erased-opening-drop.test.ts test/federation/local-channel-container-scope.test.ts`
10. Full bar green and hollow-test run first on the clean tip, then recorded. Verify:
    `npm run check` and `adlc hollow-test --base origin/t288/local-channel-events --max 300 --test-cmd "timeout -k 10 600 npx vitest run test/federation/local-channel-*.test.ts"`

## Questions to settle before P3

- Should erasing the opening also erase the channel's status stamps (`loam:channel` records), or
  do they stay as ordinary history? Recommendation: they stay; they are not protected events and
  a later reader needs them to explain the hole.
- The container pointer: one pointer to the `into` container, or one per ancestor? Recommendation:
  one, at `into`; reach walks the parent edges already.
