# 64 — A live channel opening cannot be erased until its pool is dropped; lifecycle files under the container

Working design, T289. Stacks on T288 (#566), which is not yet merged. Nothing here is shipped.
Baseline: `origin/main` at `74bd30ce`, 2026-09-08.

## The people and the acts

1. Myk opens a channel from a peer into `friends`. Later he erases the channel's opening event
   while the pool still stands. He expects the store to refuse to nuke anything on its own: the
   erase is refused, and the refusal tells him the pool container must be dropped first and that
   he can still read and extract deltas from it until then. When he drops it, the erase proceeds
   and a fresh open of the same name starts clean.
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
  channel opening does NOT purge the pool. The opening stays condemned but uneraseable until the
  container is dropped. The store makes that clear, and the container must be dropped, which
  leaves room to extract other deltas first. This corrects the 2026-09-08 ruling "erasing an
  opening is tantamount to a drop", which is withdrawn.

**Design choice under that ruling (premortem 2, 2026-09-09):** "condemned but uneraseable" is a
STANDING REFUSAL, not a §29 slate record. A §29 slate closes `cite`, which would refuse the very
`close` event the drop must write; it requires a deadline, which "until a human drops it" has
none of; the pool's own door never reads the root's slate, so the peer's bytes would keep landing;
and the ordinary `cut` door would either fault forever or reopen the withdrawn erase. A refusal
needs no record: the condition it refuses on, the pool's surviving declaration, is already in the
store. If a persisted condemnation is wanted later, it is one event, added under its own ticket.
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
#566 landing and this ticket landing. Under this spec the "erased opening" state cannot arise for
a live pool, so that refusal has nothing left to refuse.

**Not decided here:** the channel token file left behind by `federate drop`; MCP-opened channels
recording no address. Both belong to a separate ticket.

## Contract

### A live opening cannot be erased; the drop comes first

An opening is LIVE while its pool declaration survives (`currentPoolDeclaration(channel)` equals
the opening's `poolDeclaration`), whether or not a handle is attached in this process, OR while
the pool's backend still holds any byte. Detached, boot-unreadable and simply closed pools are all
live by the first test. The second test covers a declaration struck through the ordinary append
door without a purge: the opening then reads dropped by the table, but the erase must open the
pool's backend (as the erasure fan-out already does for a declared separate container) and
refuse, naming the orphaned pool, if it still holds bytes. Only a completed DROP makes an opening
not live.

Two drop edges are part of this contract. If the drop's byte purge succeeds and its declaration
strike then fails, the pool is unregistered with its bytes gone and the declaration alive; a
re-run of `dropChannel` on that state verifies the bytes are gone and completes the strike and
the status strikes, so the opening stops being live. And a §29 slate whose selection includes a
protected lifecycle event is refused at the slate door; the slate's cite closure would refuse the
drop's own close event and the cut would fault forever, so lifecycle events are never slated. An
existing slate that already names one is struck under §29.8; that is the exit, and the erase
refusal says so when it sees one.

`Gateway.erase(openingId)` on a live protected `open` event:

- writes nothing: no tombstone, no marker, no slate, no event;
- refuses with a message that names the pool container, says it must be dropped before the
  opening can be erased, and says its deltas can be read or extracted until then;
- changes nothing about the channel: `sync` keeps receiving, reads work, `drop` works as today.

`dropChannel` is unchanged: the existing byte-verified purge, detach, `close` event, and the
strike of the declaration. After it, the opening is no longer live.

`Gateway.erase(openingId)` on an opening whose declaration is struck (the incarnation was dropped)
erases that incarnation directly: its `received` events and its `close` FIRST, each with a marked
tombstone naming the channel and the pool declaration, under `withChannelCommit(channel)`, and the
opening LAST, by the ordinary erase that follows. Each member is one ordinary erase with the
existing retry anchor. A member is skipped only when SETTLED: tombstoned and held by no tier. A
member whose purge faulted has a tombstone and is erased again, anchoring on it. The order is the
crash guarantee: a crash before the opening's tombstone leaves the opening intact, so every
surviving receipt still resolves, the history stays readable, and a re-run of `erase(openingId)`
finishes. No receipt can land between the members and the opening: a receipt needs a sync under
a surviving declaration, and a dropped incarnation's is struck. It touches no
pool; the pool is already gone. A later incarnation of the same name is unaffected, because the
erased receipts no longer reference a hole. This is the one cascade this spec adds, and it is
stated as such: erasing a dropped incarnation's opening removes that incarnation's lineage
records, which could previously survive it and strand the channel.

`erase(receiptId)` and `erase(closeId)` behave as T288 promises today. They are not openings and
condemn nothing.

### Where lifecycle events live

Every protected lifecycle event (`open`, `received`, `close`) carries an entity pointer at the
parent container: role `parent-container`, context `loam.local.channel.event`, id = the `into`
container name. It is appended AFTER the event header (`event`, `version`, `action`) and before
the action's own pointers, and the parser reads it by position like every other event pointer, so
its position is part of the wire contract. The role is new: `open` already carries a PRIMITIVE at
role `into`, so that role cannot be reused. It must NOT use role `container` at context
`loam.container`: that pair is the container-declaration vocabulary, `containerDefect` refuses a
delta in it that lacks trust and posture, and the container table would read the event as law.
The erasure marker names the erased event's channel from the pointer at role `event`, never from
the first entity pointer in the event context.

The record still lives in the receiver's root reactor: the operator signs it and the root is the
operator's authority. The pointer scopes READS, not membership: a shared container's members come
from its membership term, and the pointer joins no term.

- `localChannelsInContainer(gw, container)` is the container-scoped lineage read: the channels
  whose surviving opening names that container, minus closed (dropped) incarnations and erased
  ones. A bound door that lists a connection's channels will serve from it, scoped to the binding's
  container. No door serves it in this slice; T288's bound status door still scopes by
  `openedFrom`, the same set for channels a connection opened itself.
- The operator's read may call it to list one container's channels without a name scan.
- Container reach walks and the container table never treat a lifecycle event as law.
- Dropping a shared container does not cascade over these events; there is no such road today
  (`drop()` is a separate container's total forget). That stays out of scope here.

### Migration

No store migration: T288 has not merged, and T289 stacks on #566, so no store holds an event
without the pointer or a marker without the declaration. This is why T289 must land before, or in
the same stack as, #566: a store that ran #566 alone would hold events the new parser calls
`invalid local event history`, with no migration road.

Two T288 cases in `test/federation/local-channel-events.test.ts` pin the transitional behaviour
this spec replaces: "erase(open) loses incarnation without removing receipt/source/bystander" and
"erase(open) before any receipt is erased history, never legacy: a resumed handle cannot sync
unprotected". Both erase a LIVE opening outright; under this spec that erase refuses. They must
change. The `parent-container` pointer also breaks the file's four exact-pointer assertions on the
open, received and close literals. So the change is to the WHOLE file, and if #566 has merged
first, the authorized whole-file revision road covers the file, not two cases. They are not frozen until #566 lands, so T289 lands in the same
stack before #566 merges, or, if #566 merges first, through the authorized whole-file revision
road in `scripts/rail-renames.json` (the #560 precedent). No quiet rewrite.

## Acceptance criteria

Each rail is two-sided: the target gone at the bytes AND a named live bystander surviving. Each
criterion names its verification.

1. Erasing a live opening writes nothing and purges nothing: the root ground, the pool and the
   sibling channel's pool hold the same bytes before and after; no tombstone, marker or slate
   exists; the refusal names the pool container and says drop first. Verify:
   `npx vitest run test/federation/local-channel-live-opening.test.ts`
2. After the refusal the channel is untouched: `sync` receives a new delta, a read of the pool
   returns every delta it held, `drop` succeeds. A detached pool counts as live and the erase
   refuses with the drop-first text. The boot-unattachable pool is a CONTROL: the base already
   refuses it as unreachable; the rail asserts only that the refusal now names the pool and says
   drop first. A declaration struck through the append door with the pool's bytes still held
   refuses and names the orphaned pool. Verify:
   `npx vitest run test/federation/local-channel-live-opening.test.ts`
3. After `dropChannel`, erasing the opening erases its receipts and close first and the opening
   last, each with a marked tombstone naming the channel and the pool declaration; a member purge
   that faults leaves its tombstone recorded and its bytes held, and the re-run erases that member
   again rather than skipping it; a fault before the opening's own purge leaves the opening intact
   and the history readable, and a re-run finishes; the sibling channel's receipts and the root ground are unchanged; evidence
   reads `unavailable: erased`; a fresh same-name open is a new protected opening that receives
   cleanly, and a LATER incarnation that already existed keeps receiving. A drop whose declaration
   strike failed after the purge completes on re-run. Verify:
   `npx vitest run test/federation/local-channel-live-opening.test.ts`
4. Erasing a receipt or a close of a live channel behaves as T288 promises: only that record goes,
   the channel stays open. Verify:
   `npx vitest run test/federation/local-channel-events.test.ts`
5. The transitional `erased opening` refusal of `drop` is gone, and no case can reach it: the
   rail that pinned it is revised in the same stack or through the authorized revision road, and
   the file header records which. Verify:
   `npx vitest run test/federation/local-channel-events.test.ts`
6. Every lifecycle event carries the `parent-container` pointer at the event context, at its
   pinned position; `containerDefect` does not see it; the container table does not read it; the
   erasure marker still names the channel from the `event` pointer; the generic append and
   federate doors still refuse the event; a §29 slate selecting a lifecycle event is refused.
   Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
7. `localChannelsInContainer` lists the channels opened into a container and none from another,
   for a bound opening and a root one alike; a dropped incarnation is not listed, erased or not.
   Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
8. The two T288 cases named under Migration are revised in the same stack or through the
   authorized revision road; the header of `local-channel-events.test.ts` records which, and the
   revised cases are red on the #566 tip. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
9. rails-red: every new rail file copied onto the #566 tip fails to load or fails its cases; the
   header of each file records the run. Verify:
   `git -C <worktree-at-566-tip> stash && npx vitest run test/federation/local-channel-live-opening.test.ts test/federation/local-channel-container-scope.test.ts`
10. Full bar green and hollow-test run first on the clean tip, then recorded. Verify:
    `npm run check` and `adlc hollow-test --base origin/t288/local-channel-events --max 300 --test-cmd "timeout -k 10 600 npx vitest run test/federation/local-channel-*.test.ts"`

## Review round 1 of the build, 2026-09-09

An independent review of the implementation found the cascade skipped a member on tombstone
PRESENCE, so a member whose purge faulted was skipped on the re-run and the opening was erased
with a clean report while the member's bytes stayed held. The skip is now on SETTLEMENT, the
unattached byte check has a rail over a per-name store, the container read drops closed
incarnations, and the contract says the opening's tombstone follows the members' commit rather
than sharing it. The review also noted that the CLI's channel backend factory creates the store's
directory and file when asked for a name, so a byte check for a name whose file was removed mints
an empty file; that is the factory's shape, noted for the CLI, not fixed here.

## Premortem 3, 2026-09-09

Six findings against the refusal draft, all folded above: the cascade needed an order (receipts
and close first, opening last, one commit) or a crash stranded later incarnations; the
boot-unattachable case was a control, now named as one; the pointer breaks four literal
assertions, so the whole T288 events file is the revision unit; a §29 slate over a lifecycle event
jams drop, erase and cut, so slating one is refused; liveness needed both the declaration and the
bytes, and a drop whose strike failed needs a completing re-run; and role `into` was taken and the
marker read the first event-context pointer, so the role is `parent-container`, its position is
pinned, and the marker reads the `event` pointer.

## Premortem 2, 2026-09-09

Six findings against the "§29 slate until the drop" draft, all folded above by dropping the slate:
the slate's cite closure would refuse the drop's own close event; the pool's door never reads the
root's slate, so bytes kept landing unreceipted; the ordinary `cut` door had no defined outcome;
§29's mandatory deadline fights an open-ended condemnation; "not attached" is not "dropped", so a
detached pool took the direct-erase road and stranded itself (now: live means the declaration
survives); and a cut faulting after the purge had no completing road (now: no cut exists).

## Premortem 1, 2026-09-08

Six findings, all folded above: the `container`/`loam.container` pointer collided with the
declaration vocabulary; the pool must be found by declaration, not by name, or an erase of an
old opening purges a re-opened pool; two T288 cases pin the behaviour this replaces; the erase
order writes the tombstone first, so "nothing written" was false; the erase needs the channel
commit lock; and story 4 named a container drop road the code does not have, and criterion 7 a
scoping mechanism the gather does not have.
