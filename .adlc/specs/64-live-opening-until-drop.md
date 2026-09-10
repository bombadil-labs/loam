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

An opening is LIVE while its pool declaration SURVIVES (it is held and not struck; not "equals
the current declaration": a second declaration under the same name by hand must not make the
first opening erasable while its pool's bytes stand), whether or not a handle is attached in this
process, OR while the pool's backend still holds any byte. Detached, boot-unreadable and simply closed pools are all
live by the first test. The second test covers a declaration struck through the ordinary append
door without a purge: the opening then reads dropped by the table, but the erase must open the
pool's backend (as the erasure fan-out already does for a declared separate container) and
refuse, naming the orphaned pool, if it still holds bytes. Only a completed DROP makes an opening
not live.

Three drop edges are part of this contract. An ORPHANED pool, one whose declaration the operator
struck or replaced by hand while its bytes stayed attached under the channel's name, has no
opening that agrees with it, so the lifecycle reads `attached pool declaration changed`; `drop`
purges it anyway, strikes whatever still declares the name, and writes no close, because nothing
was open; the opening's own erase then takes the lineage. That is the road the erase refusal
names, and it must work in that state while the pool is attached. With no handle in memory and no
surviving declaration, the container layer cannot re-open the store; that state is reported as
such, and the operator re-declares the name or removes the file by hand. If the drop's byte purge succeeds and its declaration
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
   again rather than skipping it; a fault before the opening's own purge leaves the opening intact,
   so every surviving receipt still resolves and no history reads `missing referenced opening` or
   `invalid local event history`, and a re-run finishes; the sibling channel's receipts and the root ground are unchanged; evidence
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

## Review round 21 of the build, 2026-09-10 (the reviewer's second finding on the PR)

The later-incarnation road still read the later pool's reactor alone: reopened over a store whose
mirror kept the earlier incarnation's byte, the earlier opening's erase proceeded. That road now
asks the store at the bytes for every byte this opening's own receipts name (the ids an earlier
incarnation received are on the record), on every tier, and refuses while any is held or cannot
be asked. A byte no receipt names that only a non-primary tier holds is not reachable by id from
the shared name; a heal replants it into the primary, where the read sees it, and the drop
refuses on it until then. The rail runs the reviewer's sequence: reopen, erase refuses, drop
refuses, heal, drop, erase. Round 20's two wording findings are folded in: the contract says the
drop stays silent without the probe, and the drop's refusal no longer uses detach for two roads
in one sentence. A store rail measures the sqlite truncation-debt clause the mutants left.

## Review round 18 of the build, 2026-09-10 (a reviewer's finding on the PR)

The pool's emptiness was a READ: `deltasSince` on the no-handle road and the pool's reactor on
the attached road, both answered from one tier. A mirror pair whose primary purged and whose
mirror did not showed nothing to either, and the opening's erase proceeded while the mirror held
a peer byte, against this spec's first promise. The store contract now carries an optional
whole-store byte probe, `holdsAny`, with `holds`'s reach and fail-closed, implemented by every
driver (memory, sqlite, archive, local storage, and the mirror pair, which asks both tiers and
refuses when a tier cannot answer). Both erase roads ask it; a store without it, or one that
refuses, is not proven empty and the erase refuses. The separate container's drop asks it after
its sweep, so a byte no read named (the mirror's) refuses the drop instead of a clean report; the
road is a heal of the pair while nothing is attached to it (a heal is not safe on a live store, and
a handle reads its store once at open), which replants the mirror's rows into the primary, then an
open and the drop. No CLI road heals a channel pool today: the CLI's pools are plain sqlite files,
and `loam serve` heals only the primary at boot; the refusal names the acts, not a command.
Rails: the mirror shape run to the end along that road, a driver without the probe, and a
store-level rail per driver. Known and left: a driver without the probe keeps the old drop
behaviour (its stragglers are heal's; the contract says so), and the erase over such a store
refuses until the store is removed by hand, as its text says. Round 19 (independent, on this fix)
found the road text named `loam repair`, which is the §25 pen tool and heals nothing, and the
archive probe counting files its purge never sweeps; both corrected, the archive probe now reads
the same two name shapes as its purge. A sqlite handle's persisted truncation debt answers true
once and is cleared by that handle's own close, so one refusal can precede a clean re-run; `holds`
shares that shape and it is fail-closed.

## Review round 16 of the build, 2026-09-09

Every finding in the refuse direction, in states made by striking records by hand. Fixed: with
the status and the declaration both struck in this process, the pool still attached, the drop
said "nothing left to remove" while the pool held bytes; it now names the attached pool and the
road out (restart, open again under the name, drop). Known and left, each with its road: a hand
declaration under the name with a LATER timestamp than the channel's own, status struck, reads
as the standing declaration, is an orphan, and the drop refuses as severed while the erase says
drop first; the road is to strike the hand declaration, or a fresh open then drop. A hand
declaration with an EARLIER timestamp does not change the standing one; the drop purges the
channel's own pool and strikes both declarations, as "whatever still declares the name" says.
The status-gone drop skips every `unavailable` reason, including another channel's malformed
control history; the gate has already proven the pool is the channel's own. The same state seen
from another process (restart, then drop before a fresh open) still reads severed with the file
holding bytes: the store cannot check the file without minting a store by name, and the fresh
open is the road. Round 17, scoped to round 16's clause, was clean. Seventeen rounds; the
last five found only roads and texts in the refuse direction, and the widening this build asks
Myk to decide is stated in one sentence in the PR.

## Review round 15 of the build, 2026-09-09

Round 14's gate admitted a declaration by hand under a name that once was a channel: the drop
attached a store by name through the channel backend, purged that one, struck the declaration
and reversed a detach record, while a hand container over its own store kept its bytes (H7, the
over-claim direction; reachable through the library API, not the CLI, whose only backend is the
factory's). A shared declaration under such a name dropped through the door with no pool to
purge. The gate now asks the question the rest of this spec asks: with the status gone, the drop
proceeds only when a channel opening names the standing declaration (`orphanedDeclaration`
false); a hand-made declaration is an orphan and the name reads severed, as on the base. What
the drop can now remove that it could not before, restated narrowly: the channel's own attached
pool, under its own declaration, after its status stamps were struck by hand.

## Review round 14 of the build, 2026-09-09

Round 13's widening reached past the channel door: the severed test read the generic container
table, so any hand-declared separate container, channel or not, dropped through `dropChannel`,
which minted a store by name through the channel backend and reported a purge of bytes it never
reached (H7). The door now takes only a name this store once had as a channel: with the status
gone, it refuses unless a channel record ever stood under the name AND a declaration stands. The
round-13 rail is two-sided now: a sibling channel opened before the strike keeps its bytes and its
open evidence, and a hand-declared non-channel container keeps its declaration and gets no store.

## Review round 13 of the build, 2026-09-09

Round 12's container-handle road could not be run from the sentence that named it: in the one
state that shows the text the pool is attached, so `openContainer` by name refuses, and a handle
drop leaves this process's channel maps stale. The fix is the sentence round 5 wrote and round 6
withdrew, now deliberately landed: `dropChannel` does not call a name severed while a declaration
stands under it. A name whose status stamps were struck by hand drops through the door, which
purges the pool, strikes the declaration and clears the maps; no close is written, since the
lifecycle cannot pair the opening with a status that no longer stands, and the opening's own erase
takes the lineage afterwards. The drop sentence is one sentence again. The hand-attached check now
runs before the declaration check, since the drop cannot attach past a container attached by hand
under the name. What the drop can now remove that it could not before: an attached pool under a
name with no status record and a standing declaration. Known and left: a channel pool dropped
through its container handle leaves this process's channel maps stale until a restart or a drop
through the door; the erase reads past the stale entry, and no text names the handle road.

## Review round 12 of the build, 2026-09-09

Three more roads measured from their states, all in the refuse direction. A name whose status
stamps were struck by hand while its declaration stands is one `dropChannel` calls severed, so the
drop sentence now branches on the status: standing, `dropChannel`; gone, the container handle's
own `drop()`. The probe read the channel-pool map without the staleness test the drop applies, so
a pool dropped or detached through its handle read as a pool that holds bytes; the probe now
applies the same test (attached to this gateway, in the quarantine set) and reads a stale handle
as no handle. This retires round 11's known-and-left. The hand-attached road named the container's
`drop()`, which leaves the name with status stamps and no declaration, a name every boot then
fails to attach; the road is detach, then `dropChannel`, and the rail asserts the stamps are gone.

## Review round 11 of the build, 2026-09-09

Round 10's roads, measured from each state. The struck-declaration text named a fresh open, which
attaches a store no declaration names only when the status stamps are gone too; with the status
standing an open resumes and needs the declaration. The text now branches on the status: standing,
re-declare by hand then drop; gone, open again then drop. The drop named for a later incarnation's
unnamed bytes severs that standing incarnation and purges its pool; the text now says so, since no
narrower road exists (the root never held those bytes, so the root cannot erase them one by one).
The hand-attached text named detach as well as drop; detached, the container is a standing
declaration and the erase refuses twice more, so the text names drop alone. Round 12 retired the stale-handle read
this round left; the rail that models the no-handle state says which state it models.

## Review round 10 of the build, 2026-09-09

Round 9's registration fix stood. Its two no-handle refusal texts did not: both named
`dropChannel`, which refuses a name whose status stamps are struck ("already severed"), and which,
for a LIVE later incarnation whose pool was detached in this process, would purge that
incarnation's bytes; attached again, those bytes are its own and the earlier erase proceeds. And a
container attached by hand under the channel's name (openContainer) sat in the attached set but not
in the channel-pool map, so the probe said no pool was attached while the drop said one was. Now:
the probe reads the hand-attached container's bytes and names detach or drop; the standing
declaration text names re-attach (open the channel again with its options, or restart), never a
drop; the struck-declaration text names a fresh open under the name, which attaches the store,
then the drop. Three rails, each run to completion along its named road.

## Review round 9 of the build, 2026-09-09

Round 8's control was wrong in its second half, and round 9 measured it: a drop run in the
process whose boot could not read the pool's store attached the pool without registering it, so
its own lifecycle read refused, a second drop said the pool was already attached, and the erase
then fell through to the no-handle road, which said no declaration named the store. The drop
now registers every pool it attaches. The no-handle road checks for a standing declaration
under the name first and names the drop, which attaches the pool. Round 8's claim that the
`> 1` mutant on the store's byte count is equivalent was refuted: a hand-written store can hold
one delta, and the mutant erased the opening over it; the rail trims the store to one byte. The
pool emptiness read uses the reactor's size. The header's green case was misnamed; corrected.

## Review round 8 of the build, 2026-09-09

No correctness defect in the round-7 clause: a peer byte the root holds has the root's own ingest
as its lineage, so the promise (no bytes with no lineage) holds. One PLAUSIBLE text finding was
refuted by measurement: a later incarnation's declaration standing with no handle in memory
(its pool's store unreadable at boot; a detached pool is re-attached by boot) is refused by the
§11 unreachable-store check before the liveness probe runs, and that refusal names the attach
or detach road. A control case records it. The pool emptiness check takes one step of the
iterator instead of a spread. Known and left: the whole-snapshot walks in `receiptsNaming`,
`orphanedDeclaration` and `incarnationMembers` on an operator door that runs once per erase of
an opening; the targeted read is `reactor.byTarget("channel:<name>")` filtered to the event
context. Mutants that survive on this code and why: the member-skip's `tombstoned` guard
(an un-tombstoned held member is "held", so the skip never fires for it either way), the
cascade flag on the recursive call (a member has no members), and, as round 8 believed and round 9 refuted, the store's byte count on the no-handle road.

## Review round 7 of the build, 2026-09-09

The round-6 liveness clause met the seed from the other side: the root's own peer-authored deltas
are copied into every later incarnation's pool, no receipt names them, and one stranger's byte in
the root made every earlier opening under that name uneraseable forever. A byte the root also
holds is the root's, not the earlier opening's; the clause now counts only peer bytes that no
receipt names AND the root does not hold. Known and left: a later incarnation's receive whose
receipt append faulted (federate admitted, receipt lost) leaves a peer byte no receipt names until
the peer re-offers it, and an earlier opening's erase refuses until then; the status record shows
that debt as `unattested`. The refusal for a store no declaration names now says the true road:
re-declare the name and drop, or remove the store by hand. The scoped fail-closed clause has its
rail.

## Review round 6 of the build, 2026-09-09

Round 5's fresh-open refusal was wrong at the seam: a separate pool is seeded from the root at
attach, so any stranger's delta in the root made the leftover check fire for every fresh open of
a protected name, forever, and each refusal left a surviving declaration with no status, which
wedged every erase in the store after a restart. Withdrawn. The hole closes where it lives: an
opening is LIVE while a pool under its name holds a peer byte that no receipt of the standing
incarnation names, because the name keys the store and such a byte is the earlier opening's. A
fresh open over a leftover store is allowed and noted as T288's looseness; the old opening's
erase refuses until that incarnation is dropped. The orphan question fails closed only on an
unreadable event of the SAME channel.

## Review round 5 of the build, 2026-09-09

Strike a channel's declaration and status records by hand, restart, open the same name afresh:
the name-keyed store still held the old bytes, the fresh opening attached over them, and the old
opening's erase read the pool as a later incarnation's and reported clean. A fresh protected
opening now refuses a store that still holds bytes no opening names, before the opening is
written, for a name that once carried a protected opening; a name that never did (a stranger's
record, a legacy channel) is not held to it. The pool stays attached under the declaration the
open minted, so the drop is the road out, and the drop addresses an attached pool under a name
with no status record instead of calling it severed (withdrawn in round 6, landed in round 13). `orphanedDeclaration` fails closed on an
event it cannot parse, so a purge never rides a parser change; a rail plants one and restarts.

## Review round 4 of the build, 2026-09-09

The orphan road held only inside the process that made the orphan. After a restart, boot
re-attaches the pool under the hand-made declaration, the lifecycle reads `missing current
opening`, the drop fell to the generic refusal, and in the struck-and-replaced case the erase
went through and stranded the bytes: the attached pool's different declaration id read as "a
later incarnation" with a lineage of its own. Both doors now ask the same question: does any
surviving opening NAME the declaration the attached pool sits under? If none does, the pool is an
orphan: its bytes count against the opening that erase is asked about, and the drop purges it
whatever the lifecycle reason reads. A rail restarts the store in both orphan states. "Writes no
close" is now asserted.

## Review round 3 of the build, 2026-09-09

Two operator-made states stranded the channel: a second declaration under the channel's name by
hand, and a declaration struck by hand with the pool's bytes still attached. In both, the erase
refused and named the drop, and the drop refused as `attached pool declaration changed`. The drop
now purges an orphaned attached pool, strikes what still declares the name, and writes no close;
the erase then proceeds. The contract's liveness sentence said "equals the current declaration"
while the code, correctly, tests survival; the sentence now says survival and why. The container
read lost its marker scan (the declaration test subsumes it) and names the targeted read a door
must use. The fixture carries bytes across every hop.

## Review round 2 of the build, 2026-09-09

The container read decided "dropped" from a close event. A refused drop leaves a close beside a
standing pool, and an erase that faulted after the close's tombstone leaves none beside a dropped
one, so the read disagreed with the erase door both ways. It now decides "standing" the way the
erase door decides "live": the opening's pool declaration survives. The fixture's per-name store
now hands out a fresh handle over the same bytes on every call, as a file does, so a byte check
that closes its own handle never closes a live pool's. "History stays readable" in criterion 3
now says what it means.

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
