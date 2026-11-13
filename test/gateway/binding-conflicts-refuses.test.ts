import { describe, expect, it } from "vitest";
import { signClaims, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { readContestedBindings } from "../../src/gateway/registration.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

describe("§47 — conflicts serves neither and names both", () => {
  it("the contested name leaves the surface, and the reader lists every contender", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
    );
    try {
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", gw.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
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
      expect(second.persisted).toBe(true);
      expect(second.bound).toBe(false);
      expect(() => gw.def("Shared")).toThrow();

      const contested = readContestedBindings(gw.reactor, gw.validityNow(), gw.operatorAuthor);
      const entities = (contested.get("Shared") ?? []).map((c) => c.entity).sort();
      expect(entities).toEqual(["hyperschema:One", "hyperschema:Two"]);
    } finally {
      await gw.close();
    }
  });

  it("an uncontested lens on the same store keeps serving — the withholding is per name", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
    );
    try {
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", gw.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      await gw.publishRegistration(
        { name: "Two", alg: 1, body: PLANT.body },
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      await gw.publishRegistration(
        { name: "Calm", alg: 1, body: PLANT.body },
        named("Calm"),
        [FERN],
        undefined,
        "hyperschema:Calm",
      );
      expect(gw.def("Calm")).toBeDefined();
      expect(
        readContestedBindings(gw.reactor, gw.validityNow(), gw.operatorAuthor).has("Calm"),
      ).toBe(false);
    } finally {
      await gw.close();
    }
  });
});
