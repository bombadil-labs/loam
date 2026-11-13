import { afterEach, describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { CTX_CHANNEL } from "../../src/federation/channel.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "cc".repeat(32);
const ALICE = "channel:friends:alice";
const BRAM = "channel:friends:bram";

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
    const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await bram.sync();
    const bramAt = me.channelStatus(BRAM)[0]!.lastSyncedAt;
    expect(bramAt).toBeGreaterThan(1755000000000);

    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: nothing });
    await alice.sync();
    expect(me.channelStatus(ALICE)).toHaveLength(1);
    expect(liveRecords(me, ALICE).length).toBeGreaterThan(0);

    await me.dropChannel(ALICE);

    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    await expect(alice.sync()).rejects.toThrow(/severed[\s\S]*loam federate open/);

    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    const before = liveRecords(me, BRAM).length;
    await bram.sync();
    expect(me.channelStatus(BRAM)).toHaveLength(1);
    expect(me.channelStatus(BRAM)[0]!.lastSyncedAt).toBe(bramAt);
    expect(liveRecords(me, BRAM).length).toBe(before);
  });

  it("a stale sync whose PULL FAILS after a sever refuses too, and resurrects nothing", async () => {
    const me = await store(OPERATOR_SEED);
    const dead = {
      pull: (): Promise<never[]> => Promise.reject(new Error("peer did not answer")),
    };
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: dead });
    await expect(alice.sync()).rejects.toThrow(/did not answer/);
    expect(me.channelStatus(ALICE)).toHaveLength(1);

    await me.dropChannel(ALICE);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(liveRecords(me, ALICE)).toEqual([]);

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

    const reopened = await me.openChannel({ into: "friends", prefix: "alice", source: nothing });
    const live = me.channelStatus(ALICE);
    expect(live).toHaveLength(1);
    expect(live[0]!.lastSyncedAt).toBe(0);
    expect(live[0]!.receiving).toBe(true);
    expect(live[0]!.unreadable).toEqual([]);
    expect(liveRecords(me, ALICE)).toHaveLength(1);

    await reopened.sync();
    expect(me.channelStatus(ALICE)[0]!.lastSyncedAt).toBeGreaterThan(0);
  });
});

describe("T233 (c) — a drop that lands DURING the poll refuses the stamp that follows", () => {
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
    const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await bram.sync();
    const bramAt = me.channelStatus(BRAM)[0]!.lastSyncedAt;

    const src = severingSource(() => me, ALICE, "return");
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: src });
    await alice.sync();
    expect(me.channelStatus(ALICE)).toHaveLength(1);

    src.arm();
    await expect(alice.sync()).rejects.toThrow(/severed/);

    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    await bram.sync();
    expect(me.channelStatus(BRAM)).toHaveLength(1);
    expect(me.channelStatus(BRAM)[0]!.lastSyncedAt).toBe(bramAt);
  });

  it("the FAILURE stamp refuses when the drop interleaves before it", async () => {
    const me = await store(OPERATOR_SEED);
    const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await bram.sync();
    const bramAt = me.channelStatus(BRAM)[0]!.lastSyncedAt;

    const src = severingSource(() => me, ALICE, "throw");
    const alice = await me.openChannel({ into: "friends", prefix: "alice", source: src });
    expect(me.channelStatus(ALICE)).toHaveLength(1);

    src.arm();
    await expect(alice.sync()).rejects.toThrow(/severed/);

    expect(liveRecords(me, ALICE)).toEqual([]);
    expect(me.channelStatus(ALICE)).toHaveLength(0);
    expect(me.channelsEver(ALICE)).toHaveLength(1);

    await bram.sync();
    expect(me.channelStatus(BRAM)).toHaveLength(1);
    expect(me.channelStatus(BRAM)[0]!.lastSyncedAt).toBe(bramAt);
  });
});
