// §47 criterion 9 — A PEER'S TWO READINGS OVER ONE HYPERSCHEMA ENTITY ARRIVE AS TWO BINDINGS.
//
// T197's measured collapse: bindArrived derived one manifest alias per ENTITY, and classify picked
// among an entity's bindings by `.at(-1)` — so a peer publishing sibling lenses (§21.7 coexistence,
// two readings sharing one definition) federated as ONE lens, the other not parked, not refused,
// simply invisible. H6 one layer down: the alias, and so the name a reader could ask by, was
// derived from the PROGRAM's address rather than from the READING.
//
// Now the manifest is minted per LENS — read from each binding's own `schema:<name>` bytes, the
// same read every other H6-correct site uses — and classify selects the binding whose lens matches
// the row's alias, falling back to latest for a module whose alias is not a lens name.

import { describe, expect, it } from "vitest";
import type { Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "../gateway/fixtures.js";

const S = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

describe("§47 — sibling lenses federate as siblings", () => {
  it("two readings at one entity arrive as two bound names, and each serves ITS OWN reading", async () => {
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      // §21.7 coexistence: one definition, two readings with DIFFERENT resolution — the latest
      // height, and every height. Distinct policies are what make the two names distinguishable at
      // the door, so a collapse cannot hide behind identical answers.
      const latest: Schema = {
        props: new Map([["height", pickLatest]]),
        default: pickLatest,
        name: "Plant",
      };
      const every: Schema = {
        props: new Map([["height", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }]]),
        default: pickLatest,
        name: "AllPlant",
      };
      await alice.publishRegistration(PLANT, latest, [FERN], undefined, "hyperschema:Plant");
      await alice.publishRegistration(PLANT, every, [FERN], undefined, "hyperschema:Plant");
      await alice.append([
        observed(FERN, "height", 10, 1000, "a1".repeat(32)),
        observed(FERN, "height", 20, 2000, "a1".repeat(32)),
      ]);

      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const report = await ch.sync();

      // BOTH names bind — the collapse left the second invisible, neither parked nor refused.
      expect(report.bound).toContain("alice:Plant");
      expect(report.bound).toContain("alice:AllPlant");

      // And each serves ITS reading over the same pool: the latest height through one name, every
      // height through the other. Same law, same data, two lenses — §21.7 across a channel.
      const one = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      const all = await me.query(`{ alice_AllPlant(entity: "${FERN}") { height } }`);
      expect(one.errors, JSON.stringify(one)).toBeUndefined();
      expect(all.errors, JSON.stringify(all)).toBeUndefined();
      expect((one.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(20);
      expect((all.data as { alice_AllPlant: { height: unknown } }).alice_AllPlant.height).toEqual([
        10, 20,
      ]);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("two-sided: a peer with ONE lens at one entity still binds exactly one, under today's name", async () => {
    // The fix must not multiply the ordinary case — one lens, one binding, the same name as before.
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const report = await ch.sync();
      expect(report.bound).toEqual(["alice:Plant"]);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
