import { describe, expect, it } from "vitest";
import { signClaims, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });
const S = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

describe("§47 — byAuthorRank at the door: the root's binding outranks a channel's", () => {
  it("the operator's LATER registration of a channel-held name wins under byAuthorRank", async () => {
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await me.append([
        signClaims(
          withStamp(me.stamp(), (t) => bindingPolicyClaims("byAuthorRank", me.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      expect(me.def("alice:Plant").entity).toBe("hyperschema:Plant");

      const mine = await me.publishRegistration(
        PLANT,
        {
          ...named("alice:Plant"),
          default: { kind: "all", order: { kind: "byTimestamp", dir: "desc" } },
        },
        [FERN],
        undefined,
        "hyperschema:MyOwn",
      );
      expect(mine.bound).toBe(true);
      expect(me.def("alice:Plant").entity).toBe("hyperschema:MyOwn");

      await me.append([observed(FERN, "height", 77, 99_000, OP_SEED)]);
      const read = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(read.errors, JSON.stringify(read)).toBeUndefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("two-sided: under byTimestamp the same later registration wins on recency, so the modes differ", async () => {
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await me.append([
        signClaims(
          withStamp(me.stamp(), (t) => bindingPolicyClaims("byAuthorRank", me.operatorAuthor!, t)),
          OP_SEED,
        ),
      ]);
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 11, 1000, "a1".repeat(32))]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      const read = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(read.errors, JSON.stringify(read)).toBeUndefined();
      expect((read.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(11);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
