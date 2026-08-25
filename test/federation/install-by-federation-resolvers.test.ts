// T209 — a peer's RESOLVER code is a second decision.
//
// A registration may carry §22 resolver ESM, and publishing one LOADS that ESM on the gateway it is
// published to — no pool, no worker, no frame. So the pass that binds NAMES cannot pass resolvers
// through: it binds them WITHHELD, the computed fields refuse by name, and `bless-app --resolvers`
// is the act that runs them. Split from its siblings for the clock; fixtures in `t209-fixtures.ts`.

import { describe, expect, it } from "vitest";
import {
  BOB_SEED,
  CHANNEL,
  FERN,
  forgingPeer,
  link,
  resolverPeer,
  store,
} from "./t209-fixtures.js";

describe("T209 — a peer's RESOLVER code is a second decision", () => {
  it("auto-bless binds the name and withholds the code; the field refuses by name", async () => {
    // The blessing toggle is ON and doing its job — the lens binds and its ordinary fields answer.
    // What it does NOT do is run the peer's ESM: publishing a registration LOADS its resolvers on
    // the gateway it is published to, with no pool, no worker and no frame. So the computed field
    // refuses, and says which act supplies it.
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      const report = await channel.sync();
      expect(report.bound).toContain("alice:Plant"); // the toggle worked…

      const q = '{ alice_Plant(entity: "' + FERN + '") { height readings } }';
      const refused = await bob.query(q);
      // The ORDINARY field answers, so this cannot pass with the whole lens broken.
      expect((refused.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);
      // The COMPUTED one refuses, by name, with the act that clears it.
      expect(
        (refused.data as { alice_Plant: { readings: unknown } }).alice_Plant.readings,
      ).toBeNull();
      expect(JSON.stringify(refused.errors)).toContain("has not been told to run");
      expect(JSON.stringify(refused.errors)).toContain("--resolvers");
      // The listing names the decision waiting on a person.
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);

      // THE EXPLICIT ACT, and only then does the peer's code compute anything here.
      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      const granted = await bob.query(q);
      expect(granted.errors).toBeUndefined();
      expect((granted.data as { alice_Plant: { readings: unknown } }).alice_Plant.readings).toBe(
        424242,
      );
      expect(bob.withheldOn(CHANNEL)).toEqual([]);

      // AT THE DELTA LEVEL, because `withheldOn` and the field's refusal read the same object and
      // cannot witness each other: what the pool actually PUBLISHED is the receiver's own stub
      // while it was withheld, and the peer's own source after the grant. Without this, a defect
      // that published the peer's code under a withheld mark would look right from both readers.
      const bound = channel.pool.gateway!.registered.find((r) => r.schema.name === "alice:Plant")!;
      expect(bound.resolvers!.readings!.code).toContain("424242");
      expect(bound.resolvers!.readings!.code).not.toContain("loam:resolver-withheld");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a second poll neither stacks stubs nor un-grants what was granted", async () => {
    // A standing sync re-blesses the pool's CONTENTS on every tick, so the withholding meets its own
    // output over and over. Stacking a stub on a stub would bury the peer's source; re-withholding
    // after a grant would take back, unattended, a decision a person made.
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await channel.sync(); // the ordinary case: another tick
      const pool = channel.pool.gateway!;
      const still = pool.registered.find((r) => r.schema.name === "alice:Plant")!;
      // WHAT THE POOL PUBLISHED IS THE STUB, and one of them — the peer's source is not here at
      // all. A shape that recognised an already-withheld spec and passed it through was a test over
      // source the PEER writes, which is a test the peer passes; the stub is written fresh from the
      // lens and the field every time instead, so a second tick re-writes the same bytes.
      expect(still.resolvers!.readings!.code).not.toContain("424242");
      expect(still.resolvers!.readings!.code).toContain("has not been told to run it");
      expect(still.resolvers!.readings!.code.match(/throw new Error/g)).toHaveLength(1);
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);

      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      await channel.sync(); // and a tick AFTER the grant
      expect(bob.withheldOn(CHANNEL)).toEqual([]);
      const q = '{ alice_Plant(entity: "' + FERN + '") { readings } }';
      const answer = await bob.query(q);
      expect(answer.errors).toBeUndefined();
      expect((answer.data as { alice_Plant: { readings: unknown } }).alice_Plant.readings).toBe(
        424242,
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer cannot pass their own code off as this store's refusal", async () => {
    // The stub is written from the lens and the field, and recognised by EQUALITY against what this
    // store would write. Recognised by a marker instead, the test would be one over source the PEER
    // authors: prefix your module with it and every reader calls your code withheld — while the
    // publish imports and evaluates the module body, which is the guarantee exactly inverted.
    const alice = await forgingPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      // The peer's bytes are not what got published: the stub is, whatever their source said.
      const bound = channel.pool.gateway!.registered.find((r) => r.schema.name === "alice:Plant")!;
      expect(bound.resolvers!.readings!.code).not.toContain("__t209_forged__");
      expect(bound.resolvers!.readings!.code).toContain("has not been told to run it");
      // And the state is reported as withheld, which it truly is — the forgery bought nothing.
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);
      // WHAT THIS RAIL CANNOT WITNESS: that the peer's module body never evaluated in this process.
      // The peer's OWN store published that registration and preloaded it legitimately, so a global
      // side effect is set before the channel exists. What it does pin is that nothing bob published
      // carries the peer's source — which is what decides whether bob ever imports it.
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the refusal reaches every reader, not only GraphQL", async () => {
    // The stub throws, and §22's availability rule catches a throwing resolver and leaves the
    // Policy value — right for a resolver this store RAN and that failed, wrong for one it never
    // ran. Everything downstream of the shared read hook inherits that value: REST, watch, list,
    // and a rendered page. A number nobody computed, with nothing saying so, is the H7 shape.
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      // THE SHARED SEAM, which is what every non-GraphQL door reads: the field is ABSENT, not a
      // fallback number. `height` is present beside it, so this cannot pass on an empty view.
      const node = bob.surface("full")!.hooks.resolve("alice:Plant", FERN, undefined);
      expect(node.view.height).toBe(62);
      // ABSENT, and specifically NOT the Policy value. `watered` is declared `absentAs false`, so
      // its Policy always answers — and answering `false` is exactly what a caught throw does: a
      // value nobody computed, indistinguishable from one the peer's law produced.
      expect("watered" in node.view).toBe(false);
      expect(node.view.watered).not.toBe(false);

      // Two-sided: after the act, the peer's own values are there at the same seam.
      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      const after = bob.surface("full")!.hooks.resolve("alice:Plant", FERN, undefined);
      expect(after.view.watered).toBe(true);
      expect(after.view.readings).toBe(424242);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the act reports the name it used, so a BARE name cannot fool a read-back", async () => {
    // `--resolvers Plant` is a supported form — the act prefixes it — while every reader answers
    // prefixed names. A caller that checked its own argument against those readers would be asking
    // a question that cannot match: the guard passes because the comparison is empty, not because
    // the grant took the name. So the act returns what it acted on.
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);

      const served = await bob.blessChannelResolvers(CHANNEL, "Plant"); // the BARE form
      expect(served).toBe("alice:Plant");
      expect(bob.withheldOn(CHANNEL).includes(served)).toBe(false);
      // …and the grant really took: the peer's value answers at the shared seam.
      const node = bob.surface("full")!.hooks.resolve("alice:Plant", FERN, undefined);
      expect(node.view.readings).toBe(424242);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the act names one lens, and refuses a lens with nothing withheld", async () => {
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await expect(bob.blessChannelResolvers(CHANNEL, "alice:Nope")).rejects.toThrow(
        /holds no withheld resolvers/,
      );
      // Two-sided: the lens that IS waiting is accepted.
      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      // …and a second call refuses, because nothing is withheld any more.
      await expect(bob.blessChannelResolvers(CHANNEL, "alice:Plant")).rejects.toThrow(
        /holds no withheld resolvers/,
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
