// T288 regression: a received operand can become unavailable without revoking the exact
// channel lifecycle's cleanup authority. Only this test's in-memory stores are erased/dropped.
import { describe, expect, it } from "vitest";
import { verifyDelta, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { localChannelEvidence } from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "cc".repeat(32);
const PEER_SEED = "a1".repeat(32);
const EVENT = "loam.local.channel.event";
function localEvents(gw: Gateway, name: string, action: string): Delta[] {
  return [...gw.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "event" &&
          p.target.kind === "entity" &&
          p.target.entity.context === EVENT &&
          p.target.entity.id === `channel:${name}`,
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "action" && p.target.kind === "primitive" && p.target.value === action,
      ),
  );
}
const ids = (deltas: readonly Delta[]) => deltas.map((d) => d.id).sort();

describe("T288 channel cleanup after real received-source erasure", () => {
  it("closes the exact valid lifecycle before purging despite unavailable receive evidence; root and sibling keep working", async () => {
    const primary = new MemoryBackend();
    const gw = await Gateway.boot(
      primary,
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
      { channelBackend: () => new MemoryBackend() },
    );
    try {
      const root = observed(FERN, "height", 10, 1000, OP_SEED);
      const erasedSource = observed(FERN, "height", 20, 2000, PEER_SEED);
      const siblingSource = observed(FERN, "height", 30, 3000, PEER_SEED);
      await gw.append([root]);
      const target = await gw.openChannel({
        into: "friends",
        prefix: "target",
        source: { pull: () => Promise.resolve([erasedSource]) },
      });
      const siblingOffer = [siblingSource];
      const sibling = await gw.openChannel({
        into: "friends",
        prefix: "sibling",
        source: { pull: () => Promise.resolve([...siblingOffer]) },
      });
      expect((await target.sync()).accepted).toBe(1);
      expect((await sibling.sync()).accepted).toBe(1);
      const initial = localChannelEvidence(gw, target.name);
      expect(initial.state).toBe("open");
      if (initial.state !== "open")
        throw new Error("target must have a valid exact opening before erasure");
      expect(ids(initial.received)).toEqual([erasedSource.id]);
      const siblingBefore = localChannelEvidence(gw, sibling.name);
      expect(siblingBefore.state).toBe("open");
      const receipt = localEvents(gw, target.name, "received")[0]!;
      const targetPool = target.pool.gateway!;
      const targetBackend = targetPool.backend;

      // Existing root erase requires root-held target bytes. Holding the exact already-received
      // source here does not invent custody; the real earlier channel sync proved that custody.
      await gw.federate([erasedSource]);
      const erase = await gw.erase(erasedSource.id);
      expect(erase.citations).toContain(receipt.id);
      expect(await primary.holds(erasedSource.id)).toBe(false);
      expect(await targetBackend.holds(erasedSource.id)).toBe(false);
      expect(gw.reactor.get(receipt.id)).toBeDefined();
      expect(gw.reactor.get(initial.opening.id)).toBeDefined();
      expect(gw.reactor.get(initial.opening.statusAtOpen)).toBeDefined();
      expect(gw.reactor.get(initial.opening.poolDeclaration)).toBeDefined();
      expect(gw.channelPools.get(target.name)).toBe(target.pool);
      expect(gw.channelStatus(target.name)).toHaveLength(1);
      const unavailable = localChannelEvidence(gw, target.name);
      expect(unavailable.state).toBe("unavailable");
      if (unavailable.state === "unavailable")
        expect(unavailable.reason).toContain(erasedSource.id);
      expect(unavailable).not.toHaveProperty("received");
      expect(localChannelEvidence(gw, sibling.name)).toEqual(siblingBefore);
      expect(await primary.holds(root.id)).toBe(true);
      expect(await sibling.pool.gateway!.backend.holds(siblingSource.id)).toBe(true);

      // Install the observer AFTER source erasure: it witnesses drop's actual physical purge,
      // not the earlier exact-ID erasure. The backend still contains ordinary seeded bytes.
      expect((await targetBackend.deltasSince(new Set())).length).toBeGreaterThan(0);
      const purge = targetBackend.purge.bind(targetBackend);
      let purges = 0;
      targetBackend.purge = async (batch) => {
        purges++;
        const closes = localEvents(gw, target.name, "close");
        expect(closes).toHaveLength(1);
        const close = closes[0]!;
        expect(verifyDelta(close)).toBe("verified");
        expect(await primary.holds(close.id)).toBe(true);
        expect(close.claims.pointers).toEqual([
          {
            role: "event",
            target: {
              kind: "entity",
              entity: { id: `channel:${target.name}`, context: EVENT },
            },
          },
          { role: "version", target: { kind: "primitive", value: 1 } },
          { role: "action", target: { kind: "primitive", value: "close" } },
          {
            role: "opening",
            target: { kind: "delta", deltaRef: { delta: initial.opening.id } },
          },
          { role: "reason", target: { kind: "primitive", value: "drop" } },
        ]);
        expect(localChannelEvidence(gw, target.name).state).toBe("closed");
        const removed = await purge(batch);
        expect(await targetBackend.deltasSince(new Set())).toEqual([]);
        return removed;
      };
      await expect(gw.dropChannel(target.name)).resolves.toBeUndefined();
      expect(purges).toBe(1);
      expect(localEvents(gw, target.name, "close")).toHaveLength(1);
      expect(gw.channelPools.has(target.name)).toBe(false);
      expect(gw.channelStatus(target.name)).toEqual([]);
      expect(localChannelEvidence(gw, target.name).state).toBe("unavailable");
      expect(gw.reactor.get(receipt.id)).toBeDefined();
      expect(await primary.holds(root.id)).toBe(true);
      expect(localChannelEvidence(gw, sibling.name)).toEqual(siblingBefore);
      expect(await sibling.pool.gateway!.backend.holds(siblingSource.id)).toBe(true);
      const next = observed(FERN, "height", 40, 4000, PEER_SEED);
      siblingOffer.push(next);
      expect((await sibling.sync()).accepted).toBe(1);
      const siblingAfter = localChannelEvidence(gw, sibling.name);
      expect(siblingAfter.state).toBe("open");
      if (siblingAfter.state === "open")
        expect(ids(siblingAfter.received)).toEqual([siblingSource.id, next.id].sort());
      const nextRoot = observed(FERN, "height", 50, 5000, OP_SEED);
      await gw.append([nextRoot]);
      expect(await primary.holds(nextRoot.id)).toBe(true);
      expect(await primary.holds(root.id)).toBe(true);
    } finally {
      await gw.close();
    }
  });
});
