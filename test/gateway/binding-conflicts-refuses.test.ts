// §47 criterion 4 — under `conflicts` the contested name is NOT served, and the refusal names both
// candidates. The reader that carries the refusal is `readContestedBindings`: the name is absent
// from the surface, and this is where a person learns why and between whom — never a silent gap a
// caller mistakes for "no such lens".

import { describe, expect, it } from "vitest";
import { signClaims, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { readContestedBindings } from "../../src/gateway/registration.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

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
          bindingPolicyClaims("conflicts", gw.operatorAuthor!, gw.nextTimestamp()),
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
      expect(first.bound).toBe(true); // one candidate is no contest

      const second = await gw.publishRegistration(
        { name: "Two", alg: 1, body: PLANT.body },
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      // Persisted, and NEITHER serves: the second publish reports unbound...
      expect(second.persisted).toBe(true);
      expect(second.bound).toBe(false);
      // ...and the first stopped serving too — a contest has no incumbent advantage under
      // `conflicts`, or the mode would be first-writer-wins in a hat.
      expect(() => gw.def("Shared")).toThrow();

      // THE REFUSAL NAMES BOTH (criterion 4's exact words).
      const contested = readContestedBindings(gw.reactor, gw.operatorAuthor);
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
          bindingPolicyClaims("conflicts", gw.operatorAuthor!, gw.nextTimestamp()),
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
      // Two-sided: a mode that withheld everything would pass the rail above and be a dead store.
      expect(gw.def("Calm")).toBeDefined();
      expect(readContestedBindings(gw.reactor, gw.operatorAuthor).has("Calm")).toBe(false);
    } finally {
      await gw.close();
    }
  });
});
