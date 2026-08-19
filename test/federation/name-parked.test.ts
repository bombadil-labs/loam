// §46 criteria 5 and 6 — the receiver's names are EXPLICIT, and a name already answered by
// different-content law is PARKED rather than taken.
//
// Criterion 5 exists because "if there is only one candidate, the bare name resolves to it" is a
// tempting ergonomic that makes a name's meaning depend on what else happens to be in the set.
// Today alice is your only Plant, so bare `Plant` is hers; next week you register your own and bare
// `Plant` silently means something different, under queries already running. So the bare name is
// never bound by inference — every served name carries the prefix the receiver assigned.
//
// Criterion 6: choosing between superseding a name and serving under a second one is a DECISION,
// and decisions do not ride a poll that runs while nobody is watching. The parked row must name the
// conflict so a person can resolve it.

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

// Same NAME, different CONTENT — the only shape that is a genuine collision. Identical law under
// two names is not a conflict, and criterion 9's rail proves that separately. The content differs in
// the SCHEMA (the resolution program), which `schemaLawAddress` hashes alongside the hyperschema —
// a cheaper and more honest difference than a hand-mangled body, which is not a valid Term at all.
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
      // The prefixed name binds; the bare one does not, and would not even though nothing else
      // claims it. Cardinality must never decide what a name means.
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
      // Mine first, under the bare name, registered by me.
      await me.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.publishRegistration(PLANT, DIFFERENT_SCHEMA, [FERN]);

      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const report = await ch.sync();

      // Alice's binds under her prefix and does not disturb mine — the prefix IS the answer to the
      // collision, which is why a receiver-assigned namespace beats a negotiated one.
      expect(report.bound).toContain("alice:Plant");
      expect(report.parked).toEqual([]);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a prefix is store-WIDE: a second container cannot take one already assigned", async () => {
    // The first version of the injectivity check compared prefixes only within ONE receiving
    // container. Living names are store-global (`alice:Plant`), so two containers both assigned
    // `alice` and their law collided on every name — and, per the rail below, collided SILENTLY.
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
    // No if/else: this asserts one outcome. The previous version branched on `parked.length > 0`
    // and was green either way, which hid that parking never fires at all — `adoptOne` computes
    // `mayTake = supersede || as !== undefined || confirmed`, and a channel ALWAYS passes `as`, so
    // the different-content refusal was unreachable and the second sync re-pointed the name and
    // struck the incumbent.
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      // The receiver already answers `alice:Plant` with law of their own, at a DIFFERENT entity.
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
      // The incumbent still answers, and still answers with MY law — the silent re-point is what
      // this refuses, so asserting the name survived is not enough.
      expect(me.def("alice:Plant").entity).toBe(mine);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});

describe("T198 — two peers with byte-identical law", () => {
  it("the second channel reports WITNESSED, never bound, because its name is not created", async () => {
    // The default case, not an edge: two peers who both ran `loam register --stock note` have
    // byte-identical law. `schemaLawAddress` excludes the LIVING NAME, so that law has ONE address
    // whatever it is called, and adoptLaw refuses to publish law it already serves under another
    // name — deliberately, so a module blessed twice does not bind twice.
    //
    // The defect was reporting that outcome as `bound`. The report said the name serves; the store
    // threw on it. Until a second name can serve the same law, saying so is the honest answer.
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
      expect(second.bound).not.toContain("bob:Plant");
      expect(second.witnessed).toContain("bob:Plant");

      // THE REPORT CANNOT OUTRUN THE STORE: every name in `bound` is defined. This is the general
      // form of the defect and is worth asserting for its own sake.
      for (const name of [...first.bound, ...second.bound]) {
        expect(() => me.def(name), `${name} was reported bound`).not.toThrow();
      }
      // And the witnessed name is exactly the one that does not serve.
      expect(() => me.def("bob:Plant")).toThrow();
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });
});
