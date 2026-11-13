import { beforeEach, describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const pools = new Map<string, MemoryBackend>();
beforeEach(() => pools.clear());

const backendFor = (pool: string): MemoryBackend => {
  const held = pools.get(pool) ?? new MemoryBackend();
  pools.set(pool, held);
  return held;
};
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: backendFor },
  );
}
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

describe("§46 — dropping one channel", () => {
  it("purges that peer's deltas at the BYTES and leaves a named bystander serving", async () => {
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      const aliceClaim = observed(FERN, "height", 62, 1000, "a1".repeat(32));
      const bobClaim = observed(FERN, "height", 71, 2000, "b0".repeat(32));
      await alice.append([aliceClaim]);
      await bob.append([bobClaim]);

      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      await one.sync();
      await two.sync();

      const bobPool = two.pool.gateway!;
      expect(bobPool.reactor.arrivalLog().some((d) => d.id === bobClaim.id)).toBe(true);

      const aliceBytes = pools.get(one.name)!;
      const bobBytes = pools.get(two.name)!;
      expect(await aliceBytes.holds(aliceClaim.id)).toBe(true);

      await me.dropChannel(one.name);

      const gathered = me.containerScope({ containers: ["friends"] }).map((d) => d.id);
      expect(gathered).not.toContain(aliceClaim.id);

      expect(await bobBytes.holds(bobClaim.id)).toBe(true);
      expect(bobPool.reactor.arrivalLog().some((d) => d.id === bobClaim.id)).toBe(true);
      expect(gathered).toContain(bobClaim.id);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("a delta that arrived on BOTH channels survives in the second pool", async () => {
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      const shared = observed(FERN, "height", 62, 1000, GARDENER_SEED);
      await alice.federate([shared]);
      await bob.federate([shared]);

      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      await one.sync();
      await two.sync();

      await me.dropChannel(one.name);

      const bobPool = two.pool.gateway!;
      expect(bobPool.reactor.arrivalLog().some((d) => d.id === shared.id)).toBe(true);
      expect(me.containerScope({ containers: ["friends"] }).map((d) => d.id)).toContain(shared.id);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("dropping one channel does not reach across into another peer's law", async () => {
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
      expect((await two.sync()).bound).toContain("bob:Sprout");

      await me.dropChannel(one.name);

      expect(me.def("bob:Sprout")).toBeDefined();
      const orphaned = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(orphaned.errors?.join(" ")).toMatch(/Cannot query field/);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });
});
