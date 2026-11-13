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

      expect(report.bound).toContain("alice:Plant");
      expect(report.bound).toContain("alice:AllPlant");

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
