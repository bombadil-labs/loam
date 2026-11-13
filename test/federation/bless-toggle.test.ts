import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const OTHER = { name: "Sprout", alg: 1, body: PLANT.body } as const;

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

describe("§46 — pausing blessing", () => {
  it("stops new law binding and leaves law already bound in place", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const first = await ch.sync();
      expect(first.bound).toContain("alice:Plant");

      await me.setChannel(ch.name, { blessing: false });

      await alice.publishRegistration(OTHER, PLANT_POLICY, [FERN]);
      const paused = await ch.sync();

      expect(paused.accepted).toBeGreaterThan(0);
      expect(paused.bound).toEqual([]);
      const still = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(still.errors, JSON.stringify(still)).toBeUndefined();
      expect(me.def("alice:Plant")).toBeDefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("resuming blessing binds what arrived while it was paused", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        bless: false,
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const paused = await ch.sync();
      expect(paused.accepted).toBeGreaterThan(0);
      expect(paused.bound).toEqual([]);

      await me.setChannel(ch.name, { blessing: true });
      const resumed = await ch.sync();
      expect(resumed.accepted).toBe(0);
      expect(resumed.bound).toContain("alice:Plant");
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
