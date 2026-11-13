import { beforeEach, describe, expect, it } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import { verifyDelta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway, type FederationReport } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

const ME_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);

const CTX_ARRIVAL = "loam.arrival";
const FAN = 256;

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
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

interface Stamp {
  readonly deltaId: string;
  readonly author: string;
  readonly channel: string;
  readonly from: string;
  readonly at: number;
  readonly arrived: string[];
}

function stampsIn(pool: Gateway, asOf?: number): Stamp[] {
  const out: Stamp[] = [];
  for (const d of pool.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (asOf !== undefined && d.claims.timestamp > asOf) continue;
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
      author: d.claims.author,
      channel: marker.target.entity.id.startsWith("channel:")
        ? marker.target.entity.id.slice("channel:".length)
        : marker.target.entity.id,
      from: from?.target.kind === "primitive" ? String(from.target.value) : "",
      at: d.claims.timestamp,
      arrived,
    });
  }
  return out;
}

const refsOf = (stamps: readonly Stamp[]): string[] => stamps.flatMap((s) => s.arrived);

function bendReport(pool: Gateway, bend: (r: FederationReport) => FederationReport): void {
  const real = pool.federate.bind(pool);
  pool.federate = async (deltas, opts) => bend(await real(deltas, opts));
}

function swallowLastStamp(pool: Gateway): { hits: number } {
  const real = pool.federate.bind(pool);
  const seen = { hits: 0 };
  const isStamp = (d: Delta): boolean =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
    );
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    if (all.length < 2 || !all.every(isStamp)) return real(all, opts);
    seen.hits += 1;
    return real(all.slice(0, -1), opts);
  };
  return seen;
}

function bindingIdsIn(pool: Gateway): string[] {
  const out: string[] = [];
  for (const d of pool.reactor.snapshot()) {
    const registers = d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.id.startsWith("registration:"),
    );
    if (registers && pool.reactor.negationsOf(d.id).length === 0) out.push(d.id);
  }
  return out.sort();
}

describe("T207 — a sync that accepts deltas stamps its own custody", () => {
  it("(a) attests ceil(N/256) times, naming the channel, the peer address, and every accepted delta", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = Array.from({ length: 300 }, (_, i) =>
        observed(FERN, "height", i, 1000 + i, ALICE_SEED),
      );
      await alice.append(planted);

      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const report = await channel.sync();
      expect(report.accepted).toBeGreaterThan(FAN);

      const pool = gatewayOf(channel.pool);
      const stamps = stampsIn(pool);

      expect(stamps.length).toBe(Math.ceil(report.accepted / FAN));
      expect(new Set(stamps.map((s) => s.at)).size).toBe(1);
      for (const s of stamps) {
        expect(s.arrived.length).toBeGreaterThan(0);
        expect(s.arrived.length).toBeLessThanOrEqual(FAN);
        expect(s.channel).toBe(channel.name);
        expect(s.from).toBe("https://alice.example/loam");
        expect(s.at).toBeGreaterThan(0);
        expect(s.author).toBe(pool.operatorAuthor);
        expect(s.author).not.toBe(alice.operator);
        expect(verifyDelta(pool.reactor.get(s.deltaId)!)).toBe("verified");
      }

      const refs = refsOf(stamps);
      expect(refs.length).toBe(report.accepted);
      expect(new Set(refs).size).toBe(report.accepted);
      for (const id of refs) expect(pool.reactor.get(id)).toBeDefined();
      const named = new Set(refs);
      for (const d of planted) expect(named.has(d.id)).toBe(true);

      const gathered = new Set(me.containerScope({ containers: ["friends"] }).map((d) => d.id));
      for (const s of stamps) expect(gathered.has(s.deltaId)).toBe(true);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("(b) a sync that accepts nothing attests nothing, while the sync before it did", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);

      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const first = await channel.sync();
      expect(first.accepted).toBeGreaterThan(0);
      const pool = gatewayOf(channel.pool);
      const after1 = stampsIn(pool)
        .map((s) => s.deltaId)
        .sort();
      expect(after1.length).toBeGreaterThan(0);

      const second = await channel.sync();
      expect(second.accepted).toBe(0);
      const after2 = stampsIn(pool)
        .map((s) => s.deltaId)
        .sort();
      expect(after2).toEqual(after1);

      await channel.sync();
      expect(
        stampsIn(pool)
          .map((s) => s.deltaId)
          .sort(),
      ).toEqual(after1);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("(c) dropping a channel purges its attestations, and a bystander's survive at the bytes", async () => {
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      await bob.append([observed(FERN, "height", 71, 2000, BOB_SEED)]);

      const one = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const two = await me.openChannel({
        into: "friends",
        prefix: "bob",
        from: "https://bob.example/loam",
        source: feed(bob),
      });
      await one.sync();
      await two.sync();

      const aliceStamps = stampsIn(gatewayOf(one.pool));
      const bobPool = gatewayOf(two.pool);
      const bobStamps = stampsIn(bobPool);
      expect(aliceStamps.length).toBeGreaterThan(0);
      expect(bobStamps.length).toBeGreaterThan(0);

      const aliceBytes = pools.get(one.name)!;
      const bobBytes = pools.get(two.name)!;
      for (const s of aliceStamps) expect(await aliceBytes.holds(s.deltaId)).toBe(true);
      for (const s of bobStamps) expect(await bobBytes.holds(s.deltaId)).toBe(true);

      await me.dropChannel(one.name);

      const gathered = new Set(me.containerScope({ containers: ["friends"] }).map((d) => d.id));
      for (const s of aliceStamps) expect(gathered.has(s.deltaId)).toBe(false);

      for (const s of bobStamps) expect(await bobBytes.holds(s.deltaId)).toBe(true);
      const survivors = stampsIn(bobPool)
        .map((s) => s.deltaId)
        .sort();
      expect(survivors).toEqual(bobStamps.map((s) => s.deltaId).sort());
      for (const s of bobStamps) expect(gathered.has(s.deltaId)).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("(d) an attestation never binds as law and never re-exports as a blessing", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const first = await channel.sync();
      expect(first.bound).toContain("alice:Plant");

      const pool = gatewayOf(channel.pool);
      const stamps = stampsIn(pool);
      expect(stamps.length).toBeGreaterThan(0);
      const bindings = bindingIdsIn(pool);

      const second = await channel.sync();
      expect(second.bound).toEqual([]);
      expect(bindingIdsIn(pool)).toEqual(bindings);
      const third = await channel.sync();
      expect(third.bound).toEqual([]);
      expect(bindingIdsIn(pool)).toEqual(bindings);

      for (const name of me.materializationNames()) {
        expect(name.startsWith("alice:alice:")).toBe(false);
      }
      const stampIds = new Set(stamps.map((s) => s.deltaId));
      let aliasRows = 0;
      for (const d of pool.reactor.snapshot()) {
        const alias = d.claims.pointers.find((p) => p.role === "alias");
        if (alias?.target.kind !== "primitive") continue;
        aliasRows += 1;
        expect(stampIds.has(String(alias.target.value))).toBe(false);
      }
      expect(aliasRows).toBeGreaterThan(0);
      for (const s of stamps) expect(s.author).toBe(pool.operatorAuthor);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("(e) an as-of read between two syncs sees only the first sync's attestations", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const early = observed(FERN, "height", 62, 1000, ALICE_SEED);
      await alice.append([early]);

      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const first = await channel.sync();
      expect(first.accepted).toBeGreaterThan(0);
      const pool = gatewayOf(channel.pool);
      const stampsAfterFirst = stampsIn(pool);
      expect(stampsAfterFirst.length).toBeGreaterThan(0);
      const between = Math.max(...stampsAfterFirst.map((s) => s.at));

      const late = observed(FERN, "height", 71, 2000, ALICE_SEED);
      await alice.append([late]);
      const second = await channel.sync();
      expect(second.accepted).toBeGreaterThan(0);

      const now = stampsIn(pool);
      expect(now.length).toBeGreaterThan(stampsAfterFirst.length);
      expect(
        Math.min(
          ...now
            .filter((s) => !stampsAfterFirst.some((f) => f.deltaId === s.deltaId))
            .map((s) => s.at),
        ),
      ).toBeGreaterThan(between);

      const past = stampsIn(pool, between);
      expect(past.map((s) => s.deltaId).sort()).toEqual(
        stampsAfterFirst.map((s) => s.deltaId).sort(),
      );
      const pastRefs = new Set(refsOf(past));
      expect(pastRefs.has(early.id)).toBe(true);
      expect(pastRefs.has(late.id)).toBe(false);
      expect(new Set(refsOf(now)).has(late.id)).toBe(true);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("refuses to stamp a custody it cannot point at when the door names fewer ids than it counted", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = observed(FERN, "height", 62, 1000, ALICE_SEED);
      await alice.append([planted]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const pool = gatewayOf(channel.pool);
      bendReport(pool, (r) =>
        r.acceptedIds !== undefined && r.acceptedIds.length > 0
          ? { ...r, acceptedIds: r.acceptedIds.slice(1) }
          : r,
      );

      await expect(channel.sync()).rejects.toThrow(/could not record the arrival/);
      expect(pool.reactor.get(planted.id)).toBeDefined();
      expect(stampsIn(pool)).toEqual([]);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("records what a partial landing left unstamped, and heals it on the next sync", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = Array.from({ length: 300 }, (_, i) =>
        observed(FERN, "height", i, 1000 + i, ALICE_SEED),
      );
      await alice.append(planted);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const pool = gatewayOf(channel.pool);
      const swallowed = swallowLastStamp(pool);

      await expect(channel.sync()).rejects.toThrow(/took 1 of 2 attestation\(s\)/);
      expect(swallowed.hits).toBe(1);

      const standing = stampsIn(pool);
      expect(standing.length).toBe(1);
      expect(standing[0]!.arrived.length).toBe(FAN);
      const named = new Set(refsOf(standing));

      const failed = me.channelStatus(channel.name)[0]!;
      expect(failed.consecutiveFailures).toBe(1);
      expect(failed.lastSyncedAt).toBe(0);
      expect(failed.unattested.length).toBeGreaterThan(0);
      expect(failed.unattested.length).toBeLessThanOrEqual(FAN);
      for (const id of failed.unattested) expect(named.has(id)).toBe(false);
      for (const d of planted) {
        expect(named.has(d.id) || failed.unattested.includes(d.id)).toBe(true);
      }

      const second = await channel.sync();
      expect(second.accepted).toBe(0);
      const after = stampsIn(pool);
      expect(after.length).toBe(2);
      const healed = after.filter((s) => s.deltaId !== standing[0]!.deltaId);
      expect(healed.length).toBe(1);
      expect(healed[0]!.arrived.slice().sort()).toEqual([...failed.unattested].sort());
      expect(healed[0]!.channel).toBe(channel.name);
      expect(healed[0]!.from).toBe("https://alice.example/loam");
      expect(healed[0]!.author).toBe(pool.operatorAuthor);
      expect(verifyDelta(pool.reactor.get(healed[0]!.deltaId)!)).toBe("verified");

      const refs = refsOf(after);
      expect(new Set(refs).size).toBe(refs.length);
      const all = new Set(refs);
      for (const d of planted) expect(all.has(d.id)).toBe(true);

      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(0);
    } finally {
      await alice.close();
      await me.close();
    }
  }, 60_000);

  it("a quiet poll against a door that will not name its arrivals does not refuse", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const pool = gatewayOf(channel.pool);
      const first = await channel.sync();
      expect(first.accepted).toBeGreaterThan(0);
      const synced = me.channelStatus(channel.name)[0]!.lastSyncedAt;
      expect(synced).toBeGreaterThan(0);
      const stamped = stampsIn(pool)
        .map((s) => s.deltaId)
        .sort();
      expect(stamped.length).toBeGreaterThan(0);

      bendReport(pool, (r) => ({
        offered: r.offered,
        accepted: r.accepted,
        rejected: r.rejected,
        held: r.held,
      }));

      const quiet = await channel.sync();
      expect(quiet.accepted).toBe(0);
      expect(
        stampsIn(pool)
          .map((s) => s.deltaId)
          .sort(),
      ).toEqual(stamped);
      const after = me.channelStatus(channel.name)[0]!;
      expect(after.consecutiveFailures).toBe(0);
      expect(after.unattested).toEqual([]);
      expect(after.lastSyncedAt).toBe(synced);

      await alice.append([observed(FERN, "height", 71, 2000, ALICE_SEED)]);
      await expect(channel.sync()).rejects.toThrow(/named 0 of them/);
      const broken = me.channelStatus(channel.name)[0]!;
      expect(broken.consecutiveFailures).toBe(1);
      expect(broken.lastSyncedAt).toBe(after.lastSyncedAt);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("refuses, and says none were named, when the door names no ids at all", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = observed(FERN, "height", 62, 1000, ALICE_SEED);
      await alice.append([planted]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const pool = gatewayOf(channel.pool);
      bendReport(pool, (r) => ({
        offered: r.offered,
        accepted: r.accepted,
        rejected: r.rejected,
        held: r.held,
      }));

      await expect(channel.sync()).rejects.toThrow(/named 0 of them/);
      expect(pool.reactor.get(planted.id)).toBeDefined();
      expect(stampsIn(pool)).toEqual([]);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
