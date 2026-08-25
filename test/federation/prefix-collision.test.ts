// T215 — the prefix collision guard reads the prefix this store RECORDED, never a split of the
// pool's name.
//
// A pool is named `channel:<into>:<prefix>`, and a container name may itself carry a colon (only NUL
// and empty are refused). So no split of that name by itself can separate `into` from `prefix`: into
// "ada:feed" + prefix "alice" and into "ada" + prefix "feed:alice" mint the SAME pool name. A guard
// that cut at the first colon read one channel's prefix as "feed:alice" — it missed the real
// collision with "alice", and it refused an innocent "feed:alice" while naming a channel that had
// never assigned it. Two of the store's own records know the prefix: the channel record's `prefix`
// role, and the pool declaration's `inboxOf` role, which names the container half exactly.
//
// WHICH LEVEL EACH RAIL CARRIES, per block and no wider:
//  - (a) asserts the refusal text, the record's own bytes, and the container declarations the
//    store holds after the refused open;
//  - (b) is the OBJECT level — the served GraphQL value and what a reader of the receiving
//    container gathers;
//  - (c) is the preservation set. Each asserts the refusal or the open plus the declarations, the
//    records, or both — they exist to prove the plain cases did not move;
//  - (d) drives the ground directly — a stranger's record, a stranger's strike, a re-pointed pool,
//    a pool with no record, a record with no declaration, a three-deep strike chain — and its first
//    test also reads the DOOR, which is where a re-pointed prefix leaks the receiver's own claims.
//    Four of them separate the two prefix readings, so neither reading can be deleted or promoted
//    while the file is green;
//  - (e) holds four: a container merely NAMED like a pool, two (container, prefix) pairs that mint
//    one pool name, the advice a store already holding a collision is given, and the operand set a
//    sever strikes over. The last two are the only rails for those two behaviours.
//
// WHAT THESE RAILS DO NOT SHOW: that two channels sharing a flattened prefix actually cross at the
// served field. The guard refuses that state, so it cannot be built through the public API, and
// nothing here demonstrates the harm the refusal prevents. It would want a fixture that plants both
// pools at the delta level and then reads the door.
//
// TWO GAPS NAMED, NEITHER CLOSED HERE. `cursesOf` still resolves through `struck`, which counts a
// negation from ANY author and stops after two links — the channel readings moved to the
// operator-scoped, transitive `lawfulNegated` and `cursesOf` did not. And on a store with NO
// operator, `channelStatus` and `channelsEver` both answer empty, which `channelGroundFor`
// (src/gateway/reads.ts) reads as "not a channel lens" and resolves over the receiver's own ground
// rather than refusing — fail-open where the container table fails closed. No shipped boot reaches
// that state; every one supplies a seed.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  containerClaims,
  readContainerTable,
  survivingDeclarationIds,
} from "../../src/gateway/container.js";
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
  readContainerTable(gw.reactor, gw.operatorAuthor).containers.has(container);

/** The newest channel-record delta for one channel, read from the ground rather than the API. */
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

/** One primitive role off a delta, read from the bytes rather than through any reader. */
const roleOf = (d: Delta, role: string): string | number | boolean | undefined => {
  const p = d.claims.pointers.find((q) => q.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

/** An operator-signed negation of one delta, appended to the store's own ground. */
const strikeBy = async (gw: Gateway, seed: string, target: string): Promise<Delta> => {
  const strike = signClaims(
    makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), target),
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
      // DELTA LEVEL, read from the ground rather than through the reader this change rewrites: the
      // RECORD's own `prefix` role says "alice". The pool's name is the ambiguous half — it reads
      // identically to into "ada" + prefix "feed:alice".
      expect(roleOf(recordOf(gw, feed.name), "prefix")).toBe("alice");
      expect(roleOf(recordOf(gw, feed.name), "into")).toBe("ada:feed");
      const held = gw.channelStatus(feed.name)[0]!;
      expect(held.prefix).toBe("alice");
      expect(held.into).toBe("ada:feed");

      // Both channels would serve the SAME living names, `alice:<alias>`, and both prefix-to-channel
      // lookups resolve by prefix alone. This is the open that must not happen.
      const refusal = await refusalOf(
        gw.openChannel({ into: "inbox", prefix: "alice", source: quiet }),
      );
      expect(refusal).toBeDefined();
      // ONE PHRASE, not two substrings: the old message named "feed:alice", which CONTAINS "alice"
      // and would satisfy any looser check while still lying about which prefix stands.
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:ada:feed:alice"',
      );
      // And it says WHY one prefix may not be assigned twice, or a person cannot tell a real
      // collision from a name they are simply not allowed to use.
      expect(refusal).toContain('A living name is "<prefix>:<alias>" and carries no container');

      // DELTA LEVEL, two-sided: the refused open created nothing — not the pool, not the
      // receiving container it would have nested under — and the standing channel is untouched.
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
      // The split read this channel's prefix as "deep:nest:b:ob", which flattens to `deep_nest_b_ob`
      // and collides with nothing a person would ever type. Its real prefix is "b:ob".
      await gw.openChannel({ into: "one:deep:nest", prefix: "b:ob", source: quiet });
      // `b:ob` and `b_ob` are disjoint namespaces that flatten onto the same GraphQL field lead.
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

      // THE OPEN THE SPLIT REFUSED. `channel:ada:feed:alice` assigned the prefix "alice"; it never
      // assigned "feed:alice", and no channel here has.
      const other = await bob.openChannel({
        into: "other",
        prefix: "feed:alice",
        source: feedFrom(carol),
      });
      expect(other.name).toBe("channel:other:feed:alice");
      expect(other.prefix).toBe("feed:alice");
      const arrived = await other.sync();
      expect(arrived.accepted).toBeGreaterThan(0);

      // DELTA LEVEL: both pools stand, and each record carries its own prefix.
      expect(declares(bob, "channel:ada:feed:alice")).toBe(true);
      expect(declares(bob, "channel:other:feed:alice")).toBe(true);
      expect(
        bob
          .channelStatus()
          .map((s) => `${s.name} -> ${s.prefix}`)
          .sort(),
      ).toEqual(["channel:ada:feed:alice -> alice", "channel:other:feed:alice -> feed:alice"]);

      // OBJECT LEVEL, two-sided. The bystander still SERVES alice's law under its own prefix —
      // the value, not merely a field that answers null...
      const answer = await bob.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(answer.errors).toBeUndefined();
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);

      // ...and the new channel's peer lands in the container the receiver named for it, never in
      // the bystander's.
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
      // Two-sided: the guard is not a blanket refusal...
      const second = await gw.openChannel({ into: "friends", prefix: "bob", source: quiet });
      expect(second.prefix).toBe("bob");
      // ...and re-opening the SAME (into, prefix) resumes rather than colliding with itself.
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
      // DELTA LEVEL: the sever strikes both halves the guard reads — the declaration and the
      // record — so the prefix leaves the standing set by the same act.
      expect(declares(gw, "channel:friends:alice")).toBe(false);
      expect(gw.channelStatus()).toEqual([]);
      // The prefix is assignable again, in a different container.
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
      // A REAL channel, synced and bound, because the object-level half below asks what the DOOR
      // answers — and a lens that was never blessed answers nothing whatever the guard does.
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      const ch = await gw.openChannel({
        into: "friends",
        prefix: "alice",
        source: feedFrom(alice),
      });
      expect((await ch.sync()).bound).toContain("alice:Plant");
      // The receiver's OWN claim about the same entity, later and larger. It is what a lens that
      // fell back to the primary ground would answer with. Written AFTER the pool opened, because a
      // separate container seeds one-way from the primary at open time — a claim written first
      // would be copied into the pool and could not tell the two grounds apart.
      await gw.append([observed(FERN, "height", 999, 5000, BOB_SEED)]);

      // A peer's delta filed at the channel context, one tick LATER than this store's own record —
      // read from the record itself, because a hand-picked constant is smaller than a wall-clock
      // stamp and would lose latest-wins for the wrong reason. Latest-wins hands this delta the
      // channel's prefix if authorship is not read.
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
      // DELTA LEVEL: it really is in the receiver's ground, and it really is the newest record for
      // this channel — the rail is not passing because the door refused the fixture or because the
      // fixture lost the comparison it exists to win.
      expect((await gw.federate([shadow])).accepted).toBe(1);
      expect(gw.reactor.get(shadow.id)).toBeDefined();
      expect(recordOf(gw, ch.name).id).toBe(shadow.id);

      // The receiver's own word stands, and the guard reads it.
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");
      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );

      // OBJECT LEVEL: the door still resolves this lens over the PEER's pool. Without the author
      // scope the shadow re-points the channel's prefix to "zzz", so neither a live channel nor a
      // severed one answers to "alice", and the lens resolves over the receiver's own ground —
      // where 999 is waiting. 62 is the peer's; 999 is the leak.
      const served = await gw.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(served.errors).toBeUndefined();
      expect((served.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);

      // Two-sided: the stranger's choice is not manufactured into a refusal either — "zzz" is
      // free, because a foreign record assigns nothing.
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
      // DELTA LEVEL: the strike really is in the ground and really does name the record.
      expect(gw.reactor.negationsOf(record.id)).toContain(strike.id);

      // NOTHING MOVES. Only the operator's own strike retires the operator's own record, so the
      // channel is still listed and still holds its prefix...
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");
      expect(gw.channelsEver(ch.name)).toHaveLength(1);

      // ...and the guard still refuses.
      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:friends:alice"',
      );

      // Two-sided: the operator's OWN strike does retire it — the filter reads authorship, not a
      // blanket refusal to see negations at all.
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
      // The operator re-points the pool at another parent. The container KEEPS its name — names
      // are permanent — so `inboxOf` no longer leads it and no derivation from the name can cut
      // the prefix out. The record still states it.
      await gw.append([
        signClaims(
          containerClaims(
            {
              container: ch.name,
              trust: "untrusted",
              posture: "separate",
              inboxOf: "other",
            },
            gw.operatorAuthor!,
            gw.nextTimestamp(),
          ),
          BOB_SEED,
        ),
      ]);
      // DELTA LEVEL: the re-declaration bound, so the derivation really has nothing to cut against.
      expect(
        readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(ch.name)?.inboxOf,
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
      // Re-point the pool one level up. Now BOTH readings resolve and they disagree: the record
      // says "alice", and cutting the name against "channel:ada:" yields "feed:alice". Only the
      // record was ever a choice a person made; the other is a derivation from a name.
      await gw.append([
        signClaims(
          containerClaims(
            { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "ada" },
            gw.operatorAuthor!,
            gw.nextTimestamp(),
          ),
          BOB_SEED,
        ),
      ]);
      expect(
        readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(ch.name)?.inboxOf,
      ).toBe("ada");
      expect(gw.channelStatus(ch.name)[0]!.prefix).toBe("alice");

      // The record's answer is the one the guard holds...
      const refusal = await refusalOf(
        gw.openChannel({ into: "elsewhere", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain(
        'collides with the prefix "alice" already assigned by "channel:ada:feed:alice"',
      );
      // ...and the derivation's answer is not — reading it first would re-open T215's phantom.
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
      // Neither half answers: no record names this pool, and its declaration marks a parent its
      // name was not built from, so nothing can cut the prefix out. Both readings failing at once
      // is the state openChannel never creates — and the guard must say so, not check the rest.
      const orphan = {
        container: "channel:ada:feed:alice",
        trust: "untrusted" as const,
        posture: "separate" as const,
      };
      await gw.append([
        signClaims(
          containerClaims({ ...orphan, inboxOf: "other" }, gw.operatorAuthor!, gw.nextTimestamp()),
          BOB_SEED,
        ),
      ]);
      const refusal = await refusalOf(
        gw.openChannel({ into: "inbox", prefix: "bob", source: quiet }),
      );
      expect(refusal).toContain("1 channel pool(s) whose assigned prefix it cannot name");
      // COUNTED, NOT NAMED. This refusal reaches every caller, and the MCP federation door is
      // fenced per container so a caller cannot learn which channels exist (§12/T78).
      expect(refusal).not.toContain("channel:ada:feed:alice");
      // "Nothing was created" is BOTH halves: the pool and the receiving container it would nest
      // under. Checking only the pool would leave the refusal free to move below the parent append.
      expect(declares(gw, "channel:inbox:bob")).toBe(false);
      expect(declares(gw, "inbox")).toBe(false);

      // Two-sided: the refusal is not permanent, and the repair it names works. Re-declare the pool
      // with an `inboxOf` that leads its name, and opens resume.
      await gw.append([
        signClaims(
          containerClaims(
            { ...orphan, inboxOf: "ada:feed" },
            gw.operatorAuthor!,
            gw.nextTimestamp(),
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
      // What openChannel leaves behind if it faults between its two appends: the pool declaration
      // stands and no channel record names it. The declaration's own `inboxOf` names the container
      // half, so the remainder is the prefix exactly — colons in the container and all.
      await gw.append([
        signClaims(
          containerClaims(
            {
              container: "channel:ada:feed:alice",
              trust: "untrusted",
              posture: "separate",
              inboxOf: "ada:feed",
            },
            gw.operatorAuthor!,
            gw.nextTimestamp(),
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

      // Two-sided: an unrelated prefix is still free, so the orphan is not a blanket refusal.
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
      // The mirror of the case above, and the one a sever produces if its two halves fail apart:
      // the pool's declaration goes and the record stays. Of the two mistakes available here,
      // reserving a prefix costs a rename; freeing one two channels answer to cannot be undone.
      for (const id of survivingDeclarationIds(gw.reactor, gw.operatorAuthor!, ch.name)) {
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
      // Two-sided: still not a blanket refusal.
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
      // The algebra the channel readings claim: forward only, and TRANSITIVE. A reading that stops
      // after two links agrees on the first two steps and disagrees on the third.
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
      // `into` is the operator's free choice and nothing bars a leading "channel:". The receiving
      // container it declares marks no parent and no record calls it a channel — so it assigns no
      // prefix, and a guard that read it as an unnameable pool would refuse every later open.
      const odd = await gw.openChannel({ into: "channel:foo", prefix: "x", source: quiet });
      expect(odd.name).toBe("channel:channel:foo:x");
      expect(declares(gw, "channel:foo")).toBe(true);

      const next = await gw.openChannel({ into: "friends", prefix: "y", source: quiet });
      expect(next.name).toBe("channel:friends:y");
      // And the pool nested under it is still a pool, with its own prefix guarded.
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
      // The same name, asked for under the other reading. Resuming on the name alone would
      // re-point the standing channel's parent and re-stamp its prefix, taking the namespace its
      // blessed law is served under with it.
      const refusal = await refusalOf(
        gw.openChannel({ into: "ada", prefix: "feed:alice", source: quiet }),
      );
      expect(refusal).toContain(
        'the pool "channel:ada:feed:alice" already belongs to the channel this store opened with ' +
          'the prefix "alice", and this call asks for "feed:alice"',
      );
      // The refusal has to teach the naming rule, or a person cannot tell why two reasonable
      // choices asked for one pool.
      expect(refusal).toContain('A pool is named "channel:<into>:<prefix>"');
      // DELTA LEVEL, two-sided: the standing channel is untouched and the parent was not re-pointed.
      expect(gw.channelStatus(feed.name)[0]!.prefix).toBe("alice");
      expect(
        readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(feed.name)?.inboxOf,
      ).toBe("ada:feed");
      expect(declares(gw, "ada")).toBe(false);

      // Two-sided: the SAME pair still resumes.
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
      // The state the OLD guard let through: it read `channel:ada:feed:alice`'s prefix as
      // "feed:alice", so a second channel took "alice" and both now answer at one field. Built here
      // at the delta level, because the fixed guard will not build it.
      await gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet });
      await gw.append([
        signClaims(
          containerClaims(
            {
              container: "channel:inbox:alice",
              trust: "untrusted",
              posture: "separate",
              inboxOf: "inbox",
            },
            gw.operatorAuthor!,
            gw.nextTimestamp(),
          ),
          BOB_SEED,
        ),
      ]);
      // DELTA LEVEL: both pools stand, and both name the prefix "alice" — one through its record,
      // one through its declaration.
      expect(declares(gw, "channel:ada:feed:alice")).toBe(true);
      expect(declares(gw, "channel:inbox:alice")).toBe(true);
      expect(gw.channelStatus("channel:ada:feed:alice")[0]!.prefix).toBe("alice");

      // Re-opening EITHER channel now refuses — and the advice is the repair a person can act on.
      const refusal = await refusalOf(
        gw.openChannel({ into: "ada:feed", prefix: "alice", source: quiet }),
      );
      expect(refusal).toContain("BOTH stand in this store");
      expect(refusal).toContain("channel:ada:feed:alice");
      expect(refusal).toContain("channel:inbox:alice");
      expect(refusal).toContain("loam federate drop");
      expect(refusal).not.toContain("Choose another prefix");

      // Two-sided: the repair works. Sever one and the other re-opens.
      await gw.dropChannel("channel:ada:feed:alice");
      const survivor = await gw.openChannel({ into: "inbox", prefix: "alice", source: quiet });
      expect(survivor.name).toBe("channel:inbox:alice");
    } finally {
      await gw.close();
    }
  });

  // DROPPED ON THE T217 REBASE: "a sever strikes this store's own records and leaves a peer's
  // deltas alone". The sever's author scope is T217's code now, and T217's own rail
  // (test/federation/channel-record-trust.test.ts, "a stranger's negation cannot make a sever leave
  // the channel standing") asserts exactly it — the struck operator record AND the untouched
  // stranger delta. My guard-side coverage of the same behaviour stays above: the strike-chain test
  // proves the transitive lawful-negation reading the guard depends on.
});
