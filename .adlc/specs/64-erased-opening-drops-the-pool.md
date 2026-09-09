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
4. Myk reads the lineage of `friends` as its operator. He expects each event to say which
   container it belongs to, so a tool can list a container's channels without a name scan.

## Decision ledger

**Decided by Myk, 2026-09-08, in chat:**

- Erasing an opening is tantamount to a drop. "The store's presence has been erased." The pool is
  purged as part of the erase; no later cleanup act exists.
- Channel lifecycle events are tracked by the parent container, not only at the root.

**Decided by Myk, 2026-09-08, in chat, after the premortem:**

- The channel's ordinary status stamps stay when the opening is erased. The marker says the lineage
  is gone; the status says what it was about. Erasing the status would make the hole unexplainable.
- One container pointer, at `into`, never one per ancestor. A pointer per ancestor would carry a
  container's records outside the context that bounds them, and would freeze the tree shape into
  every event.

**Superseded by these rulings:** PR #567's cleanup vocabulary (`cleanup` events, the `erased`
history state, the retry protocol). It is not to be merged. T288's "erased opening" refusal of
`drop` stays only as the transitional state between #566 landing and this ticket landing.

**Not decided here:** the channel token file left behind by `federate drop`; MCP-opened channels
recording no address. Both belong to a separate ticket.

## Contract

### Erasing an opening

`Gateway.erase(openingId)` on a protected `open` event:

- runs its channel half under `withChannelCommit(channel)`, so no receipt lands between the
  enumeration of the incarnation's events and their tombstones;
- writes the opening's marked tombstone first and purges its bytes on every tier, in the order
  every erase already follows (tombstone, then purge, then `holds` verification);
- erases that incarnation's `received` and `close` events, each with its own marked tombstone, so
  no receipt references a hole;
- finds the pool BY DECLARATION, never by name: the attached pool whose `declarationId` equals the
  opening's `poolDeclaration`. If one is attached, it is purged at the bytes and detached through
  the same byte-verified purge `dropChannel` uses, and its status records are struck. If none is
  attached under that declaration, there is nothing to purge and the erase says so; a pool
  attached under the same NAME with another declaration is another incarnation and is not touched;
- keeps the local-control marker naming the channel and the pool declaration, so a later reader
  sees "erased", never "legacy";
- leaves every other pool, the receiver's root ground, and every other channel's lineage untouched.

After the erase, `localChannelEvidence(channel)` reports `unavailable` with reason `erased`, and
`openChannel` for the same name is a fresh protected opening. `dropChannel` on an erased name
refuses and says the channel is already gone.

If the pool purge refuses (a survivor at the bytes), the erase reports it the way every erase
does today: the tombstone is recorded, the content is still held, and the report says so. A retry
of the same erase finds the tombstone already landed and completes the purge. The pool is never
reported gone while bytes remain (H7). This is the same partial state every refused erase has,
stated rather than hidden.

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
unprotected". They must change. They are not frozen until #566 lands, so T289 lands in the same
stack before #566 merges, or, if #566 merges first, through the authorized whole-file revision
road in `scripts/rail-renames.json` (the #560 precedent). No quiet rewrite.

## Acceptance criteria

Each rail is two-sided: the target gone at the bytes AND a named live bystander surviving. Each
criterion names its verification.

1. Erasing an opening purges the pool attached under the opening's own declaration at the bytes
   and detaches it; a pool attached under the same name with another declaration, the sibling
   channel's pool, and the root ground hold the same bytes before and after. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
2. Erasing an opening erases that incarnation's receipts and close with marked tombstones; another
   channel's receipts survive. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
3. After the erase, evidence is `unavailable: erased`, `sync` on a stale handle refuses, `drop`
   refuses with the reason "already erased" (a CONTROL for the refusal itself, which the base
   also gives for another reason; the reason text is the rail), and a fresh `openChannel` of the
   same name is a new protected opening that receives cleanly. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
4. A pool purge that refuses is reported with the tombstone recorded and the content still held;
   the pool is not reported gone; a retry of the same erase completes the purge and detaches the
   pool. A receipt issued concurrently is serialized by the channel commit and lands before or
   after the erase, never referencing a hole. Verify:
   `npx vitest run test/federation/local-channel-erased-opening-drop.test.ts`
5. Erasing a receipt, not the opening, behaves as T288 promises: the channel stays open and only
   that operand contribution is gone. Verify:
   `npx vitest run test/federation/local-channel-events.test.ts`
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
   `git -C <worktree-at-566-tip> stash && npx vitest run test/federation/local-channel-erased-opening-drop.test.ts test/federation/local-channel-container-scope.test.ts`
10. Full bar green and hollow-test run first on the clean tip, then recorded. Verify:
    `npm run check` and `adlc hollow-test --base origin/t288/local-channel-events --max 300 --test-cmd "timeout -k 10 600 npx vitest run test/federation/local-channel-*.test.ts"`

## Premortem, 2026-09-08

Six findings, all folded above: the `container`/`loam.container` pointer collided with the
declaration vocabulary; the pool must be found by declaration, not by name, or an erase of an
old opening purges a re-opened pool; two T288 cases pin the behaviour this replaces; the erase
order writes the tombstone first, so "nothing written" was false; the erase needs the channel
commit lock; and story 4 named a container drop road the code does not have, and criterion 7 a
scoping mechanism the gather does not have.
