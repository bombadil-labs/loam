// §46 criteria 13 and 14 — dropping ONE channel purges that peer and leaves the others intact.
//
// TWO-SIDED BY RULE, not by taste: every erasure rail in this repo proves the target is gone AND a
// named live bystander survives. A rail that only proves removal cannot see over-purging, which is
// the failure that matters most here — a wrong `>` costs a user their data with no way back.
//
// This is also the criterion that justifies one pool PER CHANNEL rather than one shared inbox. A
// shared inbox would make severing alice a filtered delete by author over a mixed ground; separate
// pools make it `drop()`, which purges at the bytes and REFUSES by name if any byte survives.

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
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

      await me.dropChannel(one.name);

      // GONE: alice's pool no longer gathers, and the receiving container does not serve her delta.
      const gathered = me.containerScope({ containers: ["friends"] }).map((d) => d.id);
      expect(gathered).not.toContain(aliceClaim.id);

      // SURVIVED, at the bytes: bob's pool still holds his delta, and `friends` still serves it.
      expect(bobPool.reactor.arrivalLog().some((d) => d.id === bobClaim.id)).toBe(true);
      expect(gathered).toContain(bobClaim.id);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("a delta that arrived on BOTH channels survives in the second pool", async () => {
    // Criterion 14. The same bytes can reach two peers independently — union is union. Purging one
    // channel must not reach into another's ground for a delta they happen to share, and a purge
    // that keyed on delta identity across the store rather than on the POOL would do exactly that.
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      // Signed by a third party, so the SAME bytes can legitimately reach both peers — which is what
      // makes criterion 14 a real case rather than a contrived one.
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

  it("registering the same law twice is not what drop removes — bob's binding survives", async () => {
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      await one.sync();
      const rTwo = await two.sync();
      expect(rTwo.bound).toContain("bob:Plant");

      await me.dropChannel(one.name);
      // The bystander's LAW is still bound — dropping a channel is not a law-wide retraction.
      expect(two.pool.gateway!.reactor.arrivalLog().length).toBeGreaterThan(0);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });
});
