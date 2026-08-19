// §46 criterion 4 — law that arrives on a channel BINDS, under a name the receiver assigned.
//
// This is the criterion the whole design exists for. Before it, a peer's registration federated as
// bytes and bound nothing: bob pulled alice's deltas and his store answered "nothing is registered
// ... foreign law is inert on a governed store" (§28), and the only way out was for bob to register
// his own equivalent schema — making him the author of law he did not write.
//
// Naming does not travel. Law identity excludes the living name (`schemaLawAddress`), so what
// crosses is a content address and the RECEIVER names it. Here alice's `Plant` binds at `alice:Plant`
// because bob assigned the prefix `alice`, not because alice asked for it.
//
// Two-sided: bob registered nothing himself, AND a second peer's identically-named law does not
// collide with alice's (that is criterion 9's rail, referenced here so the pair is visible).
//
// THE HALF THIS FILE DOES NOT PROVE, and it is half of criterion 4: law BINDS here, and it does not
// yet SERVE. The lens gathers over the receiving store's primary ground, while a channel's deltas
// live in its pool — so the GraphQL field appears and resolves null. Found by driving the CLI end to
// end after these rails were green, which is exactly the gap unit rails cannot see. T189 carries it,
// with the measured trace and the fix that must NOT be taken (mirroring into the primary ground
// would satisfy the read and destroy criterion 15). The skipped rail below is the visible hole.

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

      // The bound living names include the prefixed one, and NOT the bare one.
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
      // Alice has a real observation, not only a schema — the null this rail exists to catch was a
      // bound lens over an empty ground.
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
      // The VALUE, not merely a served field: `{"height": null}` was the bug.
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a receiver's OWN lens still resolves over the primary ground", async () => {
    // Two-sided, and the half that keeps the fix honest: the scoped path must be entered ONLY by
    // law that arrived through a channel. A change that scoped every lens would pass the rail above
    // and quietly break every ordinary read.
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
      // Two-sided: the bytes arrived (admission), and nothing bound (effectiveness). The two axes
      // are separate (§28.1), and a channel that conflated them would pass one half of this.
      expect(report.accepted).toBeGreaterThan(0);
      expect(report.bound).toEqual([]);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
