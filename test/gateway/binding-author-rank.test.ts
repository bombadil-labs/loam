// §47 criterion 5, at the DOOR — the rail the interpreter-level pin has been waiting for. In a
// governed store every binding is operator-SIGNED, so raw author rank was vacuous (the suppression
// lens confirmed it, and T202 carries the standing warning that this rail must land IN THE SAME
// CHANGE that makes non-root bindings reachable). Container aggregation is that change: a channel
// pool's blessed bindings now reach the surface, and RANK means WHOSE ACT PLACED THE BINDING — a
// direct registration at the root outranks law that arrived by federation, whoever signed the
// blessing. That is Myk's "mine outranks a peer's", made precise.

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
          bindingPolicyClaims("byAuthorRank", me.operatorAuthor!, me.nextTimestamp()),
          OP_SEED,
        ),
      ]);
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      expect(me.def("alice:Plant").entity).toBe("hyperschema:Plant");

      // The operator then registers DIFFERENT-content law at the very name the channel serves —
      // LATER, so recency argues for the channel and rank must overrule it, or the mode is
      // byTimestamp in a hat (the interpreter rail's exact adversarial shape, now at the door).
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

      // And the read serves through MY law over MY ground — the peer's claims no longer answer
      // this name, which is what "outranks" means at the level a person meets it.
      await me.append([observed(FERN, "height", 77, 99_000, OP_SEED)]);
      const read = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      expect(read.errors, JSON.stringify(read)).toBeUndefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("two-sided: under byTimestamp the same later registration wins on recency, so the modes differ", async () => {
    // Without this leg, byAuthorRank passing above could be recency in disguise — the operator's
    // registration IS later. Here the same staging under byTimestamp must produce the same winner
    // for a DIFFERENT reason, so the discriminating case is rank overruling an EARLIER root
    // binding... which cannot be staged until a channel can outrank the root under some mode. What
    // CAN be pinned: the channel's binding still serves when nothing contests it, mode declared.
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await me.append([
        signClaims(
          bindingPolicyClaims("byAuthorRank", me.operatorAuthor!, me.nextTimestamp()),
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
