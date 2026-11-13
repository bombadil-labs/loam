import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const NOTHING = { pull: () => Promise.resolve([]) };

const DIFFERENT_SCHEMA = {
  props: new Map(PLANT_POLICY.props),
  default: { kind: "all", order: { kind: "byTimestamp", dir: "desc" } },
} as typeof PLANT_POLICY;

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

describe("§46 — names are the receiver's, and they are explicit", () => {
  it("the BARE name is never bound, even when the peer's law is the only candidate", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await ch.sync();
      expect(report.bound).toContain("alice:Plant");
      expect(report.bound).not.toContain("Plant");
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a receiver's OWN law keeps its bare name when a peer's same-named law arrives", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await me.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.publishRegistration(PLANT, DIFFERENT_SCHEMA, [FERN]);

      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await ch.sync();

      expect(report.bound).toContain("alice:Plant");
      expect(report.parked).toEqual([]);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a prefix is store-WIDE: a second container cannot take one already assigned", async () => {
    const me = await store("cc".repeat(32));
    try {
      await me.openChannel({ into: "friends", prefix: "alice", source: NOTHING });
      await expect(
        me.openChannel({ into: "work", prefix: "alice", source: NOTHING }),
      ).rejects.toThrow(/alice/);
    } finally {
      await me.close();
    }
  });

  it("a name already answered by DIFFERENT law is parked, never silently taken", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await me.publishRegistration(
        { name: "alice:Plant", alg: 1, body: PLANT.body },
        PLANT_POLICY,
        [FERN],
        undefined,
        "hyperschema:mine",
      );
      const mine = me.def("alice:Plant").entity;

      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await ch.sync();

      expect(report.bound).not.toContain("alice:Plant");
      expect(report.parked.join(" ")).toContain("alice:Plant");
      expect(me.def("alice:Plant").entity).toBe(mine);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});

describe("T198 — two peers with byte-identical law", () => {
  it("both names bind: identical law under two names is two bindings (was the T198 interim)", async () => {
    const alice = await store("a1".repeat(32));
    const bob = await store("b0".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

      const first = await (
        await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) })
      ).sync();
      expect(first.bound).toContain("alice:Plant");

      const second = await (
        await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) })
      ).sync();
      expect(second.bound).toContain("bob:Plant");
      expect(second.witnessed).toEqual([]);

      for (const name of [...first.bound, ...second.bound]) {
        expect(() => me.def(name), `${name} was reported bound`).not.toThrow();
      }
      expect(() => me.def("bob:Plant")).not.toThrow();
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });
});
