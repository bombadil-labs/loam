// T289 (spec 64): a live channel opening cannot be erased until its pool is dropped. The refusal
// names the pool and the road. A dropped incarnation's erase takes its receipts and close with it,
// receipts and close first and the opening last. Every purging case names a live bystander at the
// bytes. All destructive fixtures are this file's own MemoryBackend instances.
//
// RAILS-RED on the T288 tip (4e3b8b52), this file copied in: 5 red, 0 green. REVERT PROBES on this
// tree, one guard deleted per probe, measured across the eight local-channel suites (118 cases):
//   a live opening's erase proceeds                                → 4 red
//   the pool under the name counts whatever its declaration        → 1 red
//   a dropped incarnation's erase leaves its receipts and close    → 5 red
//   a surviving declaration does not make the opening live         → 3 red
//   a stale handle is not re-registered on drop re-run             → 1 red
// Measured again after review round 1 (120 cases across the nine suites):
//   a tombstoned member is skipped whether or not it is settled     → 1 red
//   the struck-declaration byte check through the store is gone     → 1 red
// After review round 3 (123 cases): an orphaned attached pool cannot be dropped → 2 red.
// After review round 4 (124 cases): a pool under another declaration is always another
// incarnation → 1 red; the drop road ignores an orphan after a restart → 1 red.
// After review rounds 5 and 6 (126 cases): a later incarnation's unnamed bytes do not keep an
// earlier opening live → 1 red; an unparseable event of this channel does not fail closed →
// 1 red. Round 5's open-time refusal was withdrawn in round 6: a separate pool is seeded from
// the root, so it refused every fresh open over a root that held a stranger's record.
// After review round 7 (128 cases): bytes the root also holds count against an earlier opening
// → 1 red; the orphan question fails closed on ANY channel's unreadable event → 1 red.
// After review rounds 8 and 9 (130 cases): a boot-skipped pool's in-process drop attaches the pool
// without registering it → 1 red; the no-handle road names a re-declaration while a declaration
// stands → 1 red; a one-delta store reads as empty (`> 1`) → 1 red.
// After review round 10 (133 cases): a hand-attached container under the name is invisible to the
// probe → 1 red; the standing-declaration text names a drop that purges a live incarnation → 1
// red; the struck-declaration text names a re-declaration that the drop then refuses → 1 red.
// After review round 11 (133 cases): the struck-declaration text names a fresh open while the
// status still stands, where an open resumes and needs the declaration → 1 red; the drop road on
// a later incarnation's unnamed bytes did not say it severs the standing incarnation → 1 red.
// After review round 12 (134 cases): a name whose status was struck by hand is sent to a drop
// that calls it severed → 1 red; a dropped pool's stale handle reads as a pool that holds bytes →
// 1 red; the hand-attached road's drop() left a name with stamps and no declaration → 1 red.
// RAILS-RED on 4e3b8b52, the whole file as of round 12: 17 red, 1 green. The green case is "an event this reader cannot parse makes the orphan question fail closed": the base's
// drop also throws on an unreadable history. Its scoped guard is measured by the revert probe.
// The struck-declaration case measures both halves of the byte side: the attached pool, and the
// store reopened by name with no handle in memory (the fixture keeps one store per name, as the
// CLI's sqlite file does).
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, survivingDeclarationIds } from "../../src/gateway/container.js";
import { readTombstones } from "../../src/gateway/erase.js";
import {
  inLocalContext,
  LOCAL_CONTROL,
  LOCAL_EVENT,
  localChannelEvidence,
  localControlChannel,
} from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const OP = authorForSeed(SEED);
const PEER_SEED = "a1".repeat(32);
const homes: Gateway[] = [];
afterEach(async () => {
  for (const gw of homes.splice(0)) await gw.close();
});
class FaultBackend extends MemoryBackend {
  failPurgeAfter = Number.POSITIVE_INFINITY;
  purges = 0;
  failNextRetraction = false;
  // THE FILE: one byte store per name, shared by every handle over it, the way a sqlite file is.
  // A handle seeds itself from the file, and every append or purge through it changes the file.
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
async function home() {
  const primaryFile: Delta[] = [];
  const primary = new FaultBackend(primaryFile);
  const files = new Map<string, Delta[]>();
  // Names whose NEXT store open fails once: a pool a boot cannot read is left unattached.
  const failAttach = new Set<string>();
  const gw = await Gateway.boot(
    primary,
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    {
      channelBackend: (name) => {
        if (failAttach.delete(name)) throw new Error("fixture store unreadable");
        const file = files.get(name) ?? [];
        files.set(name, file);
        return new FaultBackend(file);
      },
    },
  );
  homes.push(gw);
  const holds = (name: string, id: string) => (files.get(name) ?? []).some((d) => d.id === id);
  // A RESTART: close this process's gateway and boot another over the same primary and the same
  // files. Boot re-attaches every declared pool under its current declaration.
  const restart = async () => {
    await gw.close();
    homes.splice(homes.indexOf(gw), 1);
    const again = await Gateway.boot(
      new FaultBackend(primaryFile),
      assembleGenesis({ operatorSeed: SEED, registrations: [] }),
      {
        channelBackend: (name) => {
          if (failAttach.delete(name)) throw new Error("fixture store unreadable");
          const file = files.get(name) ?? [];
          files.set(name, file);
          return new FaultBackend(file);
        },
      },
    );
    homes.push(again);
    return again;
  };
  return { gw, primary, holds, restart, failAttach, files };
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
  return { ch, ...feed, pool: ch.pool.gateway! };
}
// The operator's status stamps of one channel, by id: what a strike by hand negates.
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
    // Delta level: nothing was written anywhere.
    expect(bytes(gw)).toEqual(before.root);
    expect(bytes(pool)).toEqual(before.pool);
    expect(bytes(siblingPool)).toEqual(before.sibling);
    expect(markers(gw, ch.name)).toEqual([]);
    // Object level: the channel is untouched. It receives, reads, and drops.
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
  it("a declaration struck through the append door with the pool's bytes still held refuses and names the orphaned pool, attached or not", async () => {
    const { gw, holds, files } = await home();
    const { ch, offering, pool, source } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    for (const id of survivingDeclarationIds(gw.reactor, OP, ch.name))
      await gw.append([signClaims(makeNegationClaims(OP, gw.nextTimestamp(), id), SEED)]);
    const attached = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(attached).toContain("its pool is still attached and holds bytes");
    expect(gw.reactor.get(opening.id)).toBeDefined();
    expect(pool.reactor.get(fact(1).id)).toBeDefined();
    // Cross-process: no handle in memory, the store on disk still holds the bytes. The three maps
    // are what another process would not have; the pool object itself is this process's.
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    gw.attachedContainers.delete(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(true);
    const unattached = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(unattached).toContain(
      "its pool's store still holds bytes although its declaration was struck",
    );
    expect(gw.reactor.get(opening.id)).toBeDefined();
    // ONE byte is enough. The seed never leaves a store this small; a hand-written one can be.
    const file = files.get(ch.name)!;
    file.splice(0, file.length, ...file.filter((d) => d.id === fact(1).id));
    expect(file).toHaveLength(1);
    const oneByte = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(oneByte).toContain("still holds bytes although its declaration was struck");
    // With the status standing, an open would RESUME and needs the declaration: the road is a
    // declaration by hand, then the drop. The fresh-open road belongs to the status-struck state.
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
    gw.attachedContainers.set(ch.name, ch.pool.gateway!);
    await gw.append([
      signClaims(
        containerClaims(
          { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          gw.nextTimestamp(),
        ),
        SEED,
      ),
    ]);
    gw.channelPools.set(ch.name, ch.pool);
    gw.federationChannels.set(ch.name, ch);
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a second declaration under the channel's name by hand orphans the pool: sync and erase refuse, the drop purges it and strikes both, then the erase proceeds", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    await gw.append([
      signClaims(
        containerClaims(
          { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          gw.nextTimestamp(),
        ),
        SEED,
      ),
    ]);
    expect(survivingDeclarationIds(gw.reactor, OP, ch.name)).toHaveLength(2);
    await expect(ch.sync()).rejects.toThrow();
    await expect(gw.erase(opening.id)).rejects.toThrow(/Drop the channel first/);
    await gw.dropChannel(ch.name);
    expect(survivingDeclarationIds(gw.reactor, OP, ch.name)).toEqual([]);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    expect(events(gw, ch.name, "close")).toEqual([]); // nothing was open, so nothing is closed
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("a fresh opening over a store an earlier incarnation left behind does not let that incarnation's erase report clean", async () => {
    const first = await home();
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const opening = opened(first.gw, a.ch.name).opening;
    // Strike the declaration AND the status records by hand, no drop: the store keeps its bytes.
    const struck = [
      ...survivingDeclarationIds(first.gw.reactor, OP, a.ch.name),
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
        signClaims(makeNegationClaims(OP, first.gw.nextTimestamp(), id), SEED),
      ]);
    const gw = await first.restart();
    expect(first.holds(a.ch.name, fact(1).id)).toBe(true);
    // The fresh open attaches over the leftover store: the name keys the file. The new
    // incarnation's receipts name only what it received, so the old bytes are still the old
    // opening's, and its erase refuses until the incarnation holding them is dropped.
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
        containerClaims(
          { container: a.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          first.gw.nextTimestamp(),
        ),
        SEED,
      ),
    ]);
    // Plant, through the trusted restore boundary, an open literal this parser cannot read: it
    // lacks the parent-container pointer. Then restart, so boot reads it as history.
    const held = first.gw.reactor.get(opening.id)!;
    const unreadable = signClaims(
      {
        ...held.claims,
        timestamp: first.gw.nextTimestamp(),
        pointers: held.claims.pointers.filter((p) => p.role !== "parent-container"),
      },
      SEED,
    );
    await first.primary.append([unreadable]);
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
    // The seed copied the stranger's byte into the new pool; no receipt names it; the root holds it.
    expect(again.pool.gateway!.reactor.get(stranger.id)).toBeDefined();
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
        timestamp: first.gw.nextTimestamp(),
        pointers: otherOpening.claims.pointers.filter((p) => p.role !== "parent-container"),
      },
      SEED,
    );
    await first.primary.append([unreadable]);
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const opening = opened(first.gw, a.ch.name).opening;
    await first.gw.append([
      signClaims(
        containerClaims(
          { container: a.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          first.gw.nextTimestamp(),
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
    // Struck and replaced by hand, then a restart that re-attaches under the new declaration.
    const first = await home();
    const a = await channel(first.gw);
    a.offering.push(fact(1));
    await a.ch.sync();
    const aOpening = opened(first.gw, a.ch.name).opening;
    for (const id of survivingDeclarationIds(first.gw.reactor, OP, a.ch.name))
      await first.gw.append([
        signClaims(makeNegationClaims(OP, first.gw.nextTimestamp(), id), SEED),
      ]);
    await first.gw.append([
      signClaims(
        containerClaims(
          { container: a.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          first.gw.nextTimestamp(),
        ),
        SEED,
      ),
    ]);
    const gw = await first.restart();
    expect(gw.channelPools.get(a.ch.name)).toBeDefined();
    // The erase must not strand the bytes: the attached pool is no other incarnation's.
    await expect(gw.erase(aOpening.id)).rejects.toThrow(/no opening names is attached/);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(true);
    await gw.dropChannel(a.ch.name);
    expect(first.holds(a.ch.name, fact(1).id)).toBe(false);
    expect(survivingDeclarationIds(gw.reactor, OP, a.ch.name)).toEqual([]);
    await gw.erase(aOpening.id);
    expect(gw.reactor.get(aOpening.id)).toBeUndefined();
    // A second declaration by hand, then a restart.
    const second = await home();
    const b = await channel(second.gw);
    b.offering.push(fact(2));
    await b.ch.sync();
    const bOpening = opened(second.gw, b.ch.name).opening;
    await second.gw.append([
      signClaims(
        containerClaims(
          { container: b.ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          second.gw.nextTimestamp(),
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
  it("erases receipts and close first and the opening last; a fault before the opening's tombstone leaves the history readable and a re-run finishes", async () => {
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
    // The receipt and the close purge first; the opening's own purge is the third and fails.
    primary.purges = 0;
    primary.failPurgeAfter = 2;
    await expect(gw.erase(opening.id)).rejects.toThrow();
    expect(gw.reactor.get(receipt.id)).toBeUndefined();
    expect(gw.reactor.get(close.id)).toBeUndefined();
    expect(gw.reactor.get(opening.id)).toBeDefined();
    // The history is still readable: the opening resolves, so no receipt names a hole.
    expect(localChannelEvidence(gw, ch.name)).not.toEqual({
      state: "unavailable",
      reason: "missing referenced opening",
    });
    expect(localChannelEvidence(gw, ch.name)).not.toEqual({
      state: "unavailable",
      reason: "invalid local event history",
    });
    // The re-run finishes: the settled members are skipped, the opening goes last.
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
    // Bystanders at the bytes: the sibling's lineage and the root's status stamps.
    expect(gw.reactor.get(siblingReceipt.id)).toBeDefined();
    expect(await primary.holds(siblingReceipt.id)).toBe(true);
    expect(gw.reactor.get(opening.statusAtOpen)).toBeDefined();
    expect(opened(gw, sibling.name).received.map((d) => d.id)).toEqual([fact(2).id]);
  });
  it("a member whose purge faulted is erased again on the re-run, never skipped for its tombstone", async () => {
    const { gw, primary } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    const receipt = events(gw, ch.name, "received")[0]!;
    await gw.dropChannel(ch.name);
    const close = events(gw, ch.name, "close")[0]!;
    // The FIRST member purge fails, whichever member sorts first: its tombstone lands, its bytes
    // stay held, and the other member is untouched.
    primary.purges = 0;
    primary.failPurgeAfter = 0;
    await expect(gw.erase(opening.id)).rejects.toThrow(/STILL HELD/);
    const dead = readTombstones(gw.reactor, OP);
    const held = [receipt, close].filter((m) => dead.has(m.id));
    expect(held).toHaveLength(1);
    expect(await primary.holds(held[0]!.id)).toBe(true);
    expect(gw.reactor.get(held[0]!.id)).toBeDefined();
    expect(gw.reactor.get(opening.id)).toBeDefined();
    // The re-run erases that member again, anchoring on its tombstone, then finishes.
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
    // The pool's store is unreadable at boot, then readable again: the later declaration stands
    // on the record and no handle is in memory. The §11 sweep refuses before the liveness probe.
    first.failAttach.add(ch.name);
    const gw = await first.restart();
    expect(gw.channelPools.get(ch.name)).toBeUndefined();
    await expect(gw.erase(earlier.id)).rejects.toThrow(
      /neither attached nor covered by a detach record/,
    );
    expect(gw.reactor.get(earlier.id)).toBeDefined();
    expect(first.holds(ch.name, fact(2).id)).toBe(true);
    // The drop in this process attaches the pool, registers it for its own lifecycle read, and
    // purges it. The earlier opening's erase then proceeds.
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
    for (const id of survivingDeclarationIds(gw.reactor, OP, ch.name))
      await gw.append([signClaims(makeNegationClaims(OP, gw.nextTimestamp(), id), SEED)]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          gw.nextTimestamp(),
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
    // The two maps still hold the detached handle in this process; a boot over a store this
    // process cannot read has neither. That is the state this case models.
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    const refusal = await gw.erase(earlier.id).catch((e: Error) => e.message);
    expect(refusal).toContain("attach it first");
    expect(refusal).not.toContain("dropChannel");
    expect(gw.reactor.get(earlier.id)).toBeDefined();
    // The road: the open resumes the standing incarnation; its bytes are its own; the erase proceeds.
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
    for (const id of survivingDeclarationIds(gw.reactor, OP, ch.name))
      await gw.append([signClaims(makeNegationClaims(OP, gw.nextTimestamp(), id), SEED)]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: ch.name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          gw.nextTimestamp(),
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
    // The road, run to its end: the name is severed on the record, not left with stamps and no
    // declaration (a container drop() alone leaves that, and every boot then fails to attach it).
    await hand.detach("kept for extraction");
    await gw.dropChannel(ch.name);
    expect(holds(ch.name, fact(1).id)).toBe(false);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
    expect(gw.channelStatus(ch.name)).toHaveLength(0);
  });
  it("status stamps struck by hand while the declaration stands: the refusal names the container handle's drop, which works, and a stale handle is not a pool", async () => {
    const { gw, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    for (const id of statusIds(gw, ch.name))
      await gw.append([signClaims(makeNegationClaims(OP, gw.nextTimestamp(), id), SEED)]);
    expect(gw.channelStatus(ch.name)).toHaveLength(0);
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toContain("its pool's declaration still stands");
    expect(refusal).toContain("drop it through its container handle");
    expect(refusal).not.toContain('dropChannel "');
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/severed/);
    // The handle's drop purges the store and strikes the declaration. The map still holds the
    // dropped handle; the erase reads it as no pool, as the drop would, and proceeds.
    await ch.pool.drop();
    expect(holds(ch.name, fact(1).id)).toBe(false);
    expect(gw.channelPools.get(ch.name)).toBeDefined();
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
  it("status stamps and declaration struck by hand, no handle: the refusal names a fresh open, which attaches the store; the drop then purges it and the erase proceeds", async () => {
    const first = await home();
    const { ch, offering } = await channel(first.gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(first.gw, ch.name).opening;
    const struck = [
      ...survivingDeclarationIds(first.gw.reactor, OP, ch.name),
      ...statusIds(first.gw, ch.name),
    ];
    for (const id of struck)
      await first.gw.append([
        signClaims(makeNegationClaims(OP, first.gw.nextTimestamp(), id), SEED),
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
  it("a drop whose declaration strike failed after the purge completes on re-run, and then the opening can be erased", async () => {
    const { gw, primary, holds } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    expect(holds(ch.name, fact(1).id)).toBe(true);
    primary.failNextRetraction = true;
    // The purge ran and the store closed; only the strike failed, so the declaration stands.
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(
      /discarded .* at the bytes .* could not be struck/,
    );
    expect(holds(ch.name, fact(1).id)).toBe(false);
    expect(survivingDeclarationIds(gw.reactor, OP, ch.name)).not.toEqual([]);
    // Still live: the declaration stands over a store the sweep cannot reach, so the erase refuses
    // up front (§27.7's completeness guard) and removes nothing.
    const refusal = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(refusal).toMatch(/refused/);
    expect(refusal).toContain(ch.name);
    expect(gw.reactor.get(opening.id)).toBeDefined();
    await gw.dropChannel(ch.name);
    expect(survivingDeclarationIds(gw.reactor, OP, ch.name)).toEqual([]);
    await gw.erase(opening.id);
    expect(gw.reactor.get(opening.id)).toBeUndefined();
  });
});
