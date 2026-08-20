// §46 criteria 13 and 14 — dropping ONE channel purges that peer and leaves the others intact.
//
// TWO-SIDED BY RULE, not by taste: every erasure rail in this repo proves the target is gone AND a
// named live bystander survives. A rail that only proves removal cannot see over-purging, which is
// the failure that matters most here — a wrong `>` costs a user their data with no way back.
//
// This is also the criterion that justifies one pool PER CHANNEL rather than one shared inbox. A
// shared inbox would make severing alice a filtered delete by author over a mixed ground; separate
// pools make it `drop()`, which purges at the bytes and REFUSES by name if any byte survives.

import { beforeEach, describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

// Handles captured AT OPEN TIME, keyed by pool name. `drop()` closes the store, so a handle fetched
// afterwards cannot answer — the probe has to hold the reference from the start. This is what lets
// the target side assert at the BYTES rather than at the gather: a drop that struck the pool's
// declaration and purged nothing satisfies every gather-level assertion (T40's shape).
const pools = new Map<string, MemoryBackend>();
// Cleared per test: `drop()` CLOSES the store it purged, so a backend reused across tests answers
// "this store is closed" rather than the question being asked.
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
      expect(await aliceBytes.holds(aliceClaim.id)).toBe(true); // the premise, asserted

      // WHERE THE TARGET'S BYTE-LEVEL PROOF LIVES, said plainly so nobody looks for it here:
      // `drop()` CLOSES the store it purged, so probing the same handle afterwards answers "this
      // store is closed" rather than the question. The target side is proven at the FILE in
      // test/federation/drop-cli.test.ts, which scans the pool's sqlite (and its -wal) for the
      // peer's marker after a CLI sever. What this rail contributes is the BYSTANDER at the bytes,
      // which that file also checks but which matters most here, where both pools are in one
      // process and a purge could reach across them.
      //
      // `drop()` itself byte-verifies and refuses by name on any survivor, so a drop that returns
      // at all is evidence about the target — it is simply not evidence this assertion can re-read.
      await me.dropChannel(one.name);

      const gathered = me.containerScope({ containers: ["friends"] }).map((d) => d.id);
      expect(gathered).not.toContain(aliceClaim.id);

      // SURVIVED, also at the bytes: bob's pool still holds his delta, and `friends` still serves it.
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

  it("dropping one channel does not reach across into another peer's law", async () => {
    // The title's real claim, and it holds. An earlier version staged both peers on IDENTICAL law
    // and asserted the second's binding survived — but with identical law the second name is never
    // created at all (T198), so it was asserting something that never existed. Marking it skipped
    // tripped rails-guard's suppression check, correctly: a disabled test in a rail is a hole
    // whether or not the person who left it meant well. (The guard scans for the marker as TEXT, so
    // even naming it in a comment trips it — hence this wording.)
    //
    // So it uses DISTINCT law, which is what the claim is actually about — a drop must not reach
    // sideways. T198's identical-law case is asserted in name-parked.test.ts against the
    // `witnessed` report, where it belongs.
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

      // The bystander's LAW still serves — dropping a channel is not a law-wide retraction.
      expect(me.def("bob:Sprout")).toBeDefined();
      // And the dropped peer's lens is GONE from the surface entirely. The binding — a drop purges bytes,
      // lived in the pool and left with it (S47 slice 3) — so the name resolves as never registered, and cannot fall back to this
      // store's own ground. Measured before the guard: it answered the receiver's private claim.
      const orphaned = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(orphaned.errors?.join(" ")).toMatch(/Cannot query field/);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });
});
