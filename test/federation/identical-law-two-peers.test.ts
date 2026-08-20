// §47 criteria 2 and 8 — TWO PEERS WITH BYTE-IDENTICAL LAW BOTH BIND, each under its own
// receiver-assigned name, and both serve real reads.
//
// This is the friend scenario, and it is the DEFAULT case, not an edge: two people who both ran
// `loam register --stock note` hold byte-identical law, and until this fix the second channel's
// name was never created — the witness guard keyed on the content address alone, so the second
// blessing was treated as a repeat of the first. The report has been honest about it since T198's
// first half (`witnessed`, not `bound`); this is the half that makes the name actually answer.
//
// The general assertion rides along, because it is worth more than the specific case: every name a
// sync reports in `bound` is defined and answers a real read.

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
      // Byte-identical law on both sides — the stock-shelf case.
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 11, 1000, "a1".repeat(32))]);
      await bob.append([observed(FERN, "height", 22, 2000, "b0".repeat(32))]);

      const one = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const two = await me.openChannel({ into: "friends", prefix: "bob", source: feed(bob) });
      const rOne = await one.sync();
      const rTwo = await two.sync();

      expect(rOne.bound).toContain("alice:Plant");
      // THE FIX: the second channel's name is CREATED, not witnessed away.
      expect(rTwo.bound).toContain("bob:Plant");
      expect(rTwo.witnessed).toEqual([]);

      // THE REPORT CANNOT OUTRUN THE STORE, generally: every bound name is defined...
      for (const name of [...rOne.bound, ...rTwo.bound]) {
        expect(() => me.def(name), `${name} was reported bound`).not.toThrow();
      }
      // ...and both SERVE, each answering its own peer's value — 11 is alice's, 22 is bob's, and a
      // fix that bound both names to one pool would answer the same number twice.
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
    // Two-sided against the fix that narrowed too far: the witness exists so a standing sync can
    // re-bless every interval without republishing. Keying it on (address, name) must keep that —
    // only a NEW name publishes.
    const alice = await S("a1".repeat(32));
    const me = await S("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      const first = await ch.sync();
      expect(first.bound).toContain("alice:Plant");

      // LAW deltas only: every sync stamps a channel record, so the raw count always moves. What
      // the witness promises is that no REGISTRATION lands twice.
      const lawCount = (): number =>
        [...me.reactor.snapshot()].filter((d) =>
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
          ),
        ).length;
      const before = lawCount();
      expect(before).toBeGreaterThan(0); // the floor: an empty filter would make this rail vacuous
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
    // The hollow-rail lens found the sibling assertion missing in the frozen name-parked file: its
    // header claimed "a receiver's OWN law keeps its bare name" while nothing asserted the bare
    // binding after the sync — a sync that struck or re-pointed it would have passed green. This
    // rail carries the assertion at the level that matters: the ENTITY, not merely the name, since
    // a re-point keeps the name and swaps what it means.
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
