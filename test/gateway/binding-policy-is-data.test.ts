import { describe, expect, it } from "vitest";
import { signClaims, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims, readBindingPolicy } from "../../src/gateway/binding-policy.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

const store = (): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }));

describe("§47 — the policy is data", () => {
  it("criterion 12: an undeclared store refuses a contested publish exactly as it always has", async () => {
    const gw = await store();
    try {
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
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
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => bindingPolicyClaims("byTimestamp", gw.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
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
          withStamp(gw.stamp(), (t) =>
            bindingPolicyClaims("conflicts", gw.operatorAuthor!, t, "friends"),
          ),
          OP_SEED,
        ),
      ]);
      expect(readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor)).toBeUndefined();
      expect(readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor, "friends")).toBe(
        "conflicts",
      );
    } finally {
      await gw.close();
    }
  });

  it("a malformed declaration is refused at the door, not read as something else", async () => {
    const gw = await store();
    try {
      await expect(
        gw.append([
          signClaims(
            {
              ...gw.stamp(),
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

describe("§47 — a struck declaration stops governing (H1)", () => {
  it("striking the only declaration reverts the store to undeclared behavior", async () => {
    const gw = await store();
    try {
      const declared = await (async () => {
        const claims = withStamp(gw.stamp(), (t) =>
          bindingPolicyClaims("byTimestamp", gw.operatorAuthor!, t),
        );
        await gw.append([signClaims(claims, OP_SEED)]);
        return [...gw.reactor.snapshot()].find((d) =>
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.id === "loam:binding-policy",
          ),
        )!;
      })();
      expect(readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor)).toBe(
        "byTimestamp",
      );

      const { makeNegationClaims } = await import("@bombadil/rhizomatic");
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, declared.id)),
          OP_SEED,
        ),
      ]);
      expect(readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor)).toBeUndefined();
    } finally {
      await gw.close();
    }
  });

  it("striking the LATEST declaration revives the earlier one — latest-SURVIVING, not latest", async () => {
    const gw = await store();
    try {
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => bindingPolicyClaims("byTimestamp", gw.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", gw.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
      const conflictsDecl = [...gw.reactor.snapshot()].find(
        (d) =>
          d.claims.pointers.some(
            (p) =>
              p.role === "mode" && p.target.kind === "primitive" && p.target.value === "conflicts",
          ) && gw.reactor.negationsOf(d.id).length === 0,
      )!;
      expect(readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor)).toBe("conflicts");

      const { makeNegationClaims } = await import("@bombadil/rhizomatic");
      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, conflictsDecl.id)),
          OP_SEED,
        ),
      ]);
      expect(readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor)).toBe(
        "byTimestamp",
      );
    } finally {
      await gw.close();
    }
  });
});
