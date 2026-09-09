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

An opening is LIVE while its pool declaration survives: `currentPoolDeclaration(channel)` equals
the opening's `poolDeclaration`, whether or not a handle is attached in this process. Detached,
boot-unreadable and simply closed pools are all live by this test; only a DROP strikes the
declaration.

`Gateway.erase(openingId)` on a live protected `open` event:

- writes nothing: no tombstone, no marker, no slate, no event;
- refuses with a message that names the pool container, says it must be dropped before the
  opening can be erased, and says its deltas can be read or extracted until then;
- changes nothing about the channel: `sync` keeps receiving, reads work, `drop` works as today.

`dropChannel` is unchanged: the existing byte-verified purge, detach, `close` event, and the
strike of the declaration. After it, the opening is no longer live.

`Gateway.erase(openingId)` on an opening whose declaration is struck (the incarnation was dropped)
erases that incarnation directly: the opening, its `received` events and its `close`, each with a
marked tombstone naming the channel and the pool declaration. It touches no pool; the pool is
already gone. A later incarnation of the same name is unaffected, because the erased receipts no
longer reference a hole. This is the one cascade this spec adds, and it is stated as such: erasing
a dropped incarnation's opening removes that incarnation's lineage records, which could previously
survive it and strand the channel.

`erase(receiptId)` and `erase(closeId)` behave as T288 promises today. They are not openings and
condemn nothing.

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
unprotected". Both erase a LIVE opening outright; under this spec that erase refuses. They must
change. They are not frozen until #566 lands, so T289 lands in the same
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
   returns every delta it held, `drop` succeeds. A detached pool and a pool the boot could not
   attach count as live: the erase refuses for them too. Verify:
   `npx vitest run test/federation/local-channel-live-opening.test.ts`
3. After `dropChannel`, erasing the opening erases the opening, its receipts and its close, each
   with a marked tombstone naming the channel and the pool declaration; the sibling channel's
   receipts and the root ground are unchanged; evidence reads `unavailable: erased`; a fresh
   same-name open is a new protected opening that receives cleanly, and a LATER incarnation that
   already existed keeps receiving. Verify:
   `npx vitest run test/federation/local-channel-live-opening.test.ts`
4. Erasing a receipt or a close of a live channel behaves as T288 promises: only that record goes,
   the channel stays open. Verify:
   `npx vitest run test/federation/local-channel-events.test.ts`
5. The transitional `erased opening` refusal of `drop` is gone, and no case can reach it: the
   rail that pinned it is revised in the same stack or through the authorized revision road, and
   the file header records which. Verify:
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
   authorized revision road; the header of `local-channel-events.test.ts` records which, and the
   revised cases are red on the #566 tip. Verify:
   `npx vitest run test/federation/local-channel-container-scope.test.ts`
9. rails-red: every new rail file copied onto the #566 tip fails to load or fails its cases; the
   header of each file records the run. Verify:
   `git -C <worktree-at-566-tip> stash && npx vitest run test/federation/local-channel-live-opening.test.ts test/federation/local-channel-container-scope.test.ts`
10. Full bar green and hollow-test run first on the clean tip, then recorded. Verify:
    `npm run check` and `adlc hollow-test --base origin/t288/local-channel-events --max 300 --test-cmd "timeout -k 10 600 npx vitest run test/federation/local-channel-*.test.ts"`

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
