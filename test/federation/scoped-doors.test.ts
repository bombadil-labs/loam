import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

async function receiverWithBoth(): Promise<{ alice: Gateway; me: Gateway; channel: string }> {
  const alice = await store("a1".repeat(32));
  const me = await store("cc".repeat(32));
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
  await alice.append([observed(FERN, "height", 11, 1000, "a1".repeat(32))]);
  const ch = await me.openChannel({
    into: "friends",
    prefix: "alice",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
  });
  await ch.sync();
  await me.append([observed(FERN, "height", 999, 5000, "cc".repeat(32))]);
  return { alice, me, channel: ch.name };
}

describe("T193 — doors that cannot scope refuse a channel lens", () => {
  it("a live subscription refuses rather than streaming the receiver's own ground", async () => {
    const { alice, me } = await receiverWithBoth();
    try {
      await expect(
        me.subscribe(`subscription { alice_Plant(entity: "${FERN}") { height } }`),
      ).rejects.toThrow(/federation channel/);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("the ordinary query door still answers, and answers the PEER's value", async () => {
    const { alice, me } = await receiverWithBoth();
    try {
      const answer = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(answer.errors, JSON.stringify(answer)).toBeUndefined();
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(11);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a lens of the receiver's OWN still subscribes normally", async () => {
    const me = await store("cc".repeat(32));
    try {
      await me.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const stream = await me.subscribe(`subscription { plant(entity: "${FERN}") { height } }`);
      expect(stream).toBeDefined();
      await stream.return?.(undefined);
    } finally {
      await me.close();
    }
  });
});

describe("T193 — a strike in the receiving store suppresses a pool claim", () => {
  it("a negation held HERE hides a delta served from the channel's pool", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const claim = observed(FERN, "height", 42, 1000, "a1".repeat(32));
      await alice.append([claim]);
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();
      const before = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect((before.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(42);

      const { makeNegationClaims, signClaims, authorForSeed } =
        await import("@bombadil/rhizomatic");
      await me.federate([
        signClaims(
          makeNegationClaims(authorForSeed("a1".repeat(32)), 2000, claim.id),
          "a1".repeat(32),
        ),
      ]);

      const after = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(after.errors, JSON.stringify(after)).toBeUndefined();
      expect((after.data as { alice_Plant: { height: unknown } }).alice_Plant.height).not.toBe(42);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
