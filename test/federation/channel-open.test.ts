// §46 criteria 1 and 15 — a federation channel lands a peer's deltas in a NESTED POOL inside the
// receiving container, and the receiver's PRIMARY GROUND holds none of them.
//
// Both levels, because either alone misses the bug this design exists to prevent. The delta level
// asks where the bytes actually went; the object level asks what a reader of the receiving container
// resolves. A pool that gathered correctly while quietly mixing the peer's deltas into the primary
// ground would pass an object-level check and make `drop` a filtered delete forever after (§27's
// drop is a physical purge, and it can only stay one if the bytes were never mixed).

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

describe("§46 — a channel receives into a nested pool", () => {
  it("the peer's deltas land in the channel's pool and the receiving container gathers them", async () => {
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    try {
      await alice.append([observed(FERN, "height", 62, 1000, GARDENER_SEED)]);

      // Bob names ONE receiving container and points a channel at alice.
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await channel.sync();
      expect(report.accepted).toBeGreaterThan(0);

      // OBJECT LEVEL: a reader of the receiving container sees the peer's claim.
      const gathered = bob.containerScope({ containers: ["friends"] });
      expect(gathered.some((d) => d.id === alice.reactor.arrivalLog()[0]!.id)).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the receiver's PRIMARY ground holds none of the peer's deltas", async () => {
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    try {
      const mine = observed(FERN, "height", 62, 1000, GARDENER_SEED);
      await alice.append([mine]);
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await channel.sync();

      // DELTA LEVEL: the bytes are in the pool, not in bob's own ground.
      const primary = bob.reactor.arrivalLog().map((d) => d.id);
      expect(primary).not.toContain(mine.id);
      // Two-sided: bob's own ground is not empty either — the channel did not swallow his store.
      expect(primary.length).toBeGreaterThan(0);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
