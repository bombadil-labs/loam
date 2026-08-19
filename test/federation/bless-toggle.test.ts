// §46 criterion 10 — pausing blessing stops NEW law binding and leaves already-bound law serving.
//
// The two toggles are orthogonal on purpose (Myk's design): `receiving` governs whether a peer's
// bytes arrive, `blessing` governs whether law that arrives has force. Withdrawing a peer's
// authority WITHOUT severing the relationship is a state neither one switch nor `drop` can express,
// and it is the state you want the moment you distrust a peer's judgement but not their data.
//
// Two-sided in the direction that matters: pausing must not retroactively unbind. A pause that
// silently retired working law would break every reader of that lens, and would look like a
// "safer" implementation to anyone who did not read this comment.

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

      // Alice publishes a SECOND lens after the pause.
      await alice.publishRegistration(OTHER, PLANT_POLICY, [FERN]);
      const paused = await ch.sync();

      // The bytes still arrive — receiving was never touched.
      expect(paused.accepted).toBeGreaterThan(0);
      // The new law does NOT bind...
      expect(paused.bound).toEqual([]);
      // ...and the law bound before the pause is STILL SERVING. The previous assertion here was
      // `expect(Array.isArray(me.lawFrom([]))).toBe(true)` — lawFrom iterates its argument, so
      // lawFrom([]) is [] unconditionally and Array.isArray([]) is a tautology. Criterion 10's
      // second half was asserted by nothing, and a pause that retroactively unbound every law on
      // the channel passed. The door is the level that matters, so ask the door.
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
      // Nothing new crossed the wire, and yet law bound: blessing is about the pool's CONTENTS,
      // not about what this particular sync happened to carry.
      expect(resumed.accepted).toBe(0);
      expect(resumed.bound).toContain("alice:Plant");
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
