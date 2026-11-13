import { beforeEach, describe, expect, it } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import { authorForSeed, verifyDelta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

const ME_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const BRAM_SEED = "b0".repeat(32);
const ALICE = authorForSeed(ALICE_SEED);

const CTX_ARRIVAL = "loam.arrival";
const CTX_CHANNEL = "loam.channel";

const pools = new Map<string, MemoryBackend>();
beforeEach(() => pools.clear());
const backendFor = (pool: string): MemoryBackend => {
  const held = pools.get(pool) ?? new MemoryBackend();
  pools.set(pool, held);
  return held;
};

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: backendFor },
  );
}

function peer(): { offering: Delta[]; source: { pull: () => Promise<Delta[]> } } {
  const offering: Delta[] = [];
  return { offering, source: { pull: () => Promise.resolve([...offering]) } };
}

interface Stamp {
  readonly deltaId: string;
  readonly channel: string;
  readonly from: string;
  readonly author: string;
  readonly at: number;
  readonly arrived: string[];
}

function stampsIn(pool: Gateway): Stamp[] {
  const out: Stamp[] = [];
  for (const d of pool.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (pool.reactor.negationsOf(d.id).some((n) => pool.reactor.negationsOf(n).length === 0)) {
      continue;
    }
    const from = d.claims.pointers.find((p) => p.role === "from");
    const arrived: string[] = [];
    for (const p of d.claims.pointers) {
      if (p.target.kind === "delta") arrived.push(p.target.deltaRef.delta);
    }
    out.push({
      deltaId: d.id,
      channel: marker.target.entity.id.startsWith("channel:")
        ? marker.target.entity.id.slice("channel:".length)
        : marker.target.entity.id,
      from: from?.target.kind === "primitive" ? String(from.target.value) : "",
      author: d.claims.author,
      at: d.claims.timestamp,
      arrived,
    });
  }
  return out;
}

const refsOf = (stamps: readonly Stamp[]): string[] => stamps.flatMap((s) => s.arrived);
const countOf = (refs: readonly string[], id: string): number =>
  refs.filter((r) => r === id).length;

interface Record {
  readonly deltaId: string;
  readonly at: number;
  readonly unattested: string[];
}

function channelRecords(gw: Gateway): Record[] {
  const out: Record[] = [];
  for (const d of gw.reactor.snapshot()) {
    if (d.claims.author !== gw.operator) continue;
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    );
    if (marker === undefined) continue;
    const unattested: string[] = [];
    for (const p of d.claims.pointers) {
      if (p.role === "unattested" && p.target.kind === "primitive") {
        unattested.push(String(p.target.value));
      }
    }
    out.push({ deltaId: d.id, at: d.claims.timestamp, unattested });
  }
  return out;
}

function added(before: readonly Record[], after: readonly Record[]): Record[] {
  const seen = new Set(before.map((r) => r.deltaId));
  return after.filter((r) => !seen.has(r.deltaId));
}

const liveRecords = (gw: Gateway, name: string): string[] =>
  [...gw.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.author === gw.operator &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.context === CTX_CHANNEL &&
            p.target.entity.id === `channel:${name}`,
        ) &&
        gw.reactor.negationsOf(d.id).length === 0,
    )
    .map((d) => d.id);

const isStamp = (d: Delta): boolean =>
  d.claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
  );

function crashAfterArrivalsLand(
  pool: Gateway,
  receiver: string,
): { seen: { hits: number }; restore: () => void } {
  const real = pool.federate.bind(pool);
  const seen = { hits: 0 };
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    const isPeerBatch = all.some((d) => d.claims.author !== receiver && !isStamp(d));
    const landed = await real(all, opts);
    if (isPeerBatch && seen.hits === 0) {
      seen.hits += 1;
      throw new Error("simulated crash: the process died after federate landed the arrivals");
    }
    return landed;
  };
  return { seen, restore: () => (pool.federate = real) };
}

function crashBeforeIngest(
  pool: Gateway,
  receiver: string,
): { seen: { hits: number }; restore: () => void } {
  const real = pool.federate.bind(pool);
  const seen = { hits: 0 };
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    const isPeerBatch = all.some((d) => d.claims.author !== receiver && !isStamp(d));
    if (isPeerBatch && seen.hits === 0) {
      seen.hits += 1;
      throw new Error("simulated crash: the process died after journaling, before federate");
    }
    return real(all, opts);
  };
  return { seen, restore: () => (pool.federate = real) };
}

function failStampsOnce(pool: Gateway): { restore: () => void } {
  const real = pool.federate.bind(pool);
  let fired = false;
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    if (!fired && all.length > 0 && all.every(isStamp)) {
      fired = true;
      throw new Error("simulated stamp-door failure");
    }
    return real(all, opts);
  };
  return { restore: () => (pool.federate = real) };
}

describe("T222 — a crash between federate and attest heals or names its own gap", () => {
  it("(a) a crash after arrivals land is healed on the next sync, and a clean bystander is not re-stamped", async () => {
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const pool = gatewayOf(channel.pool);

      const x = observed(FERN, "height", 10, 1000, ALICE_SEED);
      offering.push(x);
      const clean = await channel.sync();
      expect(clean.accepted).toBe(1);
      const afterClean = stampsIn(pool);
      expect(refsOf(afterClean)).toEqual([x.id]);
      const cleanSyncedAt = me.channelStatus(channel.name)[0]!.lastSyncedAt;
      expect(cleanSyncedAt).toBeGreaterThan(0);

      const y = observed(FERN, "height", 20, 2000, ALICE_SEED);
      offering.push(y);
      const crash = crashAfterArrivalsLand(pool, pool.operatorAuthor!);
      await expect(channel.sync()).rejects.toThrow(/simulated crash/);
      expect(crash.seen.hits).toBe(1);
      crash.restore();

      expect(pool.reactor.get(y.id)).toBeDefined();
      expect(refsOf(stampsIn(pool))).toEqual([x.id]);
      const crashed = me.channelStatus(channel.name)[0]!;
      expect(crashed.unattested).toContain(y.id);
      expect(crashed.unattested).not.toContain(x.id);
      expect(crashed.consecutiveFailures).toBe(0);
      expect(crashed.lastSyncedAt).toBe(cleanSyncedAt);

      const heal = await channel.sync();
      expect(heal.accepted).toBe(0);

      const healed = stampsIn(pool);
      const refs = refsOf(healed);
      expect(countOf(refs, y.id)).toBe(1);
      expect(countOf(refs, x.id)).toBe(1);
      expect(new Set(refs).size).toBe(refs.length);
      const yStamp = healed.find((s) => s.arrived.includes(y.id))!;
      expect(yStamp.channel).toBe(channel.name);
      expect(yStamp.from).toBe("https://alice.example/loam");
      expect(yStamp.author).toBe(pool.operatorAuthor);
      expect(yStamp.author).not.toBe(ALICE);
      expect(verifyDelta(pool.reactor.get(yStamp.deltaId)!)).toBe("verified");

      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(cleanSyncedAt);
    } finally {
      await me.close();
    }
  });

  it("(a2) the optimistic debt UNIONS with a reported failure's debt, and both heal together", async () => {
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const pool = gatewayOf(channel.pool);

      const a = observed(FERN, "height", 30, 1000, ALICE_SEED);
      const b = observed(FERN, "height", 31, 1001, ALICE_SEED);
      offering.push(a, b);
      const fail = failStampsOnce(pool);
      await expect(channel.sync()).rejects.toThrow();
      fail.restore();
      const reported = me.channelStatus(channel.name)[0]!;
      expect(reported.consecutiveFailures).toBe(1);
      expect([...reported.unattested].sort()).toEqual([a.id, b.id].sort());
      expect(stampsIn(pool)).toEqual([]);
      expect(pool.reactor.get(a.id)).toBeDefined();
      expect(pool.reactor.get(b.id)).toBeDefined();

      const z = observed(FERN, "height", 32, 2000, ALICE_SEED);
      offering.push(z);
      const crash = crashAfterArrivalsLand(pool, pool.operatorAuthor!);
      await expect(channel.sync()).rejects.toThrow(/simulated crash/);
      expect(crash.seen.hits).toBe(1);
      crash.restore();

      const crashed = me.channelStatus(channel.name)[0]!;
      expect([...crashed.unattested].sort()).toEqual([a.id, b.id, z.id].sort());

      const heal = await channel.sync();
      expect(heal.accepted).toBe(0);
      const refs = refsOf(stampsIn(pool));
      expect(new Set(refs)).toEqual(new Set([a.id, b.id, z.id]));
      expect(new Set(refs).size).toBe(refs.length);
      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(0);
    } finally {
      await me.close();
    }
  });

  it("(b) anti-soup: a quiet sync writes NOTHING, an accepting sync writes exactly two records", async () => {
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const x = observed(FERN, "height", 40, 1000, ALICE_SEED);
      offering.push(x);

      const beforeAccept = channelRecords(me);
      const accept = await channel.sync();
      expect(accept.accepted).toBe(1);
      const addedAccept = added(beforeAccept, channelRecords(me));
      expect(addedAccept.length).toBe(2);
      const journals = addedAccept.filter((r) => r.unattested.length > 0);
      const cleared = addedAccept.filter((r) => r.unattested.length === 0);
      expect(journals.length).toBe(1);
      expect(cleared.length).toBe(1);
      expect(journals[0]!.unattested).toEqual([x.id]);
      expect(me.channelStatus(channel.name)[0]!.unattested).toEqual([]);

      const beforeQuiet = channelRecords(me);
      const quiet = await channel.sync();
      expect(quiet.accepted).toBe(0);
      const addedQuiet = added(beforeQuiet, channelRecords(me));
      expect(addedQuiet).toEqual([]);

      const beforeThird = channelRecords(me);
      await channel.sync();
      const addedThird = added(beforeThird, channelRecords(me));
      expect(addedThird).toEqual([]);
    } finally {
      await me.close();
    }
  });

  it("(a3) the journal refuses to resurrect a severed channel [T233 intersection]", async () => {
    const me = await store(ME_SEED);
    try {
      const live = peer();
      const bram = await me.openChannel({
        into: "friends",
        prefix: "bram",
        from: "https://bram.example/loam",
        source: live.source,
      });
      live.offering.push(observed(FERN, "height", 1, 500, BRAM_SEED));
      await bram.sync();
      expect(me.channelStatus("channel:friends:bram")).toHaveLength(1);

      const target = peer();
      const alice = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: target.source,
      });
      target.offering.push(observed(FERN, "height", 10, 1000, ALICE_SEED));
      await alice.sync();
      expect(me.channelStatus("channel:friends:alice")).toHaveLength(1);

      await me.dropChannel("channel:friends:alice");
      expect(liveRecords(me, "channel:friends:alice")).toEqual([]);
      expect(me.channelStatus("channel:friends:alice")).toHaveLength(0);
      expect(me.channelsEver("channel:friends:alice")).toHaveLength(1);

      target.offering.push(observed(FERN, "height", 20, 2000, ALICE_SEED));
      await expect(alice.sync()).rejects.toThrow(/severed/);

      expect(liveRecords(me, "channel:friends:alice")).toEqual([]);
      expect(me.channelStatus("channel:friends:alice")).toHaveLength(0);
      expect(me.channelsEver("channel:friends:alice")).toHaveLength(1);

      live.offering.push(observed(FERN, "height", 2, 600, BRAM_SEED));
      const bramBefore = channelRecords(me).length;
      const bramSync = await bram.sync();
      expect(bramSync.accepted).toBe(1);
      expect(me.channelStatus("channel:friends:bram")).toHaveLength(1);
      expect(channelRecords(me).length).toBe(bramBefore + 2);
    } finally {
      await me.close();
    }
  });

  it("(b2) a crash BETWEEN the journal and federate self-corrects, and a gone delta never stamps", async () => {
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const pool = gatewayOf(channel.pool);

      const w = observed(FERN, "height", 50, 1000, ALICE_SEED);
      const v = observed(FERN, "height", 51, 1001, ALICE_SEED);
      offering.push(w, v);
      const crash = crashBeforeIngest(pool, pool.operatorAuthor!);
      await expect(channel.sync()).rejects.toThrow(/before federate/);
      expect(crash.seen.hits).toBe(1);
      crash.restore();

      expect(pool.reactor.get(w.id)).toBeUndefined();
      expect(pool.reactor.get(v.id)).toBeUndefined();
      expect(stampsIn(pool)).toEqual([]);
      const crashed = me.channelStatus(channel.name)[0]!;
      expect([...crashed.unattested].sort()).toEqual([w.id, v.id].sort());

      offering.length = 0;
      offering.push(w);
      const heal = await channel.sync();
      expect(heal.accepted).toBe(1);

      expect(pool.reactor.get(w.id)).toBeDefined();
      expect(pool.reactor.get(v.id)).toBeUndefined();
      const refs = refsOf(stampsIn(pool));
      expect(countOf(refs, w.id)).toBe(1);
      expect(refs).not.toContain(v.id);
      expect(new Set(refs).size).toBe(refs.length);
      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(0);
    } finally {
      await me.close();
    }
  });
});
