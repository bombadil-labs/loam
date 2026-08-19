# §46 (working spec). Federation is container-to-container

**Ticket:** T186 · **Stage:** design · **Tier:** Myk's merge

A publisher offers a container. A receiver names a container to receive it, assigns the publisher a
namespace prefix, and tells Loam to keep accepting. Deltas arrive into a nested pool inside the
receiving container. Law that arrives binds there — under names the receiver controls — and nowhere
else. One-way only; two-way is a future feature.

## User stories

Each story names an actor, an act, and a result a person can see.

**S1a — a publisher offers.** Alice makes a container available to Myk. She runs one command and sees
an offer she can send him: an address and a token.

**S1b — a receiver subscribes.** Myk knows the address of a source a friend publishes. He subscribes
to it directly, with no offer having been sent.

**S2 — accepting names the prefix.** Myk accepts. He names the container that will receive the
deltas, and he assigns the prefix `alice`. He sees a confirmation naming the peer, the receiving
container, and the prefix.

**S3 — a colliding prefix is refused while he is standing there.** Myk assigns a prefix that would
collide at the GraphQL door with a field his store already serves. The store refuses and names the
field it would collide with. He picks another prefix and it succeeds.

**S4 — the standing instruction.** Myk tells Loam to keep accepting on this channel. He schedules
nothing and does not know how it polls.

**S5 — the first sync reports what happened.** Myk sees how many deltas arrived, which laws bound,
and the name each bound under.

**S6 — he reads Alice's data without registering anything.** Myk queries `alice:Post` and gets
Alice's data. He never wrote a schema.

**S7 — later deltas arrive on their own.** Alice adds a Post an hour later. Myk queries again and
sees it, having run no command in between.

**S8 — the channel says when it last succeeded.** Myk looks at the channel and sees the time of its
last successful sync. When Alice's store has been unreachable since yesterday, that is visible and is
not confused with Alice having nothing new.

**S9 — a name that needs a decision is parked, not guessed.** Alice federates two laws that both call
themselves `Post`. One binds. The other is parked, and Myk sees the reason and his two choices:
supersede the bound name, or bind under another.

**S10 — fan-in to one container.** Myk accepts a second channel from Bob into the same receiving
container, prefixed `bob`. He queries `alice:Post` and `bob:Post` and gets each peer's data
separately.

**S11 — pausing blessing.** Myk turns blessing off for Alice's channel. New deltas still arrive. New
law stops binding. Law already bound keeps working. The channel report says so.

**S12 — cursing one law.** Myk retires one law that is already bound. That law stops binding. Every
other law on the channel is untouched, and the retirement survives the next poll.

**S13 — freezing the channel.** Myk freezes Alice's channel. Nothing new arrives. Everything already
received still reads.

**S14 — dropping the inbox.** Myk drops Alice's inbox. Alice's deltas are gone from his store. Bob's
data still reads.

## Recommendations on the open questions

Written as recommendations for Myk to redline rather than decisions taken.

**R1 — auto-bless default.** Recommend blessing defaults ON for an accepted offer (S1a) and OFF for a
subscribe (S1b). An offer is a two-party act; a subscribe is unilateral. Myk's stated view is that a
vetted aggregator makes this less sharp, so the default is a convenience and either way the toggle is
one act.

**R2 — an unreachable peer.** Recommend the channel record carry `lastSyncedAt` and the count of
consecutive failed attempts, both as deltas. A report that says only "nothing new" when it has not
reached the peer in a day is H9's shape: a false negative that licenses inaction.

**R3 — a curse and a republished law.** A strike on an adoption record is durable across re-runs,
because an adoption record inherits its source row's timestamp and so re-mints the same delta id. It
does NOT cover law the publisher republishes as genuinely new content, which carries a new address.
That is correct and must be visible: recommend the sync report name a newly bound law that replaces
one the receiver had retired.

## Acceptance criteria

1. A publisher offers a container and a receiver accepts it, and the receiver's named container
   gathers the publisher's deltas — verified by `test/federation/channel-open.test.ts`.
2. A receiver subscribes to a source address with no offer having been minted, reaching the same
   state as an accepted offer — verified by `test/federation/channel-subscribe.test.ts`.
3. Assigning a prefix that would flatten onto an existing GraphQL field is refused at assignment
   time, and the refusal names the colliding field — verified by
   `test/federation/prefix-injective.test.ts`.
4. A law arriving on a channel prefixed `alice` binds at the living name `alice:Post` and serves at
   the GraphQL field the door derives from it, with the receiver having registered nothing — verified
   by `test/federation/bind-on-arrival.test.ts`.
5. The bare name binds only by an explicit recorded alias, and never by inference from there being
   one candidate — verified by `test/federation/bare-alias-explicit.test.ts`.
6. Two laws on one channel that claim the same living name resolve as one bound and one parked, and
   the parked row names both choices — verified by `test/federation/name-parked.test.ts`.
7. Deltas added at the publisher after the channel opened arrive without the receiver running a
   command, driven through the real standing instruction rather than a hand-called sync — verified by
   `test/federation/standing-sync.test.ts`.
8. The channel record carries its last successful sync time and its consecutive failure count as
   deltas, and an unreachable peer is reported as unreachable rather than as nothing new — verified
   by `test/federation/last-synced.test.ts`.
9. Two channels into one receiving container serve their peers' data under separate prefixes without
   either shadowing the other — verified by `test/federation/fan-in.test.ts`.
10. Pausing blessing stops new law binding and leaves already-bound law serving — verified by
    `test/federation/bless-toggle.test.ts`.
11. Cursing one bound law retires that law only, and the retirement survives a subsequent poll —
    verified by `test/federation/curse-durable.test.ts`.
12. Freezing a channel stops new deltas arriving and leaves everything already received readable —
    verified by `test/federation/freeze-toggle.test.ts`.
13. Dropping one channel's inbox removes that peer's deltas from the store at the bytes AND leaves a
    named second peer's data serving — verified by `test/federation/drop-two-sided.test.ts`.
14. A delta that arrived on two channels independently survives in the second channel's pool after
    the first is dropped — verified by `test/federation/drop-shared-delta.test.ts`.
15. A receiver's primary ground contains none of a peer's deltas, which live only in the channel's
    pool — verified by `test/federation/pool-isolation.test.ts`.
16. The whole friend path runs end to end against live servers — two stores, different operator keys,
    offer, accept, prefix, standing sync, read — verified by
    `test/federation/friend-scenario.test.ts`.
17. Every user story above is reachable from the CLI with the commands the README documents —
    verified by `npm run check`.

## Deliberately out of scope

Two-way federation over one channel. Push transport. Vetting or reputation for a public aggregator.
Renderer bundles crossing a channel — a schema is data, a renderer is code, and code inherits §24.5's
quarantine bill rather than riding this.
