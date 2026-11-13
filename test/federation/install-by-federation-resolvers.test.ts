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
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      const report = await channel.sync();
      expect(report.bound).toContain("alice:Plant");

      const q = '{ alice_Plant(entity: "' + FERN + '") { height readings } }';
      const refused = await bob.query(q);
      expect((refused.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);
      expect(
        (refused.data as { alice_Plant: { readings: unknown } }).alice_Plant.readings,
      ).toBeNull();
      expect(JSON.stringify(refused.errors)).toContain("has not been told to run");
      expect(JSON.stringify(refused.errors)).toContain("--resolvers");
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);

      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      const granted = await bob.query(q);
      expect(granted.errors).toBeUndefined();
      expect((granted.data as { alice_Plant: { readings: unknown } }).alice_Plant.readings).toBe(
        424242,
      );
      expect(bob.withheldOn(CHANNEL)).toEqual([]);

      const bound = channel.pool.gateway!.registered.find((r) => r.schema.name === "alice:Plant")!;
      expect(bound.resolvers!.readings!.code).toContain("424242");
      expect(bound.resolvers!.readings!.code).not.toContain("loam:resolver-withheld");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a second poll neither stacks stubs nor un-grants what was granted", async () => {
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await channel.sync();
      const pool = channel.pool.gateway!;
      const still = pool.registered.find((r) => r.schema.name === "alice:Plant")!;
      expect(still.resolvers!.readings!.code).not.toContain("424242");
      expect(still.resolvers!.readings!.code).toContain("has not been told to run it");
      expect(still.resolvers!.readings!.code.match(/throw new Error/g)).toHaveLength(1);
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);

      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      await channel.sync();
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
    const alice = await forgingPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      const bound = channel.pool.gateway!.registered.find((r) => r.schema.name === "alice:Plant")!;
      expect(bound.resolvers!.readings!.code).not.toContain("__t209_forged__");
      expect(bound.resolvers!.readings!.code).toContain("has not been told to run it");
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the refusal reaches every reader, not only GraphQL", async () => {
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      const node = bob.surface("full")!.hooks.resolve("alice:Plant", FERN, undefined);
      expect(node.view.height).toBe(62);
      expect("watered" in node.view).toBe(false);
      expect(node.view.watered).not.toBe(false);

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
    const alice = await resolverPeer();
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      expect(bob.withheldOn(CHANNEL)).toEqual(["alice:Plant"]);

      const served = await bob.blessChannelResolvers(CHANNEL, "Plant");
      expect(served).toBe("alice:Plant");
      expect(bob.withheldOn(CHANNEL).includes(served)).toBe(false);
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
      await bob.blessChannelResolvers(CHANNEL, "alice:Plant");
      await expect(bob.blessChannelResolvers(CHANNEL, "alice:Plant")).rejects.toThrow(
        /holds no withheld resolvers/,
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
