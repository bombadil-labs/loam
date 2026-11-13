import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

describe("§46 — a channel receives into a nested pool", () => {
  it("the peer's deltas land in the channel's pool and the receiving container gathers them", async () => {
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    try {
      const claim = observed(FERN, "height", 62, 1000, GARDENER_SEED);
      await alice.append([claim]);

      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await channel.sync();
      expect(report.accepted).toBeGreaterThan(0);

      const gathered = bob.containerScope({ containers: ["friends"] });
      expect(gathered.some((d) => d.id === claim.id)).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the receiver's PRIMARY ground holds none of the peer's deltas", async () => {
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    try {
      const mine = observed(FERN, "height", 62, 1000, GARDENER_SEED);
      await alice.append([mine]);
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await channel.sync();

      const primary = bob.reactor.arrivalLog().map((d) => d.id);
      expect(primary).not.toContain(mine.id);
      expect(primary.length).toBeGreaterThan(0);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
