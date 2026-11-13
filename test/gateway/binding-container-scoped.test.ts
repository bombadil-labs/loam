import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const S = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

describe("§47 — a channel's blessing lives in the channel's pool", () => {
  it("criterion 6: the binding is in the pool's ground and absent from the root's", async () => {
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const report = await ch.sync();
      expect(report.bound).toContain("alice:Plant");

      const pool = ch.pool.gateway!;
      const inPool = [...pool.reactor.snapshot()].some(
        (d) =>
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
          ) && d.claims.author === pool.operatorAuthor,
      );
      expect(inPool).toBe(true);
      const inRoot = [...me.reactor.snapshot()].some((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "schema" &&
            p.target.kind === "entity" &&
            p.target.entity.id === "schema:alice:Plant",
        ),
      );
      expect(inRoot).toBe(false);

      expect(me.def("alice:Plant")).toBeDefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("criterion 7: dropping the channel takes its bindings, and a bystander's still serve", async () => {
    const alice = await S("a1".repeat(32));
    const bob = await S("b0".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration({ name: "Sprout", alg: 1, body: PLANT.body }, PLANT_POLICY, [
        FERN,
      ]);
      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      await one.sync();
      await two.sync();
      expect(me.def("alice:Plant")).toBeDefined();
      expect(me.def("bob:Sprout")).toBeDefined();

      await me.dropChannel(one.name);

      expect(() => me.def("alice:Plant")).toThrow();
      await bob.append([observed(FERN, "height", 5, 9000, "b0".repeat(32))]);
      await two.sync();
      const read = await me.query(`{ bob_Sprout(entity: "${FERN}") { height } }`);
      expect(read.errors, JSON.stringify(read)).toBeUndefined();
      expect((read.data as { bob_Sprout: { height: unknown } }).bob_Sprout.height).toBe(5);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("the aggregated lens survives a REBOOT — pools attach, then the surface folds them in", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-agg-"));
    const alice = await S("a1".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const genesis = assembleGenesis({ operatorSeed: "cc".repeat(32), registrations: [] });
      const backendFor = (pool: string) =>
        new SqliteBackend(join(home, `${pool.replace(/[^A-Za-z0-9._-]/g, "_")}.sqlite`));
      const first = await Gateway.boot(new SqliteBackend(join(home, "store.sqlite")), genesis, {
        channelBackend: backendFor,
      });
      const ch = await first.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://peer.example/default",
        source: feed(alice),
      });
      await ch.sync();
      expect(first.def("alice:Plant")).toBeDefined();
      await first.close();

      const rebooted = await Gateway.boot(new SqliteBackend(join(home, "store.sqlite")), genesis, {
        channelBackend: backendFor,
        channelToken: () => "tok",
      });
      try {
        expect(rebooted.def("alice:Plant")).toBeDefined();
      } finally {
        await rebooted.close();
      }
    } finally {
      await alice.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
