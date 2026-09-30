// The store: one per tree of containers, holding the links between them, each container's table of
// children, and the per-channel commit order (refactor/audit/step6-container-split.md). A container
// asks the store for its parent, its root and its children; it never walks another container's
// members. What container code may use of a child is the Peer type, which the compiler holds.

import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { describe, expect, it, vi } from "vitest";
import { containerClaims } from "../../src/gateway/container-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "7e".repeat(32);
const OP = authorForSeed(SEED);
const host = () => Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));

describe("the store of a container tree", () => {
  it("one store for the tree; links, roots and holds follow attach and detach", async () => {
    const gw = await host();
    const p = (await gw.openQuarantine()).gateway;
    const q = (await p.openQuarantine()).gateway;
    expect(p.store).toBe(gw.store);
    expect(q.store).toBe(gw.store);
    expect(gw.store.parentOf(q)).toBe(p);
    expect(gw.store.rootOf(q)).toBe(gw);
    expect(gw.store.verifiedRootOf(q)).toBe(gw);
    expect(gw.store.holds(gw, p)).toBe(true);
    expect(gw.store.holds(gw, q)).toBe(false); // q is p's, not gw's
    // A link the parent no longer holds breaks the verified chain; the unverified one still climbs.
    gw.quarantinePools.delete(p);
    expect(gw.store.verifiedRootOf(q)).toBeUndefined();
    expect(gw.store.rootOf(q)).toBe(gw);
    gw.quarantinePools.add(p);
    gw.store.detach(p);
    expect(gw.store.parentOf(p)).toBeUndefined();
    expect(gw.store.holds(gw, p)).toBe(false);
    await gw.close();
  });

  it("commits on one channel run in order across the tree; another channel does not wait", async () => {
    const gw = await host();
    const p = (await gw.openQuarantine()).gateway;
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = gw.store.commit(gw, "a", async () => {
      await gate;
      order.push("a1");
    });
    const second = gw.store.commit(p, "a", () => Promise.resolve(void order.push("a2")));
    const other = gw.store.commit(p, "b", () => Promise.resolve(void order.push("b1")));
    await other;
    expect(order).toEqual(["b1"]); // "b" did not wait behind "a"
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["b1", "a1", "a2"]); // p's "a" waited for gw's "a": one queue per root
    await gw.close();
  });

  it("each container's children live in the store's table; the gateway only reads it", async () => {
    const gw = await host();
    const other = await host();
    const p = (await gw.openQuarantine()).gateway;
    const q = (await p.openQuarantine()).gateway;
    expect(gw.quarantinePools).toBe(gw.store.tableOf(gw).pools);
    expect(p.quarantinePools).toBe(gw.store.tableOf(p).pools); // p's table is in the tree's store
    expect([...gw.store.pools(gw)]).toEqual([p]);
    expect([...gw.store.pools(p)]).toEqual([q]);
    // Another tree has another store, and none of this one's children.
    expect(other.store).not.toBe(gw.store);
    expect([...other.store.pools(other)]).toEqual([]);
    expect(gw.store.hasPool(gw, p)).toBe(true);
    expect(gw.store.hasPool(gw, q)).toBe(false);
    await other.close();
    await gw.close();
  });

  it("a table view taken before any child attaches is live", async () => {
    const gw = await host();
    const p = (await gw.openQuarantine()).gateway;
    const pools = gw.store.pools(p);
    const channels = gw.store.channels(p);
    const q = (await p.openQuarantine()).gateway;
    expect(pools.has(q)).toBe(true);
    gw.store.setChannel(p, "channel:y", { trust: "curated", posture: "separate" } as never);
    expect(channels.has("channel:y")).toBe(true);
    await gw.close();
  });

  it("the authority for a container is its verified root, and nothing for a root or a broken chain", async () => {
    const gw = await host();
    const p = (await gw.openQuarantine()).gateway;
    const q = (await p.openQuarantine()).gateway;
    expect(gw.store.authorityOf(gw)).toBeUndefined(); // a root answers for itself; nothing above it
    expect(gw.store.authorityOf(p)).toBe(gw);
    expect(gw.store.authorityOf(q)).toBe(gw);
    gw.quarantinePools.delete(p);
    expect(gw.store.authorityOf(q)).toBeUndefined();
    expect(gw.store.authorityOf(p)).toBeUndefined();
    gw.quarantinePools.add(p);
    gw.store.detach(p);
    expect(gw.store.authorityOf(p)).toBeUndefined();
    await gw.close();
  });

  it("the chain above a container runs nearest first and stops at a broken link or a loop", async () => {
    const gw = await host();
    const p = (await gw.openQuarantine()).gateway;
    const q = (await p.openQuarantine()).gateway;
    expect(gw.store.chainAbove(q)).toEqual([p, gw]);
    expect(gw.store.chainAbove(gw)).toEqual([]);
    gw.quarantinePools.delete(p); // gw no longer holds p: the walk stops below gw
    expect(gw.store.chainAbove(q)).toEqual([p]);
    gw.quarantinePools.add(p);
    // A loop (gw attached below q): each container is visited once, and the walk ends.
    gw.store.attach(gw, q);
    q.quarantinePools.add(gw);
    expect(gw.store.chainAbove(q)).toEqual([p, gw, q]);
    q.quarantinePools.delete(gw);
    gw.store.detach(gw);
    await gw.close();
  });

  it("a channel pool is recorded, read as a peer entry, and dropped through the store", async () => {
    const gw = await host();
    const handle = await gw.openQuarantine();
    const record = { ...handle, trust: "curated", posture: "separate" } as const;
    gw.store.setChannel(gw, "channel:x", record as never);
    expect(gw.store.channels(gw).get("channel:x")?.gateway).toBe(handle.gateway);
    expect(gw.channelPools.get("channel:x")).toBe(record); // the facade reads the same table
    gw.store.dropChannel(gw, "channel:x");
    expect(gw.store.channels(gw).size).toBe(0);
    await gw.close();
  });

  it("a container's declared children close with it, and its table forgets them", async () => {
    const gw = await host();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "commons", trust: "curated", posture: "separate" },
          OP,
          10_000,
        ),
        SEED,
      ),
    ]);
    const backend = new MemoryBackend();
    const closing = vi.spyOn(backend, "close");
    await gw.openContainer({ name: "commons", backend });
    expect(gw.store.namedPools(gw).size).toBe(1);
    await gw.close();
    expect(closing).toHaveBeenCalled();
    expect(gw.store.namedPools(gw).size).toBe(0);
  });
});
