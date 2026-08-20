// §47 criteria 6 and 7 — A BINDING BELONGS TO THE CONTAINER IT WAS BLESSED INTO.
//
// §46's channels blessed a peer's law into the RECEIVER's primary ground while the peer's data
// lived in a pool — backwards from §28, where effectiveness is a property of a container. T189
// scoped the READS to the pool and left the binding store-wide, and that seam is where a whole
// review's worth of defects fell through (T199's severed-lens fallback most of all).
//
// Now the blessing lands in the pool's own ground. The surface still serves the lens — replay
// AGGREGATES each attached channel pool's blessed bindings under the channel's prefix — but the
// bytes live where the peer's data lives, so dropping the channel takes the law with the data and
// the whole retire-on-drop question (T199) dissolves, exactly as Myk predicted it should.

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

      // DELTA LEVEL, both sides. The binding deltas are in the POOL...
      const inPool = [...ch.pool.gateway!.reactor.snapshot()].some(
        (d) =>
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
          ) && d.claims.author === me.operatorAuthor,
      );
      expect(inPool).toBe(true);
      // ...and the ROOT ground holds no registration binding for the channel's name.
      const inRoot = [...me.reactor.snapshot()].some((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "schema" &&
            p.target.kind === "entity" &&
            p.target.entity.id === "schema:alice:Plant",
        ),
      );
      expect(inRoot).toBe(false);

      // OBJECT LEVEL: the surface still serves the lens, aggregated from the pool.
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

      // GONE from the surface with no fail-closed guard needed — the binding went with the pool.
      expect(() => me.def("alice:Plant")).toThrow();
      // Two-sided at the door: the bystander's lens still SERVES a real read.
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
    // Boot order is load-bearing: replay runs before resumeChannels, so without a second fold the
    // rebooted surface would lack every channel lens until the next sync — a store that "kept the
    // data and lost the law" on every restart.
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
