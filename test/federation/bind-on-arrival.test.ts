import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

async function aliceWithPlant(): Promise<Gateway> {
  const alice = await store(ALICE_SEED);
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
  return alice;
}

describe("§46 — law arriving on a channel binds under the receiver's name", () => {
  it("alice's Plant binds at alice:Plant, and bob registered nothing", async () => {
    const alice = await aliceWithPlant();
    const bob = await store(BOB_SEED);
    try {
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await channel.sync();
      expect(report.accepted).toBeGreaterThan(0);

      expect(report.bound).toContain("alice:Plant");
      expect(report.bound).not.toContain("Plant");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("T189 — and SERVES: a read of alice's data resolves through bob's own surface", async () => {
    const alice = await aliceWithPlant();
    const bob = await store(BOB_SEED);
    try {
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await channel.sync();
      expect(report.bound).toContain("alice:Plant");

      const answer = await bob.query('{ alice_Plant(entity: "' + FERN + '") { height } }');
      expect(answer.errors).toBeUndefined();
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a receiver's OWN lens still resolves over the primary ground", async () => {
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 99, 2000, BOB_SEED)]);
      const answer = await bob.query('{ plant(entity: "' + FERN + '") { height } }');
      expect(answer.errors).toBeUndefined();
      expect((answer.data as { plant: { height: unknown } }).plant.height).toBe(99);
    } finally {
      await bob.close();
    }
  });

  it("blessing OFF leaves the deltas landed and the law unbound", async () => {
    const alice = await aliceWithPlant();
    const bob = await store(BOB_SEED);
    try {
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        bless: false,
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await channel.sync();
      expect(report.accepted).toBeGreaterThan(0);
      expect(report.bound).toEqual([]);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
