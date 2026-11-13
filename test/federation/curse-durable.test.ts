import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const SPROUT = { name: "Sprout", alg: 1, body: PLANT.body } as typeof PLANT;

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

async function peerWithTwoLenses(): Promise<Gateway> {
  const alice = await store("a1".repeat(32));
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
  await alice.publishRegistration(SPROUT, PLANT_POLICY, [FERN]);
  return alice;
}

describe("§46 — cursing one bound law", () => {
  it("retires that law and leaves its channel-mate serving", async () => {
    const alice = await peerWithTwoLenses();
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const first = await ch.sync();
      expect(first.bound).toContain("alice:Plant");
      expect(first.bound).toContain("alice:Sprout");

      await me.curseChannelLaw(ch.name, "alice:Plant");

      expect(() => me.def("alice:Plant")).toThrow();
      expect(me.def("alice:Sprout")).toBeDefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("the retirement SURVIVES the next poll", async () => {
    const alice = await peerWithTwoLenses();
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();
      await me.curseChannelLaw(ch.name, "alice:Plant");

      const again = await ch.sync();
      expect(again.bound).not.toContain("alice:Plant");
      expect(() => me.def("alice:Plant")).toThrow();
      expect(me.def("alice:Sprout")).toBeDefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a curse is reversible: lifting it lets the next poll bind again", async () => {
    const alice = await peerWithTwoLenses();
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();
      await me.curseChannelLaw(ch.name, "alice:Plant");
      await me.curseChannelLaw(ch.name, "alice:Plant", { lift: true });

      const again = await ch.sync();
      expect([...again.bound, ...again.witnessed]).toContain("alice:Plant");
      expect(me.def("alice:Plant")).toBeDefined();
      const answer = await me.query('{ alice_Plant(entity: "' + FERN + '") { height } }');
      expect(answer.errors, JSON.stringify(answer)).toBeUndefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
