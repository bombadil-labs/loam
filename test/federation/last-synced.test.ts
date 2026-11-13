import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

async function store(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: "cc".repeat(32), registrations: [] }),
  );
}
const dead = { pull: () => Promise.reject(new Error("peer unreachable: connect ECONNREFUSED")) };
const quiet = { pull: () => Promise.resolve([]) };

describe("§46 — a channel says when it last succeeded", () => {
  it("a successful sync stamps lastSyncedAt and clears the failure count", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      await ch.sync();
      const [status] = gw.channelStatus(ch.name);
      expect(status).toBeDefined();
      expect(status!.lastSyncedAt).toBeGreaterThan(0);
      expect(status!.consecutiveFailures).toBe(0);
    } finally {
      await gw.close();
    }
  });

  it("an unreachable peer RAISES the failure count and does not stamp a success", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: dead });
      await expect(ch.sync()).rejects.toThrow(/unreachable/);
      await expect(ch.sync()).rejects.toThrow(/unreachable/);
      const [status] = gw.channelStatus(ch.name);
      expect(status!.consecutiveFailures).toBe(2);
      expect(status!.lastSyncedAt).toBe(0);
    } finally {
      await gw.close();
    }
  });

  it("a quiet peer and an unreachable peer are DISTINGUISHABLE after the same visible result", async () => {
    const gw = await store();
    try {
      const quietCh = await gw.openChannel({ into: "friends", prefix: "quiet", source: quiet });
      const deadCh = await gw.openChannel({ into: "friends", prefix: "dead", source: dead });
      const report = await quietCh.sync();
      await deadCh.sync().catch(() => undefined);

      expect(report.accepted).toBe(0);
      const q = gw.channelStatus(quietCh.name)[0]!;
      const d = gw.channelStatus(deadCh.name)[0]!;
      expect(q.consecutiveFailures).toBe(0);
      expect(d.consecutiveFailures).toBe(1);
    } finally {
      await gw.close();
    }
  });

  it("the channel record is DELTAS — it survives a fresh read of the ground", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({ into: "friends", prefix: "alice", source: quiet });
      await ch.sync();
      const held = [...gw.reactor.snapshot()].some((d) =>
        d.claims.pointers.some((p) => p.role === "lastSyncedAt"),
      );
      expect(held).toBe(true);
    } finally {
      await gw.close();
    }
  });
});
