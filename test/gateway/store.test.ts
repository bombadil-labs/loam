// The store: one per tree of containers, holding the links between them and the per-channel commit
// order (refactor/audit/step6-container-split.md, step 3). A container asks the store for its
// parent and its root; it never walks another container's members.

import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "7e".repeat(32);
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
});
