# §59 — A channel remembers its incarnations: lifecycle events, and a live opening stays until its pool is dropped

A local channel (§46) is opened, receives, and is dropped, and until this section the store kept
no authoritative record of which incarnation of a name did what. It does now. Every fresh open
writes a protected **`open`** event; every sync that admits bytes writes a **`received`** event
naming the opening and the exact ids admitted; a drop writes a **`close`** event naming the
opening. The three are the receiver operator's own records, filed in the receiver's root ground
under one reserved context, `loam.local.channel.event`, and they are what a later slice (§62,
queued) will read to decide what a bound connection may activate. Two promises follow, and both
are this section's whole subject: a lifecycle record is written only by the local channel
service, never admitted through a door; and an opening whose pool is still live cannot be erased.

## The events, and who may write them

An event is a signed delta whose first pointer names the channel entity `channel:<name>` at the
event context, followed by a version and an action (`open`, `received`, `close`), then a pointer
at the **parent container** (role `parent-container`, id the `into` container), then the action's
own pointers in a fixed order. An `open` carries a nonce, the `into` container, the assigned
prefix, the address pulled from (empty for a local source), the opener kind (`root` or `bound`,
with the bound opener's identity and inbox), and exact references to the status stamp and the pool
declaration it was opened under. A `received` names its opening and the sorted, unique ids the
sync actually admitted, as the ingest reported them, never as the offer listed them. A `close`
names its opening and the reason `drop`.

The generic doors refuse the whole family. `append` and `federate` reject any delta in the event
context and any strike of one, whatever the signer, so a peer cannot forge a receipt and a
restored history cannot be re-imported as fresh evidence. The channel service writes through a
private, validated seam that keeps every rule the doors keep (signature, tombstone, slate) and
skips only the family refusal. A legacy channel — one opened before this section — has no
incarnation and no protected received set; resume does not mint one from old stamps, and only a
fresh open after a drop earns one.

The parent-container pointer scopes reads, not membership. `localChannelsInContainer` lists the
channels whose surviving opening names a container, minus dropped and erased incarnations, with
no scan by name; a shared container's members still come from its membership term, and the
container table never reads an event as law. A §29 slate whose selection would pin a lifecycle
event is refused at the slate door: its cite closure would refuse the drop's own close, and the
cut would fault forever.

## Erasing a lifecycle record

A lifecycle event is erasable only through a **local-control tombstone**, which the same service
issues and which carries a marker naming the channel the event belonged to. Once the bytes are
gone, that marker is all that separates an erased history from a channel that never had one, so
an erased opening reads as *erased*, never as legacy, and a resumed handle over it cannot sync
unprotected. Such a tombstone is not forgiven by a strike; the door text says so.

A **live opening cannot be erased.** An opening is live while its pool's declaration survives (held
and not struck, whether or not a handle is attached in this process), or while the store under
the channel's name still holds any byte on any tier. `erase(openingId)` on a live opening writes
nothing and refuses with a message that names the pool and the road: drop the channel first; its
deltas can be read or extracted until then. Only a completed drop makes an opening not live.
Erasing a **receipt** or a **close** forgets that attribution only; it condemns nothing and moves
no bytes.

Once its incarnation is dropped, an opening's erase takes the incarnation's lineage with it: its
receipts and its close first, each with a marked tombstone, under the channel's own commit, and
the opening last. A member already tombstoned and held by no tier is skipped; a member whose purge
faulted is erased again, anchoring on its tombstone. A crash before the opening's tombstone leaves
every surviving receipt resolvable and a re-run finishes. A later incarnation under the same name
is unaffected.

## Whether a pool is empty is a question at the bytes

"Empty" is never a read. A read answers from one tier, and a mirror can keep what a partial purge
left behind. The store contract therefore carries two optional whole-store questions with the
reach and the fail-closed rule of `holds`: **`holdsAny`** (does this store hold bytes under any id,
on any tier it owns) and **`ids`** (every id it holds, on every tier). Every shipped driver answers
both; the mirror pair asks both tiers and refuses when one cannot answer; a sqlite debt whose ids
it cannot name refuses the inventory. The erase asks `holdsAny` before it calls a pool empty, and a
store with no probe, or one that refuses, is not proven empty. When a **later incarnation** stands
under the name, the erase accounts for every byte in the later pool's inventory: a byte is the
later incarnation's when one of its receipts names it, the root's when the root holds it (the seed
copies the root's own bytes into every pool), the pool's own when the pool resolves it as
operator-authored; anything else has the earlier opening as its only lineage, whether or not a
receipt still names it, and the erase refuses. A store that cannot be listed refuses too. The
separate container's drop asks `holdsAny` after its sweep and refuses rather than report clean; a
byte no read named is surfaced by a heal of the store while nothing is attached to it, which
replants a mirror's rows into the primary, after which the drop reaches it.

## The drop, and the roads out of a hand-made state

`dropChannel` writes the close, purges the pool at the bytes on every tier, strikes the
declaration and the status stamps, and clears this process's handles. Two states it did not use
to reach, it reaches now. A pool whose declaration the operator struck or replaced by hand while
its bytes stayed attached is an **orphan**: no opening agrees with it, so the drop purges it,
strikes whatever still declares the name, and writes no close. A name whose **status stamps** were
struck by hand while a declaration a channel opening names still stands is not severed: the drop
takes it through the same road. Any other declaration under the name — one made by hand, before
or after a clean drop, separate or shared — is not this door's, and the name reads severed; the
drop never attaches a store by name to purge bytes it never reached. Every refusal on these roads
names a road that was run to its end from the refusing state: attach the pool (open the channel
again with its options, or restart), or re-declare then drop, or open again then drop, or heal
then drop; and a drop that completes cannot leave a pool that a later boot cannot attach.

**Provenance.** [#566](https://github.com/bombadil-labs/loam/pull/566) (T288 and T289, the
build) and [#568](https://github.com/bombadil-labs/loam/pull/568) (working spec 64, the
decision that a live opening is refused rather than slated). Implementation:
`src/federation/local-channel-events.ts` (events, parser, container-scoped read),
`src/federation/channel.ts` (open, sync, resume, drop), `src/gateway/ingest.ts` (the family
refusal and the service seam), `src/gateway/erase.ts` (`liveOpening`, the cascade),
`src/gateway/container.ts` (the drop's whole-store verdict), `src/store/backend.ts` and every
driver (`holdsAny`, `ids`). Rails: the nine `test/federation/local-channel-*.test.ts` suites,
`test/server/federate-connect-standing.test.ts`, `test/store/holds-any.test.ts`. The working
spec's twenty-six review-round sections (`.adlc/specs/64-live-opening-until-drop.md`) record how
each road was measured.
