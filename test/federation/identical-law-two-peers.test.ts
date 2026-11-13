import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const S = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

describe("§47 — identical law from two peers", () => {
  it("both names bind, and both answer their own peer's data", async () => {
    const alice = await S("a1".repeat(32));
    const bob = await S("b0".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 11, 1000, "a1".repeat(32))]);
      await bob.append([observed(FERN, "height", 22, 2000, "b0".repeat(32))]);

      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      const rOne = await one.sync();
      const rTwo = await two.sync();

      expect(rOne.bound).toContain("alice:Plant");
      expect(rTwo.bound).toContain("bob:Plant");
      expect(rTwo.witnessed).toEqual([]);

      for (const name of [...rOne.bound, ...rTwo.bound]) {
        expect(() => me.def(name), `${name} was reported bound`).not.toThrow();
      }
      const a = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
      const b = await me.query(`{ bob_Plant(entity: "${FERN}") { height } }`);
      expect(a.errors, JSON.stringify(a)).toBeUndefined();
      expect(b.errors, JSON.stringify(b)).toBeUndefined();
      expect((a.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(11);
      expect((b.data as { bob_Plant: { height: unknown } }).bob_Plant.height).toBe(22);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("a repeat blessing of the SAME name still witnesses — the hourly poll appends no narrative", async () => {
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const first = await ch.sync();
      expect(first.bound).toContain("alice:Plant");

      const lawCount = (): number =>
        [...ch.pool.gateway!.reactor.snapshot()].filter((d) =>
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
          ),
        ).length;
      const before = lawCount();
      expect(before).toBeGreaterThan(0);
      const again = await ch.sync();
      expect(again.witnessed).toContain("alice:Plant");
      expect(again.bound).not.toContain("alice:Plant");
      expect(lawCount()).toBe(before);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});

describe("§47 — the receiver's own bare name survives a peer's arrival", () => {
  it("after syncing a peer, the bare name still answers with the RECEIVER's entity", async () => {
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await me.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const mine = me.def("Plant").entity;

      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const report = await ch.sync();

      expect(report.bound).toContain("alice:Plant");
      expect(me.def("Plant").entity).toBe(mine);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
