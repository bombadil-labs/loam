// §46 criterion 2 — a receiver SUBSCRIBES to a source address with no offer having been minted, and
// reaches the same state as an accepted offer.
//
// Myk asked for both directions: someone can send me a federation request, or I can opt in to a
// source that is simply available (a friend who publishes, a public aggregator). They are the same
// act from the receiver's side — name a container, assign a prefix, start receiving — so they are
// ONE code path, and this rail exists to keep them one. A second path would drift, and the drift
// would land on whichever direction had fewer tests.
//
// The trust asymmetry is real and lives in the DEFAULT, not in the mechanism: an offer is a
// two-party act, a subscribe is unilateral. §46's R1 recommends blessing default-on for an accepted
// offer and default-off for a subscribe. Either way it is one toggle, and the rail pins that the
// caller's explicit choice wins over any default.

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

      // Two receivers, two framings, one mechanism.
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
    // The unilateral case: I opt in to your data without granting your law force on day one.
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
