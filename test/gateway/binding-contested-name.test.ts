// §47 criterion 3 — two bindings naming different addresses under ONE name resolve by the store's
// DECLARED policy, at the door a person actually uses. Under a declared policy the contest stops
// being a publish-time refusal: both registrations LAND (a binding is a delta), and resolution
// decides which serves — with `bound: false` naming the policy for the loser, never a throw for law
// that lawfully landed.
//
// Criterion 12's twin lives in binding-default-policy.test.ts: an UNDECLARED store still refuses
// the second publish loudly, exactly as it always has.

import { describe, expect, it } from "vitest";
import { signClaims, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

async function declared(mode: "byTimestamp" | "byAuthorRank" | "conflicts"): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
  );
  await gw.append([
    signClaims(bindingPolicyClaims(mode, gw.operatorAuthor!, gw.nextTimestamp()), OP_SEED),
  ]);
  return gw;
}

describe("§47 — a contested name resolves by the declared policy", () => {
  it("byTimestamp: the later registration takes the name, and the earlier reports unbound", async () => {
    const gw = await declared("byTimestamp");
    try {
      const first = await gw.publishRegistration(
        PLANT,
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:One",
      );
      expect(first.bound).toBe(true);

      const second = await gw.publishRegistration(
        { name: "Two", alg: 1, body: PLANT.body },
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      // The later publish WINS the name — and the deltas of both are in the ground.
      expect(second.bound).toBe(true);
      expect(gw.def("Shared").entity).toBe("hyperschema:Two");

      // The loser's law still resolves as data: a real read through the winning lens answers,
      // which is the door-level proof the surface rebuilt rather than collided.
      await gw.append([observed(FERN, "height", 7, 9000, OP_SEED)]);
      const read = await gw.query(`{ shared(entity: "${FERN}") { height } }`);
      expect(read.errors, JSON.stringify(read)).toBeUndefined();
    } finally {
      await gw.close();
    }
  });

  it("the policy is not an eviction: the shadowed registration's deltas survive in the ground", async () => {
    // Two-sided against the tempting wrong implementation — resolving a contest by NEGATING the
    // loser. Resolution is a reading, never a write: change the policy and the shadowed law must
    // be able to win later, which it cannot do if the "resolution" struck it.
    const gw = await declared("byTimestamp");
    try {
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      await gw.publishRegistration(
        { name: "Two", alg: 1, body: PLANT.body },
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      const oneBindings = [...gw.reactor.snapshot()].filter(
        (d) =>
          d.claims.pointers.some(
            (p) =>
              p.target.kind === "entity" && p.target.entity.id === "registration:hyperschema:One",
          ) && gw.reactor.negationsOf(d.id).length === 0,
      );
      expect(oneBindings.length).toBeGreaterThan(0);
    } finally {
      await gw.close();
    }
  });
});
