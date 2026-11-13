import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { withStamp } from "../../src/gateway/stamp.js";
import {
  containerClaims,
  readContainerTable,
  survivingDeclarationIds,
} from "../../src/gateway/container-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import {
  CTX_CHANNEL,
  channelRecordClaims,
  type ChannelSource,
} from "../../src/federation/channel.js";

const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);
const CAROL_SEED = "c7".repeat(32);
const STRANGER_SEED = "d4".repeat(32);
const MOSS = "plant:moss";

const quiet: ChannelSource = { pull: () => Promise.resolve([]) };

async function store(seed = BOB_SEED): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

const feedFrom = (peer: Gateway): ChannelSource => ({
  pull: () => Promise.resolve(peer.reactor.arrivalLog()),
});

const refusalOf = async (open: Promise<unknown>): Promise<string | undefined> =>
  open.then(() => undefined).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));

const declares = (gw: Gateway, container: string): boolean =>
  readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.has(container);

const recordOf = (gw: Gateway, channel: string): Delta =>
  [...gw.reactor.snapshot()]
    .filter((d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === CTX_CHANNEL &&
          p.target.entity.id === `channel:${channel}`,
      ),
    )
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp)
    .at(-1)!;

const roleOf = (d: Delta, role: string): string | number | boolean | undefined => {
  const p = d.claims.pointers.find((q) => q.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

const strikeBy = async (gw: Gateway, seed: string, target: string): Promise<Delta> => {
  const strike = signClaims(
    withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, target)),
    seed,
  );
  await gw.append([strike]);
  return strike;
};

describe("T215 (a) — the collision the split hid", () => {
  it("a colon in the receiving container no longer hides a real collision", async () => {
    const gw = await store();
    try {
      const feed = await gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet });
      expect(feed.name).toBe("channel:ada:feed:alice");
      expect(roleOf(recordOf(gw, feed.name), "prefix")).toBe("alice");
      expect(roleOf(recordOf(gw, feed.name), "into")).toBe("ada:feed");
      const held = gw.channelStatus(feed.name)[0]!;
      expect(held.prefix).toBe("alice");
      expect(held.into).toBe("ada:feed");

      const refusal = await refusalOf(
        gw.openChannel({ into: "inbox", prefix: "alice", source: quiet }),
      );
      expect(refusal).toBeDefined();
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:ada:feed:alice"',
      );
      expect(refusal).toContain('A living name is "<prefix>:<alias>" and carries no container');

      expect(gw.channelStatus().map((s) => s.name)).toEqual(["channel:ada:feed:alice"]);
      expect(declares(gw, "channel:inbox:alice")).toBe(false);
      expect(declares(gw, "inbox")).toBe(false);
      expect(declares(gw, "channel:ada:feed:alice")).toBe(true);
    } finally {
      await gw.close();
    }
  });

  it("the receiving container's colons do not travel into the prefix that is compared", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "one:deep:nest", prefix: "b:ob", source: quiet });
      const refusal = await refusalOf(
        gw.openChannel({ into: "two", prefix: "b_ob", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "b:ob" already assigned by "channel:one:deep:nest:b:ob"',
      );
      expect(declares(gw, "channel:two:b_ob")).toBe(false);
    } finally {
      await gw.close();
    }
  });
});

describe("T215 (b) — the refusal the split invented", () => {
  it("a prefix that only LOOKED taken opens, and the standing channel keeps serving", async () => {
    const alice = await store(ALICE_SEED);
    const carol = await store(CAROL_SEED);
    const bob = await store();
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      const mossy = observed(MOSS, "height", 7, 500, CAROL_SEED);
      await carol.append([mossy]);

      const feed = await bob.openChannel({
        into: "ada:feed",
        prefix: "alice",
        source: feedFrom(alice),
      });
      expect((await feed.sync()).bound).toContain("alice:Plant");

      const other = await bob.openChannel({
        into: "other",
        prefix: "feed:alice",
        source: feedFrom(carol),
      });
      expect(other.name).toBe("channel:other:feed:alice");
      expect(other.prefix).toBe("feed:alice");
      const arrived = await other.sync();
      expect(arrived.accepted).toBeGreaterThan(0);

      expect(declares(bob, "channel:ada:feed:alice")).toBe(true);
      expect(declares(bob, "channel:other:feed:alice")).toBe(true);
      expect(
        bob
          .channelStatus()
          .map((s) => `${s.name} -> ${s.prefix}`)
          .sort(),
      ).toEqual(["channel:ada:feed:alice -> alice", "channel:other:feed:alice -> feed:alice"]);

      const answer = await bob.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(answer.errors).toBeUndefined();
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);

      const otherSide = bob.containerScope({ containers: ["other"] }).map((d) => d.id);
      const feedSide = bob.containerScope({ containers: ["ada:feed"] }).map((d) => d.id);
      expect(otherSide).toContain(mossy.id);
      expect(feedSide).not.toContain(mossy.id);
    } finally {
      await alice.close();
      await carol.close();
      await bob.close();
    }
  });
});

describe("T215 (c) — the plain cases are unchanged", () => {
  it("a store with NO channels opens its first one", async () => {
    const gw = await store();
    try {
      const first = await gw.openChannel({ into: "inbox", prefix: "alice", source: quiet });
      expect(first.name).toBe("channel:inbox:alice");
      expect(gw.channelStatus(first.name)[0]!.prefix).toBe("alice");
      expect(declares(gw, "channel:inbox:alice")).toBe(true);
    } finally {
      await gw.close();
    }
  });

  it("one plain channel: the prefix is taken elsewhere, another is free, and the pair resumes", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );
      const second = await gw.openChannel({ into: "friends", prefix: "bob", source: quiet });
      expect(second.prefix).toBe("bob");
      const again = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      expect(again.name).toBe("channel:friends:alice");
      expect(
        gw
          .channelStatus()
          .map((s) => s.name)
          .sort(),
      ).toEqual(["channel:friends:alice", "channel:friends:bob"]);
    } finally {
      await gw.close();
    }
  });

  it("the flattening near-miss still collides on a colon-free container", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "friends", prefix: "al:ice", source: quiet });
      const refusal = await refusalOf(
        gw.openChannel({ into: "friends", prefix: "al_ice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "al:ice" already assigned by "channel:friends:al:ice"',
      );
      expect(declares(gw, "channel:friends:al_ice")).toBe(false);
    } finally {
      await gw.close();
    }
  });

  it("a severed channel frees its prefix, exactly as the container table did", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      await gw.dropChannel(ch.name);
      expect(declares(gw, "channel:friends:alice")).toBe(false);
      expect(gw.channelStatus()).toEqual([]);
      const reborn = await gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet });
      expect(reborn.name).toBe("channel:elsewhere:alice");
    } finally {
      await gw.close();
    }
  });
});

describe("T215 (d) — only this store's own law assigns a prefix", () => {
  it("a stranger's channel record neither re-points a prefix nor frees one", async () => {
    const alice = await store(ALICE_SEED);
    const gw = await store();
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      const ch = await gw.openChannel({
        into: "friends",
        prefix: "alice",
        source: feedFrom(alice),
      });
      expect((await ch.sync()).bound).toContain("alice:Plant");
      await gw.append([observed(FERN, "height", 999, 5000, BOB_SEED)]);

      const mine = recordOf(gw, ch.name);
      const shadow = signClaims(
        channelRecordClaims(
          {
            name: ch.name,
            into: "friends",
            prefix: "zzz",
            receiving: true,
            blessing: true,
            lastSyncedAt: 0,
            consecutiveFailures: 0,
            from: "",
            unattested: [],
            unreadable: [],
          },
          authorForSeed(STRANGER_SEED),
          mine.claims.timestamp + 1,
        ),
        STRANGER_SEED,
      );
      expect((await gw.federate([shadow])).accepted).toBe(1);
      expect(gw.reactor.get(shadow.id)).toBeDefined();
      expect(recordOf(gw, ch.name).id).toBe(shadow.id);

      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");
      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );

      const served = await gw.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(served.errors).toBeUndefined();
      expect((served.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);

      const zzz = await gw.openChannel({ into: "elsewhere", prefix: "zzz", source: quiet });
      expect(zzz.prefix).toBe("zzz");
    } finally {
      await alice.close();
      await gw.close();
    }
  });

  it("a stranger's strike of a channel record does not free its prefix", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      const record = recordOf(gw, ch.name);
      const strike = signClaims(
        makeNegationClaims(authorForSeed(STRANGER_SEED), record.claims.timestamp + 1, record.id),
        STRANGER_SEED,
      );
      expect((await gw.federate([strike])).accepted).toBe(1);
      expect(gw.reactor.negationsOf(record.id)).toContain(strike.id);

      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");
      expect(gw.channelsEver(ch.name)).toHaveLength(1);

      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );

      await gw.dropChannel(ch.name);
      expect(gw.channelStatus(ch.name)).toEqual([]);
    } finally {
      await gw.close();
    }
  });

  it("a pool whose declaration no longer leads its name is still named by its record", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) =>
            containerClaims(
              {
                container: ch.name,
                trust: "untrusted",
                posture: "separate",
                inboxOf: "other",
              },
              gw.operatorAuthor!,
              t,
            ),
          ),
          BOB_SEED,
        ),
      ]);
      expect(
        readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(ch.name)
          ?.inboxOf,
      ).toBe("other");
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");

      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );
    } finally {
      await gw.close();
    }
  });

  it("where the two readings disagree, the RECORD decides", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet });
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) =>
            containerClaims(
              { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "ada" },
              gw.operatorAuthor!,
              t,
            ),
          ),
          BOB_SEED,
        ),
      ]);
      expect(
        readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(ch.name)
          ?.inboxOf,
      ).toBe("ada");
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");

      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:ada:feed:alice"',
      );
      const derived = await gw.openChannel({
        into: "elsewhere",
        prefix: "feed:alice",
        source: quiet,
      });
      expect(derived.name).toBe("channel:elsewhere:feed:alice");
    } finally {
      await gw.close();
    }
  });

  it("a pool no reading can name refuses the open rather than checking around it", async () => {
    const gw = await store();
    try {
      const orphan = {
        container: "channel:ada:feed:alice",
        trust: "untrusted" as const,
        posture: "separate" as const,
      };
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) =>
            containerClaims({ ...orphan, inboxOf: "other" }, gw.operatorAuthor!, t),
          ),
          BOB_SEED,
        ),
      ]);
      const refusal = await refusalOf(
        gw.openChannel({ into: "inbox", prefix: "bob", source: quiet }),
      );
      expect(refusal).toContain("1 channel pool(s) whose assigned prefix it cannot name");
      expect(refusal).not.toContain("channel:ada:feed:alice");
      expect(declares(gw, "channel:inbox:bob")).toBe(false);
      expect(declares(gw, "inbox")).toBe(false);

      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) =>
            containerClaims({ ...orphan, inboxOf: "ada:feed" }, gw.operatorAuthor!, t),
          ),
          BOB_SEED,
        ),
      ]);
      const opened = await gw.openChannel({ into: "inbox", prefix: "bob", source: quiet });
      expect(opened.name).toBe("channel:inbox:bob");
    } finally {
      await gw.close();
    }
  });

  it("a pool declared before its record landed still assigns its prefix", async () => {
    const gw = await store();
    try {
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) =>
            containerClaims(
              {
                container: "channel:ada:feed:alice",
                trust: "untrusted",
                posture: "separate",
                inboxOf: "ada:feed",
              },
              gw.operatorAuthor!,
              t,
            ),
          ),
          BOB_SEED,
        ),
      ]);
      expect(declares(gw, "channel:ada:feed:alice")).toBe(true);
      expect(gw.channelStatus()).toEqual([]);

      const refusal = await refusalOf(
        gw.openChannel({ into: "inbox", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:ada:feed:alice"',
      );

      const other = await gw.openChannel({ into: "inbox", prefix: "bob", source: quiet });
      expect(other.prefix).toBe("bob");
    } finally {
      await gw.close();
    }
  });

  it("a record whose declaration was struck still reserves its prefix", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      for (const id of survivingDeclarationIds(
        gw.reactor,
        gw.validityNow(),
        gw.operatorAuthor!,
        ch.name,
      )) {
        await strikeBy(gw, BOB_SEED, id);
      }
      expect(declares(gw, ch.name)).toBe(false);
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");

      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );
      const other = await gw.openChannel({ into: "elsewhere", prefix: "bob", source: quiet });
      expect(other.prefix).toBe("bob");
    } finally {
      await gw.close();
    }
  });

  it("a strike that is itself struck revives the record, and a third strike retires it again", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      const record = recordOf(gw, ch.name);
      const first = await strikeBy(gw, BOB_SEED, record.id);
      expect(gw.channelStatus(ch.name)).toEqual([]);
      const second = await strikeBy(gw, BOB_SEED, first.id);
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");
      await strikeBy(gw, BOB_SEED, second.id);
      expect(gw.channelStatus(ch.name)).toEqual([]);
    } finally {
      await gw.close();
    }
  });
});

describe("T215 (e) — one pool name, one meaning", () => {
  it("a receiving container merely NAMED like a pool is not one, and wedges nothing", async () => {
    const gw = await store();
    try {
      const odd = await gw.openChannel({ into: "channel:foo", prefix: "x", source: quiet });
      expect(odd.name).toBe("channel:channel:foo:x");
      expect(declares(gw, "channel:foo")).toBe(true);

      const next = await gw.openChannel({ into: "friends", prefix: "y", source: quiet });
      expect(next.name).toBe("channel:friends:y");
      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "x", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "x" already assigned by "channel:channel:foo:x"',
      );
    } finally {
      await gw.close();
    }
  });

  it("two (container, prefix) pairs that mint one pool name — the second is refused", async () => {
    const gw = await store();
    try {
      const feed = await gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet });
      expect(feed.name).toBe("channel:ada:feed:alice");
      const refusal = await refusalOf(
        gw.openChannel({ into: "ada", prefix: "feed:alice", source: quiet }),
      );
      expect(refusal).toContain(
        'the pool "channel:ada:feed:alice" already belongs to the channel this store opened with ' +
          'the prefix "alice", and this call asks for "feed:alice"',
      );
      expect(refusal).toContain('A pool is named "channel:<into>:<prefix>"');
      expect(gw.channelStatus(feed.name)[0]!.prefix).toBe("alice");
      expect(
        readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(
          feed.name,
        )?.inboxOf,
      ).toBe("ada:feed");
      expect(declares(gw, "ada")).toBe(false);

      const again = await gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet });
      expect(again.name).toBe(feed.name);
      expect(again.prefix).toBe("alice");
    } finally {
      await gw.close();
    }
  });

  it("a store already living with a collision is told to sever, not to choose another prefix", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet });
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) =>
            containerClaims(
              {
                container: "channel:inbox:alice",
                trust: "untrusted",
                posture: "separate",
                inboxOf: "inbox",
              },
              gw.operatorAuthor!,
              t,
            ),
          ),
          BOB_SEED,
        ),
      ]);
      expect(declares(gw, "channel:ada:feed:alice")).toBe(true);
      expect(declares(gw, "channel:inbox:alice")).toBe(true);
      expect(gw.channelStatus("channel:ada:feed:alice")[0]!.prefix).toBe("alice");

      const refusal = await refusalOf(
        gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain("BOTH stand in this store");
      expect(refusal).toContain("channel:ada:feed:alice");
      expect(refusal).toContain("channel:inbox:alice");
      expect(refusal).toContain("loam federate drop");
      expect(refusal).not.toContain("Choose another prefix");

      await gw.dropChannel("channel:ada:feed:alice");
      const survivor = await gw.openChannel({ into: "inbox", prefix: "alice", source: quiet });
      expect(survivor.name).toBe("channel:inbox:alice");
    } finally {
      await gw.close();
    }
  });
});
