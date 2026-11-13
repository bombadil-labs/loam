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
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

describe("§46 — two channels into one receiving container", () => {
  it("both peers' law binds, each under its own prefix, neither shadowing the other", async () => {
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration({ name: "Sprout", alg: 1, body: PLANT.body }, PLANT_POLICY, [
        FERN,
      ]);

      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      const rOne = await one.sync();
      const rTwo = await two.sync();

      expect(rOne.bound).toContain("alice:Plant");
      expect(rTwo.bound).toContain("bob:Sprout");
      expect(rTwo.parked).toEqual([]);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("the receiving container gathers BOTH pools", async () => {
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration({ name: "Sprout", alg: 1, body: PLANT.body }, PLANT_POLICY, [
        FERN,
      ]);
      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      await one.sync();
      await two.sync();

      const gathered = me.containerScope({ containers: ["friends"] }).map((d) => d.id);
      const inAlice = alice.reactor.arrivalLog().some((d) => gathered.includes(d.id));
      const inBob = bob.reactor.arrivalLog().some((d) => gathered.includes(d.id));
      expect(inAlice).toBe(true);
      expect(inBob).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });
});
