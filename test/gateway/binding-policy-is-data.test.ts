// §47 criteria 11, 12 and 13, in one file because they are three faces of one promise: the policy
// is DATA. Changing it is a delta and the next read obeys it (11); a store that declares nothing
// keeps today's behavior whole, refusal included (12); and the declaration accepts a container
// qualifier now so per-container policy is a later delta rather than a migration (13).

import { describe, expect, it } from "vitest";
import { signClaims, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims, readBindingPolicy } from "../../src/gateway/binding-policy.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

const store = (): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }));

describe("§47 — the policy is data", () => {
  it("criterion 12: an undeclared store refuses a contested publish exactly as it always has", async () => {
    const gw = await store();
    try {
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      // No declaration: the second publish is REFUSED at the trial build, today's behavior whole.
      await expect(
        gw.publishRegistration(
          { name: "Two", alg: 1, body: PLANT.body },
          named("Shared"),
          [FERN],
          undefined,
          "hyperschema:Two",
        ),
      ).rejects.toThrow(/collides/);
      expect(gw.def("Shared").entity).toBe("hyperschema:One");
    } finally {
      await gw.close();
    }
  });

  it("criterion 11: declaring the policy is a delta, and the NEXT publish obeys it — no restart", async () => {
    const gw = await store();
    try {
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      // Same live gateway; the declaration lands as an ordinary append...
      await gw.append([
        signClaims(
          bindingPolicyClaims("byTimestamp", gw.operatorAuthor!, gw.nextTimestamp()),
          OP_SEED,
        ),
      ]);
      // ...and the publish that was a refusal a moment ago is now a resolved contest.
      const second = await gw.publishRegistration(
        { name: "Two", alg: 1, body: PLANT.body },
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      expect(second.bound).toBe(true);
      expect(gw.def("Shared").entity).toBe("hyperschema:Two");
    } finally {
      await gw.close();
    }
  });

  it("criterion 13: a container-qualified declaration does not govern the root, and vice versa", async () => {
    const gw = await store();
    try {
      await gw.append([
        signClaims(
          bindingPolicyClaims("conflicts", gw.operatorAuthor!, gw.nextTimestamp(), "friends"),
          OP_SEED,
        ),
      ]);
      // Qualified for "friends": the ROOT reads undeclared, so root behavior is unchanged...
      expect(readBindingPolicy(gw.reactor, gw.operatorAuthor)).toBeUndefined();
      // ...and the qualified reading answers — the later per-container delta, already expressible.
      expect(readBindingPolicy(gw.reactor, gw.operatorAuthor, "friends")).toBe("conflicts");
    } finally {
      await gw.close();
    }
  });

  it("a malformed declaration is refused at the door, not read as something else", async () => {
    // The trust idiom's posture: a predicate sees pointers, so the DOOR owns shape. A mode outside
    // the vocabulary must refuse — read as "undeclared" it would silently keep old behavior while
    // sitting in the audit looking like law.
    const gw = await store();
    try {
      await expect(
        gw.append([
          signClaims(
            {
              timestamp: gw.nextTimestamp(),
              author: gw.operatorAuthor!,
              pointers: [
                {
                  role: "declares",
                  target: {
                    kind: "entity",
                    entity: { id: "loam:binding-policy", context: "loam.binding-policy" },
                  },
                },
                { role: "mode", target: { kind: "primitive", value: "newestUnlessTuesday" } },
              ],
            },
            OP_SEED,
          ),
        ]),
      ).rejects.toThrow(/exactly one mode/);
    } finally {
      await gw.close();
    }
  });
});
