// T193 — a channel lens is scoped in `gatherImpl` and NOWHERE ELSE, so the doors that resolve their
// own ground REFUSE it rather than answering from the wrong one.
//
// MEASURED before the guard existed, and this is why it is a refusal rather than a note:
//
//   query        { alice_Plant(entity: FERN) { height } }  ->  11   (alice's, correct)
//   subscription { alice_Plant(entity: FERN) { height } }  -> 999   (the receiver's OWN claim)
//
// The subscription resolved the peer's gather body against the receiver's ground. With that lens
// declared public it is an operator's private data streamed to a stranger. A refusal is always
// available; a disclosure is not recoverable.

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

/** A receiver holding a channel lens AND a private claim of its own at the same entity. */
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
  // Never federated to anyone. The number that must not escape.
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
    // Two-sided: the guard must not have been bought by breaking the door that works. 11 is alice's;
    // 999 is mine and must not appear.
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
    // The guard keys on the channel prefix, so an ordinary lens must be untouched — otherwise the
    // refusal would be a blanket one and every subscription in the store would break.
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
    // The closure grounds were narrowed to the pool alone: containerScope asks whoever CONTRIBUTED
    // deltas, and requesting one pool makes that pool the only ground. But
    // `withNegationClosureAcross` exists precisely because a strike of an admitted delta can live in
    // ANY of them — and the receiver's own ground is one. Reachable when a receiver both channels a
    // peer and federates with them directly: the retraction lands here while the channel is frozen
    // or has not polled.
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

      // Alice retracts, and the strike reaches THIS store directly rather than through the pool.
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
      // The reader must not see a claim this store holds a surviving strike for.
      expect((after.data as { alice_Plant: { height: unknown } }).alice_Plant.height).not.toBe(42);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
