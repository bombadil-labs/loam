import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

describe("§46 — subscribing to a source that never minted an offer", () => {
  it("reaches the same state an accepted offer would", async () => {
    const publisher = await store("a1".repeat(32));
    const viaOffer = await store("b0".repeat(32));
    const viaSubscribe = await store("cc".repeat(32));
    try {
      await publisher.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const feed = { pull: () => Promise.resolve(publisher.reactor.arrivalLog()) };

      const offered = await viaOffer.openChannel({ into: "friends", prefix: "src", source: feed });
      const subscribed = await viaSubscribe.openChannel({
        into: "feeds",
        prefix: "src",
        source: feed,
      });
      const a = await offered.sync();
      const b = await subscribed.sync();

      expect(a.accepted).toBe(b.accepted);
      expect(a.bound).toEqual(b.bound);
      expect(a.bound).toContain("src:Plant");
    } finally {
      await publisher.close();
      await viaOffer.close();
      await viaSubscribe.close();
    }
  });

  it("a subscriber may start WITHOUT blessing, and turn it on later", async () => {
    const publisher = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await publisher.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({
        into: "feeds",
        prefix: "src",
        bless: false,
        source: { pull: () => Promise.resolve(publisher.reactor.arrivalLog()) },
      });
      const first = await ch.sync();
      expect(first.accepted).toBeGreaterThan(0);
      expect(first.bound).toEqual([]);

      await me.setChannel(ch.name, { blessing: true });
      expect((await ch.sync()).bound).toContain("src:Plant");
    } finally {
      await publisher.close();
      await me.close();
    }
  });
});
