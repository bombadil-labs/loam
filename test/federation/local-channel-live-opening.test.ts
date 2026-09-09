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
// The boot-unattachable pool is not a case here: the base already refuses it as unreachable. The
// struck-declaration case measures both halves of the byte side: the attached pool, and the
// store reopened by name with no handle in memory (the fixture keeps one store per name, as the
// CLI's sqlite file does).
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { survivingDeclarationIds } from "../../src/gateway/container.js";
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
  isClosed = false;
  constructor(reopen?: FaultBackend) {
    super();
    // Reopening a closed store carries its bytes, the way a file on disk carries them.
    if (reopen !== undefined) for (const d of reopen.carried()) void super.append([d]);
  }
  private held: Delta[] = [];
  carried(): Delta[] {
    return this.held;
  }
  override async close(): Promise<void> {
    this.held = await super.deltasSince(new Set());
    this.isClosed = true;
    return super.close();
  }
  override async purge(ids: Iterable<string>): Promise<number> {
    if (this.purges >= this.failPurgeAfter) throw new Error("fixture purge failure");
    this.purges += 1;
    return super.purge(ids);
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
    return super.append(batch);
  }
}
async function home() {
  const primary = new FaultBackend();
  const pools = new Map<string, FaultBackend>();
  // ONE STORE PER NAME, like the CLI's sqlite file: a re-attach opens the same bytes. A closed store
  // is reopened carrying its bytes, so a byte check after a strike sees what the pool held.
  const gw = await Gateway.boot(
    primary,
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    {
      channelBackend: (name) => {
        const held = pools.get(name);
        if (held !== undefined && !held.isClosed) return held;
        const backend = new FaultBackend(held);
        pools.set(name, backend);
        return backend;
      },
    },
  );
  homes.push(gw);
  return { gw, primary, pools };
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
    const { gw, pools } = await home();
    const { ch, offering, pool } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    for (const id of survivingDeclarationIds(gw.reactor, OP, ch.name))
      await gw.append([signClaims(makeNegationClaims(OP, gw.nextTimestamp(), id), SEED)]);
    const attached = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(attached).toContain("its pool is still attached and holds bytes");
    expect(gw.reactor.get(opening.id)).toBeDefined();
    expect(pool.reactor.get(fact(1).id)).toBeDefined();
    // Cross-process: no handle in memory, the store on disk still holds the bytes.
    gw.federationChannels.delete(ch.name);
    gw.channelPools.delete(ch.name);
    expect(await pools.get(ch.name)!.holds(fact(1).id)).toBe(true);
    const unattached = await gw.erase(opening.id).catch((e: Error) => e.message);
    expect(unattached).toContain(
      "its pool's store still holds bytes although its declaration was struck",
    );
    expect(gw.reactor.get(opening.id)).toBeDefined();
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
  it("a drop whose declaration strike failed after the purge completes on re-run, and then the opening can be erased", async () => {
    const { gw, primary, pools } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact(1));
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    const store = pools.get(ch.name)!;
    expect(await store.holds(fact(1).id)).toBe(true);
    primary.failNextRetraction = true;
    // The purge ran and the store closed; only the strike failed, so the declaration stands.
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(
      /discarded .* at the bytes .* could not be struck/,
    );
    await expect(store.holds(fact(1).id)).rejects.toThrow(/closed/);
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
