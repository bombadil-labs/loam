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

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
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
