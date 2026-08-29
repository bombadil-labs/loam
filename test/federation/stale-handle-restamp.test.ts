// T233 — a stale handle cannot re-stamp a severed channel back into existence.
//
// `dropChannel` negates every live channel record for a pool, but a caller still holding the Channel
// handle it opened with keeps `channel.sync()`. A sync poll that accepts nothing sails past the
// pool's own purged ground and lands the SUCCESS stamp anyway — a fresh operator-signed record whose
// latest-wins reading resurrects the channel, with no pool behind it. The drop's negation only ever
// covered the OLD record. Found by T217's review, deferred there to its own ticket.
//
// The fix guards `stamp`: it refuses over a SEVERED LINEAGE (the drop's negation stands and no open
// has re-created the channel) and names the re-open path. Only `openChannel` — the legitimate way a
// severed channel comes back — writes the first record while the old ones are struck. The guard
// re-reads liveness AT THE APPEND: a `federate drop` can land while a poll is parked in `await
// pull()`, and only a stamp-time read sees that (criterion (c) makes that interleave deterministic).
//
// Asserted at BOTH levels:
//   - DELTA LEVEL: right after the sever, the drop's strike really stands and no live operator record
//     remains; after the refused sync, no NEW live record was minted.
//   - OBJECT LEVEL: `channelStatus` and `channelsEver` agree the channel is severed, and the stale
//     sync REJECTS naming the sever.
//
// TWO-SIDED, as every sever rail here is: a named bystander channel that was never dropped keeps
// stamping — its stale-handle sync still lands — so the guard refuses the severed case and nothing
// else. And criterion (b) proves the legitimate `federate open` re-creates a fresh channel cleanly,
// AND fails if the guard is built without its open bypass — a fix that over-refuses freezes a
// re-opened channel out of its own stamps.
//
// SCOPE, named rather than left implicit: the EMPTY poll is the reproduction, because a poll carrying
// real deltas throws first at `ground.federate` against the purged pool's closed ground and never
// reaches a stamp at all. That other shape is caught by a different mechanism (the closed pool), not
// by T233's guard, so it earns no rail here — a test of it would pass with this fix reverted.
//
// Two stamp sites carry the guard but are UNREACHABLE with a severed lineage, so no rail drives them
// (a mutation of their `opening` argument survives, correctly — the path cannot be exercised):
//   - the ATTEST-FAILURE stamp. `attestArrival` throws only with something accepted or owed, and a
//     severed channel's poll has neither — `owed` reads `[]` from an absent record, and a real-delta
//     poll dies at `federate` on the closed pool before it. So the attest-failure stamp never runs on
//     a severed channel; its guard is defence in depth for a future caller.
//   - `setChannel`'s stamp. `setChannelImpl` throws on `held === undefined` — i.e. on a severed
//     channel — BEFORE it reaches the stamp, so the stamp's guard there can never fire. The guard
//     stays for the same defence-in-depth reason.
//
// Erasure standing rule: every store here is this file's own MemoryBackend fixture.

import { afterEach, describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { CTX_CHANNEL } from "../../src/federation/channel.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "cc".repeat(32);
const ALICE = "channel:friends:alice";
const BRAM = "channel:friends:bram";

// An empty peer: a poll that accepts nothing is the realistic standing-sync case, and it is exactly
// the poll that reaches the success stamp after a sever — a poll carrying real deltas throws first,
// against the purged pool's closed ground, and never gets that far.
const nothing = { pull: (): Promise<never[]> => Promise.resolve([]) };

const grounds: Gateway[] = [];
async function store(seed: string): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
  grounds.push(gw);
  return gw;
}
afterEach(async () => {
  while (grounds.length > 0) await grounds.pop()!.close();
});

/**
 * Every operator-authored channel record for one pool that is NOT struck — the live delta-level view.
 * `name` is the full pool name (`channel:friends:alice`); a record marks its channel with the entity
 * `channel:<name>`, the same coordinate `readChannels` and `dropChannel` key on.
 */
const liveRecords = (gw: Gateway, name: string): string[] =>
  [...gw.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.author === gw.operatorAuthor &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.context === CTX_CHANNEL &&
            p.target.entity.id === `channel:${name}`,
        ) &&
        gw.reactor.negationsOf(d.id).length === 0,
    )
    .map((d) => d.id);

describe("T233 (a) — a stale handle's stamp refuses over a severed lineage", () => {
  it("the post-sever sync rejects naming the sever, and both readers agree severed", async () => {
    const me = await store(OPERATOR_SEED);
    // The bystander channel, opened and synced so it carries a real record — never dropped. Its
    // stale handle is what proves the guard refuses the SEVERED case and not stamping in general.
    const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await bram.sync();
    const bramAt = me.channelStatus(BRAM)[0]!.lastSyncedAt;
    expect(bramAt).toBeGreaterThan(1755000000000); // a wall-clock floor, not a value read from the record

    // The target channel: opened, synced once so a real record stands, then severed.
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: nothing });
    await alice.sync();
    expect(me.channelStatus(ALICE)).toHaveLength(1);
    expect(liveRecords(me, ALICE).length).toBeGreaterThan(0);

    await me.dropChannel(ALICE);

    // DELTA LEVEL after the sever: the drop's strike stands, so no live operator record remains for
    // the pool. This is the state a stale re-stamp would climb back out of.
    expect(liveRecords(me, ALICE)).toEqual([]);
    // OBJECT LEVEL: the live reading is empty and the ever reading still names the channel — the two
    // readers agree it is SEVERED, which is exactly the lineage the guard keys on.
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    // THE FIX: driving the stale handle's stamp REFUSES, and names the sever and the re-open path.
    // Reverted, this resolves and the success stamp mints a fresh live record — the resurrection.
    await expect(alice.sync()).rejects.toThrow(/severed[\s\S]*loam federate open/);

    // DELTA LEVEL: the refused stamp minted NOTHING — still no live record for the pool.
    expect(liveRecords(me, ALICE)).toEqual([]);
    // OBJECT LEVEL: the channel is still severed in both readings — not resurrected.
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    // TWO-SIDED: the bystander was never severed, so its sync COMPLETES — a guard that refused
    // every stamp would throw here, which is what keeps this half discriminating. Under the pulse
    // law (SPEC §49.1) a quiet completion writes nothing: the record holds still and no row is
    // added, and that stillness is asserted rather than tolerated.
    const before = liveRecords(me, BRAM).length;
    await bram.sync();
    expect(me.channelStatus(BRAM)).toHaveLength(1);
    expect(me.channelStatus(BRAM)[0]!.lastSyncedAt).toBe(bramAt);
    expect(liveRecords(me, BRAM).length).toBe(before);
  });

  it("a stale sync whose PULL FAILS after a sever refuses too, and resurrects nothing", async () => {
    // The success stamp is not the only stamp a stale handle reaches. A poll whose peer does not
    // answer runs the FAILURE stamp — and that stamp, ungated, would write a fresh operator-signed
    // record (its failure counter raised) that resurrects the severed channel exactly as the success
    // stamp would. So the guard must bite on the failure path too, not only the success path.
    const me = await store(OPERATOR_SEED);
    const dead = {
      pull: (): Promise<never[]> => Promise.reject(new Error("peer did not answer")),
    };
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: dead });
    // Live channel: the pull fails but the record stands, so a failure stamp lands (two-sided — the
    // guard does not refuse a failure stamp on a channel that is not severed).
    await expect(alice.sync()).rejects.toThrow(/did not answer/);
    expect(me.channelStatus(ALICE)).toHaveLength(1);

    await me.dropChannel(ALICE);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(liveRecords(me, ALICE)).toEqual([]);

    // The stale handle's failing sync: the FAILURE stamp refuses over the severed lineage, so the
    // sever error propagates rather than the peer's, and no record is minted. Ungated, the failure
    // stamp lands and `channelStatus` climbs back to 1.
    await expect(alice.sync()).rejects.toThrow(/severed/);
    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);
  });
});

describe("T233 (b) — the legitimate re-open after a sever is untouched", () => {
  it("`federate open` re-creates a fresh channel cleanly, and it syncs", async () => {
    const me = await store(OPERATOR_SEED);
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: nothing });
    await alice.sync();
    const firstAt = me.channelStatus(ALICE)[0]!.lastSyncedAt;
    expect(firstAt).toBeGreaterThan(1755000000000);

    await me.dropChannel(ALICE);
    expect(me.channelStatus(ALICE)).toHaveLength(0);

    // Re-open under the same (into, prefix): this is the ONE act that writes a record while the old
    // one is struck, so the guard must let it through (openChannel passes `opening`). Reverted-fix
    // this would still pass, so the two-sided sync below is what makes (b) prove the bypass works.
    const reopened = await me.openChannel({ into: "friends", prefix: "alice", source: nothing });
    const live = me.channelStatus(ALICE);
    expect(live).toHaveLength(1);
    // GENUINELY FRESH, not the resurrected old record: a re-opened channel has never synced, so its
    // clock reads 0 rather than the severed record's real time.
    expect(live[0]!.lastSyncedAt).toBe(0);
    expect(live[0]!.receiving).toBe(true);
    expect(live[0]!.unreadable).toEqual([]);
    // One live record for the pool — the fresh one — and it is NOT struck.
    expect(liveRecords(me, ALICE)).toHaveLength(1);

    // The re-opened channel is fully live: its sync lands, so the lineage reads standing (not
    // severed) and the stamp guard lets an ordinary poll write. This is what the `opening` bypass
    // buys — a channel that came back is not frozen out of its own stamps.
    await reopened.sync();
    expect(me.channelStatus(ALICE)[0]!.lastSyncedAt).toBeGreaterThan(0);
  });
});

describe("T233 (c) — a drop that lands DURING the poll refuses the stamp that follows", () => {
  // The guard re-reads liveness AT THE APPEND, not at poll-top. A `federate drop` can land while a
  // sync is parked in `await pull()`: the poll-top reading saw the channel live, but by the stamp it
  // is severed. A guard resting on the poll-top reading would stamp anyway and resurrect it. A timing
  // window is invisible to hollow-test, so these rails make the interleave DETERMINISTIC — the mock
  // source severs the channel as a side effect of `pull()`, so the stamp always fires after the drop.
  // Both FAIL if the guard trusts a poll-top status and PASS when it re-reads at stamp time.

  /** A source that severs `channel` on its Nth-and-later pulls, then returns [] (or throws). */
  const severingSource = (
    gw: () => Gateway,
    channel: string,
    then: "return" | "throw",
  ): { pull: () => Promise<never[]>; arm: () => void } => {
    let armed = false;
    return {
      arm: () => {
        armed = true;
      },
      pull: async (): Promise<never[]> => {
        if (armed) await gw().dropChannel(channel);
        if (then === "throw") throw new Error("peer did not answer");
        return [];
      },
    };
  };

  it("the SUCCESS stamp refuses when the drop interleaves before it", async () => {
    const me = await store(OPERATOR_SEED);
    // A bystander, never dropped, proving the same success path still stamps (two-sided).
    const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await bram.sync();
    const bramAt = me.channelStatus(BRAM)[0]!.lastSyncedAt;

    const src = severingSource(() => me, ALICE, "return");
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: src });
    await alice.sync(); // a live poll — the sever is not armed yet
    expect(me.channelStatus(ALICE)).toHaveLength(1);

    // Arm the interleave: this poll's `pull()` severs the channel, THEN returns [], so the success
    // stamp fires against a channel that went severed mid-poll. Poll-top read it live.
    src.arm();
    await expect(alice.sync()).rejects.toThrow(/severed/);

    // DELTA + OBJECT level: the interleaved drop stands, and the post-drop stamp minted nothing.
    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    // Two-sided: the bystander, never dropped, still COMPLETES through the same success path —
    // and quietly, so its record holds still (SPEC §49.1).
    await bram.sync();
    expect(me.channelStatus(BRAM)).toHaveLength(1);
    expect(me.channelStatus(BRAM)[0]!.lastSyncedAt).toBe(bramAt);
  });

  it("the FAILURE stamp refuses when the drop interleaves before it", async () => {
    // The widest route: the failure stamp never touches the pool, so it would resurrect regardless of
    // pool state. An unreachable peer is also the likeliest reason an operator drops mid-poll.
    const me = await store(OPERATOR_SEED);
    const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await bram.sync();
    const bramAt = me.channelStatus(BRAM)[0]!.lastSyncedAt;

    const src = severingSource(() => me, ALICE, "throw");
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: src });
    expect(me.channelStatus(ALICE)).toHaveLength(1); // the open record stands

    // The poll's `pull()` severs the channel, then throws. The failure stamp fires next and must
    // refuse over the now-severed lineage — so the sever error propagates, not the peer's.
    src.arm();
    await expect(alice.sync()).rejects.toThrow(/severed/);

    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    // Two-sided: the bystander still completes, quietly (SPEC §49.1).
    await bram.sync();
    expect(me.channelStatus(BRAM)).toHaveLength(1);
    expect(me.channelStatus(BRAM)[0]!.lastSyncedAt).toBe(bramAt);
  });
});
