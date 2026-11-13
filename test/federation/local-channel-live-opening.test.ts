import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type DurableOrdinaryJournalStore,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, survivingDeclarationIds } from "../../src/gateway/container-law.js";
import { readErasures } from "../../src/gateway/erase-law.js";
import { admitLocal, openHostPeer } from "../../src/gateway/peer-admission.js";
import {
  LOCAL_EVENT,
  localChannelEvidence,
  localControlChannel,
} from "../../src/federation/local-channel-events.js";
import { inLocalContext, LOCAL_CONTROL } from "../../src/gateway/erase-law.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, observed } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

const SEED = "cc".repeat(32);
const OP = authorForSeed(SEED);
const PEER_SEED = "a1".repeat(32);
const homes: Gateway[] = [];
afterEach(async () => {
  for (const gw of homes.splice(0)) await gw.close();
});
const BLIND = new Set(["ids", "holdsAny", "heldAmong"]);
function blindView<B extends StoreBackend>(store: B): B {
  return new Proxy(store, {
    get(target, prop) {
      if (typeof prop === "string" && BLIND.has(prop)) return undefined;
      if (prop === "holdsAnyRow") return () => Promise.resolve(true);
      if (prop === "journalRowIds") return () => (target as unknown as MemoryBackend).ids();
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
class FaultBackend extends MemoryBackend {
  failPurgeAfter = Number.POSITIVE_INFINITY;
  purges = 0;
  failNextRetraction = false;
  constructor(private readonly file: Delta[] = []) {
    super();
    if (file.length > 0) void MemoryBackend.prototype.append.call(this, [...file]);
  }
  override async append(deltas: Iterable<Delta>): Promise<number> {
    const batch = [...deltas];
    if (
      this.failNextRetraction &&
      batch.some((d) => d.claims.pointers.some((p) => p.role === "negates"))
    ) {
      this.failNextRetraction = false;
      throw new Error("fixture retraction failure");
    }
    const n = await super.append(batch);
    for (const d of batch) if (!this.file.some((f) => f.id === d.id)) this.file.push(d);
    return n;
  }
  #journal: DurableOrdinaryJournalStore | undefined;
  override journalStore(): DurableOrdinaryJournalStore {
    const inner = super.journalStore();
    const record = (rows: readonly Delta[], status: string) => {
      if (status !== "durable") return;
      for (const d of rows) if (!this.file.some((f) => f.id === d.id)) this.file.push(d);
    };
    return (this.#journal ??= {
      ...inner,
      compareAndAppend: async (peer, expected, next, frame, rows) => {
        if (
          this.failNextRetraction &&
          rows.some((d) => d.claims.pointers.some((p) => p.role === "negates"))
        ) {
          this.failNextRetraction = false;
          throw new Error("fixture retraction failure");
        }
        const result = await inner.compareAndAppend(peer, expected, next, frame, rows);
        record(rows, result.status);
        return result;
      },
      compareAndAppendErasure: async (peer, expected, next, frame, rows, absent) => {
        const result = await inner.compareAndAppendErasure!(
          peer,
          expected,
          next,
          frame,
          rows,
          absent,
        );
        record(rows, result.status);
        return result;
      },
    });
  }
  override async purge(ids: Iterable<string>): Promise<number> {
    if (this.purges >= this.failPurgeAfter) throw new Error("fixture purge failure");
    this.purges += 1;
    const gone = new Set(ids);
    const n = await super.purge(gone);
    for (let k = this.file.length - 1; k >= 0; k -= 1)
      if (gone.has(this.file[k]!.id)) this.file.splice(k, 1);
    return n;
  }
}
class HostFile extends FaultBackend {
  override async close(): Promise<void> {}
}
class PoolFile extends FaultBackend {
  override async close(): Promise<void> {}
}
async function home() {
  const primary = new HostFile();
  const files = new Map<string, Delta[]>();
  const failAttach = new Set<string>();
  const mirrors = new Map<string, Delta[]>();
  const blind = new Set<string>();
  const disks = new Map<string, PoolFile>();
  const storeFor = (name: string): StoreBackend => {
    const file = files.get(name) ?? [];
    files.set(name, file);
    const disk = disks.get(name) ?? new PoolFile(file);
    disks.set(name, disk);
    const primary = blind.has(name) ? blindView(disk) : disk;
    const mirror = mirrors.get(name);
    return mirror === undefined ? primary : new MirrorBackend(primary, new FaultBackend(mirror));
  };
  const gw = await Gateway.boot(
    primary,
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    {
      channelBackend: (name) => {
        if (failAttach.delete(name)) throw new Error("fixture store unreadable");
        return storeFor(name);
      },
    },
  );
  homes.push(gw);
  const holds = (name: string, id: string) => (files.get(name) ?? []).some((d) => d.id === id);
  const restart = async () => {
    await gw.close();
    homes.splice(homes.indexOf(gw), 1);
    const again = await Gateway.boot(
      primary,
      assembleGenesis({ operatorSeed: SEED, registrations: [] }),
      {
        channelBackend: (name) => {
          if (failAttach.delete(name)) throw new Error("fixture store unreadable");
          return storeFor(name);
        },
      },
    );
    homes.push(again);
    return again;
  };
  const cut = (name: string, ids: Iterable<string>) => disks.get(name)!.purge(ids);
  return { gw, primary, holds, restart, failAttach, files, mirrors, blind, cut, disks };
}
function peer() {
  const offering: Delta[] = [];
  return { offering, source: { pull: () => Promise.resolve([...offering]) } };
}
const fact = (n = 1) => observed(FERN, "height", n, 1000 + n, PEER_SEED);
async function channel(gw: Gateway, prefix = "peer") {
  const feed = peer();
  const ch = await gw.openChannel({
    into: "friends",
    prefix,
    from: `https://peer.example/${prefix}`,
    source: feed.source,
  });
  return { ch, ...feed, pool: gatewayOf(ch.pool) };
}
const statusIds = (gw: Gateway, name: string) =>
  [...gw.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.author === OP &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.id === `channel:${name}` &&
            p.target.entity.context === "loam.channel",
        ),
    )
    .map((d) => d.id);
function opened(gw: Gateway, name: string) {
  const evidence = localChannelEvidence(gw, name);
  if (evidence.state !== "open") throw new Error(`expected open: ${JSON.stringify(evidence)}`);
  return evidence;
}
const events = (gw: Gateway, name: string, action: string) =>
  [...gw.reactor.snapshot()].filter(
    (d) =>
      inLocalContext(d, LOCAL_EVENT) &&
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.id === `channel:${name}`,
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "action" && p.target.kind === "primitive" && p.target.value === action,
      ),
  );
const markers = (gw: Gateway, name: string) =>
  [...gw.reactor.snapshot()].filter(
    (d) => inLocalContext(d, LOCAL_CONTROL) && localControlChannel(d) === `channel:${name}`,
  );
const bytes = (gw: Gateway) => [...gw.reactor.snapshot()].map((d) => d.id).sort();

describe("spec 64: a live opening cannot be erased", () => {
  it("refuses, writes nothing, names the pool and the road; the channel keeps working and can be dropped", async () => {
    const { gw } = await home();
    const { ch, offering, pool } = await channel(gw);
    const {
      ch: sibling,
      offering: siblingOffering,
      pool: siblingPool,
    } = await channel(gw, "other");
    offering.push(fact(1));
    siblingOffering.push(fact(2));
    await ch.sync();
    await sibling.sync();
    const opening = opened(gw, ch.name).opening;
    const before = { root: bytes(gw), pool: bytes(pool), sibling: bytes(siblingPool) };
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain(`the opening of channel "${ch.name}"`);
    expect(refusal).toContain("its pool's declaration still stands");
    expect(refusal).toContain(`Drop the channel first (dropChannel "${ch.name}")`);
    expect(refusal).toContain("read or extracted until then");
    expect(bytes(gw)).toEqual(before.root);
    expect(bytes(pool)).toEqual(before.pool);
    expect(bytes(siblingPool)).toEqual(before.sibling);
    expect(markers(gw, ch.name)).toEqual([]);
    offering.push(fact(3));
    await ch.sync();
    expect(
      opened(gw, ch.name)
        .received.map((d) => d.id)
        .sort(),
    ).toEqual([fact(1).id, fact(3).id].sort());
    expect(pool.reactor.get(fact(1).id)).toBeDefined();
    await gw.dropChannel(ch.name);
    expect(events(gw, ch.name, "close")).toHaveLength(1);
    expect(bytes(siblingPool)).toEqual(before.sibling);
  });
  it("a declaration negated through the append door with the pool's bytes still held refuses and names the orphaned pool, attached or not", async () => {
    const { gw, holds, files, cut } = await home();
    const { ch, offering, pool, source } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    for (const id of survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name))
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    const attached = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(attached).toContain("its pool is still attached and holds bytes");
    expect(gw.reactor.get(opening.id)).toBeDefined();
    expect(pool.reactor.get(fact(1).id)).toBeDefined();
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    gw.attachedContainers.delete(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(true);
    const unattached = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(unattached).toContain(
      "its pool's store still holds bytes although its declaration was negated",
    );
    expect(gw.reactor.get(opening.id)).toBeDefined();
    const file = files.get(ch.name)!;
    await cut(
      ch.name,
      file.filter((d) => d.id !== fact(1).id).map((d) => d.id),
    );
    expect(file).toHaveLength(1);
    const oneByte = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(oneByte).toContain("still holds bytes although its declaration was negated");
    expect(oneByte).toContain("re-declare the name by hand, then drop the channel");
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/no surviving declaration/);
    await expect(
      gw.openChannel({
        into: "friends",
        prefix: "peer",
        from: "https://peer.example/peer",
        source,
      }),
    ).rejects.toThrow(/no surviving declaration/);
    gw.attachedContainers.set(ch.name, gatewayOf(ch.pool));
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    gw.store.setChannel(gw, ch.name, ch.pool);
    gw.federationChannels.set(ch.name, ch);
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a second declaration under the channel's name by hand orphans the pool: sync and erase refuse, the drop purges it and negates both, then the erase proceeds", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name)).toHaveLength(2);
    await expect(ch.sync()).rejects.toThrow();
    await expect(gw.erase(opening.id)).rejects.toThrow(/Drop the channel first/);
    await gw.dropChannel(ch.name);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name)).toEqual([]);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    expect(events(gw, ch.name, "close")).toEqual([]);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a fresh opening over a store an earlier incarnation left behind does not let that incarnation's erase report clean", async () => {
    const first = await home();
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const opening = opened(first.gw, a.ch.name).opening;
    const struck = [
      ...survivingDeclarationIds(first.gw.reactor, first.gw.validityNow(), OP, a.ch.name),
      ...[...first.gw.reactor.snapshot()]
        .filter((d) =>
          d.claims.pointers.some(
            (p) =>
              p.target.kind === "entity" &&
              p.target.entity.context === "loam.channel" &&
              p.target.entity.id === `channel:${a.ch.name}`,
          ),
        )
        .map((d) => d.id),
    ];
    for (const id of struck)
      await first.gw.append([
        signClaims(
          withStamp(first.gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    const gw = await first.restart();
    expect(first.holds(a.ch.name, fact(1).id)).toBe(true);
    const feed = peer();
    const fresh = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    feed.offering.push(fact(2));
    await fresh.sync();
    const second = opened(gw, a.ch.name).opening;
    expect(second.id).not.toBe(opening.id);
    await expect(gw.erase(opening.id)).rejects.toThrow(/no receipt of that incarnation names/);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(true);
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await gw.dropChannel(a.ch.name);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
    await gw.erase(second.id);
    expect(gw.reactor.get(second.id)).toBeUndefined();
  });
  it("an event this reader cannot parse makes the orphan question fail closed: the drop refuses rather than purges", async () => {
    const first = await home();
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const opening = opened(first.gw, a.ch.name).opening;
    await first.gw.append([
      signClaims(
        withStamp(first.gw.stamp(OP), (t) =>
          containerClaims(
            { container: a.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    const held = first.gw.reactor.get(opening.id)!;
    const unreadable = signClaims(
      {
        ...held.claims,
        ...first.gw.stamp(OP),
        pointers: held.claims.pointers.filter((p) => p.role !== "parent-container"),
      },
      SEED,
    );
    const { peer } = await openHostPeer(first.primary.journalStore(), OP);
    await admitLocal(peer, [unreadable], Date.now(), () => false);
    const gw = await first.restart();
    await expect(gw.dropChannel(a.ch.name)).rejects.toThrow(/dropChannel refused/);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(true);
  });
  it("a stranger's byte in the root rides the seed into every later pool and does not keep an earlier opening live", async () => {
    const { gw } = await home();
    const stranger = observed(FERN, "height", 77, 2077, "b7".repeat(32));
    await gw.federate([stranger], { admit: () => true });
    expect(gw.reactor.get(stranger.id)).toBeDefined();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const first = opened(gw, ch.name).opening;
    await gw.dropChannel(ch.name);
    const feed = peer();
    const again = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    feed.offering.push(fact(2));
    await again.sync();
    expect(gatewayOf(again.pool).reactor.get(stranger.id)).toBeDefined();
    await gw.erase(first.id);
    expect(gw.reactor.get(first.id)).toBeUndefined();
    feed.offering.push(fact(3));
    await again.sync();
    expect(
      opened(gw, ch.name)
        .received.map((d) => d.id)
        .sort(),
    ).toEqual([fact(2).id, fact(3).id].sort());
  });
  it("another channel's unreadable event does not close this pool's orphan question", async () => {
    const first = await home();
    const other = await channel(first.gw, "other");
    other.offering.push(fact(9));
    await other.ch.sync();
    const otherOpening = first.gw.reactor.get(opened(first.gw, other.ch.name).opening.id)!;
    const unreadable = signClaims(
      {
        ...otherOpening.claims,
        ...first.gw.stamp(OP),
        pointers: otherOpening.claims.pointers.filter((p) => p.role !== "parent-container"),
      },
      SEED,
    );
    const { peer } = await openHostPeer(first.primary.journalStore(), OP);
    await admitLocal(peer, [unreadable], Date.now(), () => false);
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const opening = opened(first.gw, a.ch.name).opening;
    await first.gw.append([
      signClaims(
        withStamp(first.gw.stamp(OP), (t) =>
          containerClaims(
            { container: a.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    const gw = await first.restart();
    await gw.dropChannel(a.ch.name);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("both orphan states read the same after a restart: the erase refuses or the drop works, never a strand", async () => {
    const first = await home();
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const aOpening = opened(first.gw, a.ch.name).opening;
    for (const id of survivingDeclarationIds(
      first.gw.reactor,
      first.gw.validityNow(),
      OP,
      a.ch.name,
    ))
      await first.gw.append([
        signClaims(
          withStamp(first.gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    await first.gw.append([
      signClaims(
        withStamp(first.gw.stamp(OP), (t) =>
          containerClaims(
            { container: a.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    const gw = await first.restart();
    expect(gw.channelPools.get(a.ch.name)).toBeDefined();
    await expect(gw.erase(aOpening.id)).rejects.toThrow(/no opening names is attached/);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(true);
    await gw.dropChannel(a.ch.name);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(false);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, a.ch.name)).toEqual([]);
    await gw.erase(aOpening.id);
    expect(gw.reactor.get(aOpening.id)).toBeUndefined();
    const second = await home();
    const b = await channel(second.gw);
    b.offering.push(fact(2));
    await b.ch.sync();
    const bOpening = opened(second.gw, b.ch.name).opening;
    await second.gw.append([
      signClaims(
        withStamp(second.gw.stamp(OP), (t) =>
          containerClaims(
            { container: b.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    const gw2 = await second.restart();
    await expect(gw2.erase(bOpening.id)).rejects.toThrow(/Drop the channel first/);
    await gw2.dropChannel(b.ch.name);
    expect(second.holds(b.ch.name, fact(2).id)).toBe(false);
    await gw2.erase(bOpening.id);
    expect(gw2.reactor.get(bOpening.id)).toBeUndefined();
  });
});

describe("spec 64: after the drop, the erase takes the incarnation's lineage", () => {
  it("erases receipts and close first and the opening last; a fault before the opening's erasure leaves the history readable and a re-run finishes", async () => {
    const { gw, primary } = await home();
    const { ch, offering } = await channel(gw);
    const { ch: sibling, offering: siblingOffering } = await channel(gw, "other");
    offering.push(fact(1));
    siblingOffering.push(fact(2));
    await ch.sync();
    await sibling.sync();
    const opening = opened(gw, ch.name).opening;
    const receipt = events(gw, ch.name, "received")[0]!;
    const siblingReceipt = events(gw, sibling.name, "received")[0]!;
    await gw.dropChannel(ch.name);
    const close = events(gw, ch.name, "close")[0]!;
    primary.purges = 0;
    primary.failPurgeAfter = 2;
    await expect(gw.erase(opening.id)).rejects.toThrow();
    expect(gw.reactor.get(receipt.id)).toBeUndefined();
    expect(gw.reactor.get(close.id)).toBeUndefined();
    expect(gw.reactor.get(opening.id)).toBeUndefined();
    expect(await primary.holds(opening.id)).toBe(true);
    expect(localChannelEvidence(gw, ch.name)).not.toEqual({
      state: "unavailable",
      reason: "missing referenced opening",
    });
    expect(localChannelEvidence(gw, ch.name)).not.toEqual({
      state: "unavailable",
      reason: "invalid local event history",
    });
    primary.failPurgeAfter = Number.POSITIVE_INFINITY;
    const report = await gw.erase(opening.id);
    expect(report.erased).toBe(opening.id);
    for (const gone of [opening.id, receipt.id, close.id]) {
      expect(gw.reactor.get(gone)).toBeUndefined();
      expect(await primary.holds(gone)).toBe(false);
    }
    expect(markers(gw, ch.name).length).toBeGreaterThanOrEqual(3);
    expect(localChannelEvidence(gw, ch.name)).toEqual({
      state: "unavailable",
      reason: "erased opening",
    });
    expect(gw.reactor.get(siblingReceipt.id)).toBeDefined();
    expect(await primary.holds(siblingReceipt.id)).toBe(true);
    expect(gw.reactor.get(opening.statusAtOpen)).toBeDefined();
    expect(opened(gw, sibling.name).received.map((d) => d.id)).toEqual([fact(2).id]);
  });
  it("a member whose purge faulted is erased again on the re-run, never skipped for its erasure", async () => {
    const { gw, primary } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    const receipt = events(gw, ch.name, "received")[0]!;
    await gw.dropChannel(ch.name);
    const close = events(gw, ch.name, "close")[0]!;
    primary.purges = 0;
    primary.failPurgeAfter = 0;
    await expect(gw.erase(opening.id)).rejects.toThrow(/STILL HELD/);
    const dead = readErasures(gw.reactor, gw.validityNow(), OP);
    const held = [receipt, close].filter((m) => dead.has(m.id));
    expect(held).toHaveLength(1);
    expect(await primary.holds(held[0]!.id)).toBe(true);
    expect(gw.reactor.get(held[0]!.id)).toBeUndefined();
    expect(gw.reactor.get(opening.id)).toBeDefined();
    primary.failPurgeAfter = Number.POSITIVE_INFINITY;
    const report = await gw.erase(opening.id);
    expect(report.erased).toBe(opening.id);
    for (const m of [receipt, close, gw.reactor.get(opening.id) ?? opening]) {
      expect(await primary.holds(m.id)).toBe(false);
      expect(gw.reactor.get(m.id)).toBeUndefined();
    }
  });
  it("a later incarnation of the same name keeps receiving after the earlier one's opening is erased", async () => {
    const { gw } = await home();
    const { ch, offering, source } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const first = opened(gw, ch.name).opening;
    await gw.dropChannel(ch.name);
    const feed = peer();
    const again = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    feed.offering.push(fact(2));
    await again.sync();
    const second = opened(gw, ch.name).opening;
    expect(second.id).not.toBe(first.id);
    await gw.erase(first.id);
    expect(gw.reactor.get(first.id)).toBeUndefined();
    expect(gw.reactor.get(second.id)).toBeDefined();
    feed.offering.push(fact(3));
    await again.sync();
    expect(
      opened(gw, ch.name)
        .received.map((d) => d.id)
        .sort(),
    ).toEqual([fact(2).id, fact(3).id].sort());
    void source;
  });
  it("a pool a boot could not attach: the erase is refused as unreachable, the drop attaches and registers it, then the erase proceeds", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const earlier = opened(first.gw, ch.name).opening;
    await first.gw.dropChannel(ch.name);
    const feed = peer();
    const again = await first.gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    feed.offering.push(fact(2));
    await again.sync();
    first.failAttach.add(ch.name);
    const gw = await first.restart();
    expect(gw.channelPools.get(ch.name)).toBeUndefined();
    await expect(gw.erase(earlier.id)).rejects.toThrow(
      /neither attached nor covered by a detach record/,
    );
    expect(gw.reactor.get(earlier.id)).toBeDefined();
    expect(first.holds(ch.name, fact(2).id)).toBe(true);
    await gw.dropChannel(ch.name);
    expect(first.holds(ch.name, fact(2).id)).toBe(false);
    await gw.erase(earlier.id);
    expect(gw.reactor.get(earlier.id)).toBeUndefined();
  });
  it("a hand-made declaration that stands detached on the record with no handle: the erase names the drop, the drop works, then the erase proceeds", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    for (const id of survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name))
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    await ch.pool.detach("kept for extraction");
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(true);
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain(
      "a declaration under its name still stands while no pool is attached",
    );
    expect(refusal).not.toContain("re-declare");
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a later LIVE incarnation detached in this process: the earlier opening's refusal names re-attach, not a drop, and the re-attached pool keeps its bytes", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const earlier = opened(gw, ch.name).opening;
    await gw.dropChannel(ch.name);
    const feed = peer();
    const opts = {
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    };
    const again = await gw.openChannel(opts);
    feed.offering.push(fact(2));
    await again.sync();
    await again.pool.detach("kept for extraction");
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    const refusal = await gw.erase(earlier.id).catch((e: Error) => e.message);
    expect(refusal).toContain("attach it first");
    expect(refusal).not.toContain("dropChannel");
    expect(gw.reactor.get(earlier.id)).toBeDefined();
    await gw.openChannel(opts);
    await gw.erase(earlier.id);
    expect(gw.reactor.get(earlier.id)).toBeUndefined();
    expect(holds(ch.name, fact(2).id)).toBe(true);
    expect(localChannelEvidence(gw, ch.name).state).toBe("open");
  });
  it("a container attached by hand under the channel's name holds bytes: the erase says so; detached, the drop purges it and the erase proceeds", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    for (const id of survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name))
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    await ch.pool.detach("kept for extraction");
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    const hand = await gw.openContainer({
      name: ch.name,
      backend: gw.options.channelBackend!(ch.name),
    });
    expect(hand.gateway!.reactor.get(fact(1).id)).toBeDefined();
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain("detach() it, then drop the channel (dropChannel), then erase again");
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await hand.detach("kept for extraction");
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
    expect(gw.channelStatus(ch.name)).toHaveLength(0);
  });
  it("status stamps negated by hand while the declaration stands: the drop is not refused as severed, purges the pool, and the name opens fresh afterwards", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    const { ch: sibling, offering: siblingOffering } = await channel(gw, "peer0");
    siblingOffering.push(fact(9));
    await sibling.sync();
    for (const id of statusIds(gw, ch.name))
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    expect(gw.channelStatus(ch.name)).toHaveLength(0);
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain("its pool's declaration still stands");
    expect(refusal).toContain(`Drop the channel first (dropChannel "${ch.name}")`);
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    expect(holds(sibling.name, fact(9).id)).toBe(true);
    expect(localChannelEvidence(gw, sibling.name).state).toBe("open");
    expect(gw.channelPools.get(ch.name)).toBeUndefined();
    expect(gw.federationChannels.get(ch.name)).toBeUndefined();
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
    const feed = peer();
    const again = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    feed.offering.push(fact(2));
    await again.sync();
    expect(opened(gw, ch.name).received.map((d) => d.id)).toEqual([fact(2).id]);
    const { ch: other, offering: otherOffering } = await channel(gw, "peer2");
    otherOffering.push(fact(3));
    await other.sync();
    const otherOpening = opened(gw, other.name).opening;
    await other.pool.drop();
    expect(gw.channelPools.get(other.name)).toBeDefined();
    await gw.erase(otherOpening.id);
    expect(gw.reactor.get(otherOpening.id)).toBeUndefined();
  });
  it("a hand-declared container under a name this store never had as a channel is not the drop door's: refused, no store minted, declaration kept", async () => {
    const { gw, files } = await home();
    for (const name of ["mydata", "channel:friends:zzz"]) {
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) =>
            containerClaims(
              { container: name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
              OP,
              t,
            ),
          ),
          SEED,
        ),
      ]);
      await expect(gw.dropChannel(name)).rejects.toThrow(/no channel named/);
      expect(files.has(name)).toBe(false);
      expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, name)).toHaveLength(1);
    }
  });
  it("a declaration by hand under a name that once was a channel is not the drop door's: separate with its own store, detached or not, and shared", async () => {
    const { gw, files } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    await gw.dropChannel(ch.name);
    const factoryOpens = files.size;
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    const own: Delta[] = [];
    const hand = await gw.openContainer({ name: ch.name, backend: new FaultBackend(own) });
    await hand.gateway!.federate([fact(7)]);
    expect(own.some((d) => d.id === fact(7).id)).toBe(true);
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/already severed/);
    await hand.detach("kept for extraction");
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/already severed/);
    expect(own.some((d) => d.id === fact(7).id)).toBe(true);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name)).toHaveLength(1);
    expect(files.size).toBe(factoryOpens);
    for (const id of survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name))
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            {
              container: ch.name,
              trust: "curated",
              posture: "shared",
              inboxOf: "friends",
              membership: {
                op: "select",
                pred: { hasPointer: { context: { exact: "x" } } },
                in: "input",
              },
            },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/already severed/);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name)).toHaveLength(1);
  });
  it("status and declaration both negated by hand in this process: the drop names the attached pool it cannot reach and the road out; the road works", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(first.gw, ch.name).opening;
    for (const id of [
      ...survivingDeclarationIds(first.gw.reactor, first.gw.validityNow(), OP, ch.name),
      ...statusIds(first.gw, ch.name),
    ])
      await first.gw.append([
        signClaims(
          withStamp(first.gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    await expect(first.gw.erase(opening.id)).rejects.toThrow(/Drop the channel first/);
    const refusal = await first.gw.dropChannel(ch.name).catch((e: Error) => e.message);
    expect(refusal).toContain("a pool is still attached here under that name and holds bytes");
    expect(refusal).not.toContain("nothing left to remove");
    expect(first.holds(ch.name, fact(1).id)).toBe(true);
    const gw = await first.restart();
    expect(gw.channelPools.get(ch.name)).toBeUndefined();
    const feed = peer();
    await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    await gw.dropChannel(ch.name);
    expect(first.holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a mirror tier that kept a peer byte after the primary's purge keeps the opening live although the read shows nothing; the drop purges both tiers", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(first.gw, ch.name).opening;
    const receipt = events(first.gw, ch.name, "received")[0]!;
    for (const id of [
      ...survivingDeclarationIds(first.gw.reactor, first.gw.validityNow(), OP, ch.name),
      ...statusIds(first.gw, ch.name),
    ])
      await first.gw.append([
        signClaims(
          withStamp(first.gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    const file = first.files.get(ch.name)!;
    first.mirrors.set(ch.name, [...file]);
    await first.cut(
      ch.name,
      file.map((d) => d.id),
    );
    const gw = await first.restart();
    expect(gw.channelPools.get(ch.name)).toBeUndefined();
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain(
      "its pool's store still holds bytes although its declaration was negated",
    );
    expect(gw.reactor.get(opening.id)).toBeDefined();
    expect(first.mirrors.get(ch.name)!.some((d) => d.id === fact(1).id)).toBe(true);
    const feed = peer();
    await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    const reopened = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(reopened).toMatch(/holds 3 byte\(s\) that no receipt of that incarnation names/);
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await gw.erase(receipt.id);
    expect(gw.reactor.get(receipt.id)).toBeUndefined();
    expect(first.mirrors.get(ch.name)!.some((d) => d.id === fact(1).id)).toBe(true);
    const receiptless = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(receiptless).toMatch(/holds 3 byte\(s\) that no receipt of that incarnation names/);
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(
      /bytes that no read named .* heal its store while nothing is attached/,
    );
    expect(first.mirrors.get(ch.name)!.some((d) => d.id === fact(1).id)).toBe(true);
    await new MirrorBackend(
      first.disks.get(ch.name)!,
      new FaultBackend(first.mirrors.get(ch.name)),
    ).heal();
    expect(file.some((d) => d.id === fact(1).id)).toBe(true);
    const gw2 = await first.restart();
    await gw2.dropChannel(ch.name);
    expect(file.some((d) => d.id === fact(1).id)).toBe(false);
    expect(first.mirrors.get(ch.name)!.some((d) => d.id === fact(1).id)).toBe(false);
    await gw2.erase(opening.id);
    expect(gw2.reactor.get(opening.id)).toBeUndefined();
  });
  it("a later incarnation over a store with no inventory cannot account for the earlier opening's bytes: the erase refuses", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const earlier = opened(first.gw, ch.name).opening;
    await first.gw.dropChannel(ch.name);
    first.blind.add(ch.name);
    const feed = peer();
    const again = await first.gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    feed.offering.push(fact(2));
    await again.sync();
    const refusal = await first.gw.erase(earlier.id).catch((e: Error) => e.message);
    expect(refusal).toContain("cannot be listed on every tier (the store offers no inventory)");
    expect(first.gw.reactor.get(earlier.id)).toBeDefined();
    feed.offering.push(fact(3));
    await again.sync();
    expect(
      opened(first.gw, ch.name)
        .received.map((d) => d.id)
        .sort(),
    ).toEqual([fact(2).id, fact(3).id].sort());
  });
  it("a store with no whole-store byte probe cannot prove its pool empty: the erase refuses although the read shows nothing", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(first.gw, ch.name).opening;
    for (const id of [
      ...survivingDeclarationIds(first.gw.reactor, first.gw.validityNow(), OP, ch.name),
      ...statusIds(first.gw, ch.name),
    ])
      await first.gw.append([
        signClaims(
          withStamp(first.gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    await first.cut(
      ch.name,
      first.files.get(ch.name)!.map((d) => d.id),
    );
    first.blind.add(ch.name);
    const gw = await first.restart();
    await expect(gw.erase(opening.id)).rejects.toThrow(
      /still holds bytes although its declaration was negated/,
    );
    expect(gw.reactor.get(opening.id)).toBeDefined();
    first.blind.delete(ch.name);
    await expect(gw.erase(opening.id)).rejects.toThrow(/open the channel again under this name/);
    const feed = peer();
    await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    await gw.dropChannel(ch.name);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a container attached by hand under a live channel's name while its pool is detached: the erase names detach then drop, and that road works", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    await ch.pool.detach("kept for extraction");
    const hand = await gw.openContainer({
      name: ch.name,
      backend: gw.options.channelBackend!(ch.name),
    });
    expect(hand.gateway!.reactor.get(fact(1).id)).toBeDefined();
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain("attached by hand under its name holds bytes: detach() it");
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/already attached/);
    await hand.detach("kept for extraction");
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("status stamps and declaration negated by hand, no handle: the refusal names a fresh open, which attaches the store; the drop then purges it and the erase proceeds", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(first.gw, ch.name).opening;
    const struck = [
      ...survivingDeclarationIds(first.gw.reactor, first.gw.validityNow(), OP, ch.name),
      ...statusIds(first.gw, ch.name),
    ];
    for (const id of struck)
      await first.gw.append([
        signClaims(
          withStamp(first.gw.stamp(OP), (t) => makeNegationClaims(OP, t, id)),
          SEED,
        ),
      ]);
    const gw = await first.restart();
    expect(gw.channelPools.get(ch.name)).toBeUndefined();
    expect(first.holds(ch.name, fact(1).id)).toBe(true);
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain("open the channel again under this name");
    expect(refusal).not.toContain("re-declare");
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/severed|no channel named/);
    const feed = peer();
    await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/peer",
      source: feed.source,
    });
    await gw.dropChannel(ch.name);
    expect(first.holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a drop whose declaration negation failed after the purge completes on re-run, and then the opening can be erased", async () => {
    const { gw, primary, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    expect(holds(ch.name, fact(1).id)).toBe(true);
    primary.failNextRetraction = true;
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(
      /discarded .* at the bytes .* could not be negated/,
    );
    expect(holds(ch.name, fact(1).id)).toBe(false);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name)).not.toEqual([]);
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toMatch(/refused/);
    expect(refusal).toContain(ch.name);
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await gw.dropChannel(ch.name);
    expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, ch.name)).toEqual([]);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
});
