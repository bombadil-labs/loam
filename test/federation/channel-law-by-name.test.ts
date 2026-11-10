// Two channel readers that know the channel's name read the target index at `channel:<name>`, never
// a walk of the store (H8): `cursesOf`, and the record strike at the end of `dropChannel`.
//
// COST: `cursesOf` opens no whole-store door (`snapshot`, `arrivalLog`) and makes the same reactor
// accesses with 0 and with 1000 unrelated facts. `dropChannel` walks the store for other reasons
// (the lifecycle read, the surface refold), so its case counts walks: the record strike adds none.
//
// ANSWER cases are CONTROLS: they pass over a whole-store walk too, because the index read must
// select exactly what the walk selected. Each holds the result at the reader, at the deltas, and
// at a door (`def`, `channelStatus`), with a live bystander beside every struck or ignored record.
// The ORDER cases hold the readers to oldest-first by signed time; over the index's id order they
// fail unless the ids happen to sort that way.
//
// Erasure standing rule: every store here is this file's own MemoryBackend fixture.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { withStamp } from "../../src/gateway/stamp.js";
import {
  CTX_CHANNEL,
  CTX_CURSE,
  channelRecordClaims,
  cursesOf,
  type Channel,
} from "../../src/federation/channel.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "17".repeat(32);
const OP = authorForSeed(SEED);
const STRANGER_SEED = "b0".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const SPROUT = { ...PLANT, name: "Sprout" };
const UNRELATED = 1000;

const homes: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (homes.length > 0) await homes.pop()!.close();
});

async function store(seed: string): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  return gw;
}
// The operator's store with a write grant to the stranger, and one channel per prefix to a peer
// that serves Plant and Sprout.
async function world(...prefixes: string[]): Promise<{ me: Gateway; channels: Channel[] }> {
  const peer = await store("a1".repeat(32));
  await peer.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, "hyperschema:Plant");
  await peer.publishRegistration(SPROUT, PLANT_POLICY, [FERN], undefined, "hyperschema:Sprout");
  const me = await store(SEED);
  await me.append([
    signClaims(
      withStamp(me.stamp(OP), (t) => grantClaims(STORE_ENTITY, STRANGER, "write", OP, t)),
      SEED,
    ),
  ]);
  const channels: Channel[] = [];
  for (const prefix of prefixes) {
    const ch = await me.openChannel({
      into: "friends",
      prefix,
      source: { pull: () => Promise.resolve(peer.reactor.arrivalLog()) },
    });
    await ch.sync();
    channels.push(ch);
  }
  return { me, channels };
}
const bystanders = (gw: Gateway, count: number) =>
  count === 0
    ? Promise.resolve()
    : gw.append(
        Array.from({ length: count }, (_, n) =>
          observed(`plant:other-${n}`, "height", n, 1000 + n, SEED),
        ),
      );
// A curse-shaped record: its pointers in the curse context name `channels`, in that order.
const curseRecord = (gw: Gateway, seed: string, living: string, ...channels: string[]): Delta =>
  signClaims(
    {
      ...gw.stamp(authorForSeed(seed)),
      author: authorForSeed(seed),
      pointers: [
        ...channels.map((channel) => ({
          role: "curse",
          target: {
            kind: "entity" as const,
            entity: { id: `channel:${channel}`, context: CTX_CURSE },
          },
        })),
        { role: "living", target: { kind: "primitive" as const, value: living } },
      ],
    },
    seed,
  );
const negationBy = (gw: Gateway, seed: string, id: string): Delta =>
  signClaims(
    withStamp(gw.stamp(authorForSeed(seed)), (t) => makeNegationClaims(authorForSeed(seed), t, id)),
    seed,
  );
// The records filed at a channel's entity in the channel context, whoever signed them.
const recordsAt = (gw: Gateway, name: string): Delta[] =>
  gw.reactor
    .byTarget(`channel:${name}`)
    .map((id) => gw.reactor.get(id)!)
    .filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
      ),
    );
const serves = (gw: Gateway, lens: string): boolean => {
  try {
    return gw.def(lens) !== undefined;
  } catch {
    return false;
  }
};

const ACCESSES = [
  "get",
  "targets",
  "negators",
  "byTarget",
  "negationsOf",
  "snapshot",
  "arrivalLog",
] as const;
type Accesses = Record<(typeof ACCESSES)[number], number>;
async function accesses(gw: Gateway, read: () => unknown): Promise<Accesses> {
  const spies = ACCESSES.map((m) => [m, vi.spyOn(gw.reactor, m)] as const);
  await read();
  const counts = Object.fromEntries(spies.map(([m, s]) => [m, s.mock.calls.length]));
  vi.restoreAllMocks();
  return counts as Accesses;
}

describe("COST: a channel's records are read at the channel's entity", () => {
  it("cursesOf opens no whole-store door, the same with 0 and with 1000 unrelated facts", async () => {
    const out: Accesses[] = [];
    for (const count of [0, UNRELATED]) {
      const { me, channels } = await world("alice");
      await me.curseChannelLaw(channels[0]!.name, "alice:Plant");
      await bystanders(me, count);
      out.push(
        await accesses(me, () =>
          expect(cursesOf(me, channels[0]!.name).map((c) => c.living)).toEqual(["alice:Plant"]),
        ),
      );
    }
    expect(out[0]!.snapshot).toBe(0);
    expect(out[0]!.arrivalLog).toBe(0);
    expect(out[0]!.byTarget).toBe(1);
    expect(out[1]).toEqual(out[0]);
  }, 120_000);

  // Seven walks belong to the rest of the drop: the lifecycle read, the channel reader and the
  // surface refold. The bound may fall as those move to an index; it must not rise.
  it("dropChannel walks the store no more with its record strike, and no more with 1000 unrelated facts", async () => {
    const out: Accesses[] = [];
    for (const count of [0, UNRELATED]) {
      const { me, channels } = await world("alice", "bob");
      await bystanders(me, count);
      out.push(await accesses(me, () => me.dropChannel(channels[0]!.name)));
      expect(me.channelStatus(channels[0]!.name)).toEqual([]);
    }
    expect(out[0]!.snapshot).toBeLessThanOrEqual(7);
    expect(out[0]!.byTarget).toBeGreaterThan(0);
    expect(out[1]).toEqual(out[0]);
  }, 120_000);
});

describe("ANSWER (controls: these pass over a whole-store walk too)", () => {
  it("cursesOf: a lifted curse leaves, its bystander stays, and a stranger's record or strike changes nothing", async () => {
    const { me, channels } = await world("alice", "bob");
    const [alice, bob] = channels.map((c) => c.name) as [string, string];
    await me.curseChannelLaw(alice, "alice:Plant");
    await me.curseChannelLaw(alice, "alice:Sprout");
    const curses = cursesOf(me, alice);
    expect(curses.map((c) => c.living)).toEqual(["alice:Plant", "alice:Sprout"]);
    expect(cursesOf(me, bob)).toEqual([]);
    expect([serves(me, "alice:Plant"), serves(me, "bob:Plant")]).toEqual([false, true]);

    const theirs = curseRecord(me, STRANGER_SEED, "bob:Plant", bob);
    const lift = negationBy(me, STRANGER_SEED, curses[1]!.deltaId);
    // The first curse pointer keys the record, so this one is the other channel's, not bob's.
    const elsewhere = curseRecord(me, SEED, "bob:Sprout", "nobody", bob);
    await me.append([theirs, lift, elsewhere]);
    // Delta level: all three are held, two of them at bob's entity.
    expect(me.reactor.byTarget(`channel:${bob}`)).toEqual(
      expect.arrayContaining([theirs.id, elsewhere.id]),
    );
    expect(me.reactor.negationsOf(curses[1]!.deltaId)).toEqual([lift.id]);
    expect(cursesOf(me, bob)).toEqual([]);
    expect(cursesOf(me, alice)).toEqual(curses);

    await me.curseChannelLaw(alice, "alice:Plant", { lift: true });
    expect(cursesOf(me, alice)).toEqual([curses[1]]);
    await channels[0]!.sync();
    expect([serves(me, "alice:Plant"), serves(me, "alice:Sprout")]).toEqual([true, false]);
  });

  it("cursesOf answers oldest first by signed time", async () => {
    const { me, channels } = await world("alice");
    const name = channels[0]!.name;
    const written: string[] = [];
    for (let n = 0; n < 6; n++) {
      const record = curseRecord(me, SEED, `alice:Lens${n}`, name);
      await me.append([record]);
      written.push(record.id);
    }
    expect(cursesOf(me, name).map((c) => c.deltaId)).toEqual(written);
  });

  it("dropChannel strikes each of the channel's own records once, oldest first, and no other record", async () => {
    const { me, channels } = await world("alice", "bob");
    const [alice, bob] = channels.map((c) => c.name) as [string, string];
    const status = me.channelStatus(alice)[0]!;
    const later = signClaims(
      { ...channelRecordClaims(status, OP, me.nextTimestamp(OP)), validFrom: Date.now() + 1e9 },
      SEED,
    );
    const theirs = signClaims(
      channelRecordClaims(status, STRANGER, me.nextTimestamp(STRANGER)),
      STRANGER_SEED,
    );
    // Filed first at another channel: bob's record that also points at alice's entity.
    const base = channelRecordClaims(me.channelStatus(bob)[0]!, OP, me.nextTimestamp(OP));
    const elsewhere = signClaims(
      {
        ...base,
        pointers: [
          ...base.pointers,
          {
            role: "channel",
            target: { kind: "entity", entity: { id: `channel:${alice}`, context: CTX_CHANNEL } },
          },
        ],
      },
      SEED,
    );
    await me.append([later, theirs, elsewhere]);
    // More of the channel's own records, each signed above the last, so the strike order shows.
    for (let n = 0; n < 5; n++) {
      await me.append([signClaims(channelRecordClaims(status, OP, me.nextTimestamp(OP)), SEED)]);
    }
    const severed = recordsAt(me, alice).find(
      (d) => d.claims.author === OP && ![later.id, elsewhere.id].includes(d.id),
    )!;
    const already = negationBy(me, SEED, severed.id);
    await me.append([already]);
    const own = recordsAt(me, alice)
      .filter((d) => d.claims.author === OP && d.id !== elsewhere.id)
      .sort((a, b) => a.claims.timestamp - b.claims.timestamp);
    expect(own.length).toBeGreaterThanOrEqual(8);
    expect(own).toContainEqual(later);

    const before = me.reactor.arrivalLog().length;
    await me.dropChannel(alice);

    // Delta level: one operator strike per record of the channel, the earlier strike reused.
    for (const d of own) expect(me.reactor.negationsOf(d.id), d.id).toHaveLength(1);
    expect(me.reactor.negationsOf(severed.id)).toEqual([already.id]);
    expect(me.reactor.negationsOf(theirs.id)).toEqual([]);
    expect(me.reactor.negationsOf(elsewhere.id)).toEqual([]);
    for (const d of recordsAt(me, bob)) expect(me.reactor.negationsOf(d.id)).toEqual([]);
    const struck = me.reactor
      .arrivalLog()
      .slice(before)
      .flatMap((d) =>
        d.claims.author !== OP
          ? []
          : d.claims.pointers.flatMap((p) =>
              p.role === "negates" && p.target.kind === "delta" ? [p.target.deltaRef.delta] : [],
            ),
      )
      .filter((id) => own.some((d) => d.id === id));
    expect(struck).toEqual(own.filter((d) => d.id !== severed.id).map((d) => d.id));
    // Door level: the dropped channel is gone from the standing list; the bystander channel
    // stands and still serves.
    expect(me.channelStatus(alice)).toEqual([]);
    expect(me.channelsEver(alice).length).toBeGreaterThan(0);
    expect(me.channelStatus(bob)).toHaveLength(1);
    expect([serves(me, "alice:Plant"), serves(me, "bob:Plant")]).toEqual([false, true]);
  });
});
