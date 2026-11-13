import { describe, expect, it } from "vitest";
import type { Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

async function peerWithTwoVersions(): Promise<Gateway> {
  const alice = await store("a1".repeat(32));
  await alice.publishRegistration(PLANT, named("Plant"), [FERN], undefined, "hyperschema:Plant");
  await alice.publishRegistration(
    { ...PLANT, alg: 1 },
    { ...named("Plant"), default: { kind: "all", order: { kind: "byTimestamp", dir: "desc" } } },
    [FERN],
    undefined,
    "hyperschema:Plant",
  );
  return alice;
}

describe("T194 — cursing keys on the lens, not the entity", () => {
  it("retires the cursed lens and leaves its SIBLING at the same entity serving", async () => {
    const alice = await peerWithTwoVersions();
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const first = await ch.sync();
      expect(first.bound).toContain("alice:Plant");

      await me.curseChannelLaw(ch.name, "alice:Plant");

      expect(() => me.def("alice:Plant")).toThrow();

      await expect(me.curseChannelLaw(ch.name, "alice:Plant")).resolves.toBeUndefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("refuses rather than reporting a retirement it did not make", async () => {
    const alice = await peerWithTwoVersions();
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();
      await expect(me.curseChannelLaw(ch.name, "alice:NotALens")).rejects.toThrow(/alice:NotALens/);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("acts only in the channel's pool: with the pool detached, a curse and a lift refuse and change nothing", async () => {
    const alice = await peerWithTwoVersions();
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();
      await me.curseChannelLaw(ch.name, "alice:Plant");
      await ch.pool.detach("kept for the rail");
      const before = [...me.reactor.snapshot()].length;
      await expect(me.curseChannelLaw(ch.name, "alice:Plant")).rejects.toThrow(
        /not attached here, and a curse acts only in that pool/,
      );
      await expect(me.curseChannelLaw(ch.name, "alice:Plant", { lift: true })).rejects.toThrow(
        /not attached here, and a lift acts only in that pool/,
      );
      expect([...me.reactor.snapshot()].length).toBe(before);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
