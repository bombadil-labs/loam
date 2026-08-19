// T194 — a curse retires THE LENS, not "some binding at the lens's hyperschema entity".
//
// The existing curse rail uses two distinct programs (Plant, Sprout), each with one entity and one
// version — the corpus in which matching by entity and matching by lens COINCIDE. That is H10's
// shape, and it is why a green rail proved nothing: the implementation matched on the hyperschema
// ENTITY (H6 in the bytes), took the FIRST binding snapshot order offered, and reported success when
// it found none at all.
//
// This file stages the corpus where the two diverge in a way a CHANNEL can actually reach: several
// SURVIVING BINDING DELTAS at one entity, which is what an ordinary republish produces. Striking one
// of them leaves a later one latest, and the lens keeps serving while the curse reports done.
//
// (§21.7 coexistence — two lenses at one entity — is the sharper corpus and is NOT reachable through
// a channel today, because bindArrived derives its alias from the ENTITY and so collapses a peer's
// sibling lenses into one. That is its own gap; T197 carries it.)

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

/** A peer whose lens has been REPUBLISHED, so several binding deltas survive at one entity. */
async function peerWithTwoVersions(): Promise<Gateway> {
  const alice = await store("a1".repeat(32));
  await alice.publishRegistration(PLANT, named("Plant"), [FERN], undefined, "hyperschema:Plant");
  // Evolution: the same entity, a later program. Both bindings survive as deltas; readRegistrations
  // resolves the latest per (entity, lens), so striking the wrong one changes nothing a reader sees.
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

      // The verdict is the SURFACE, not a count of struck deltas. The implementation now refuses
      // if the lens is still served after striking, so reaching this line at all is the assertion —
      // and this makes it explicit for a reader.
      expect(() => me.def("alice:Plant")).toThrow();

      // Idempotent: cursing again is a success, because the standing record is proof the first one
      // happened. It must NOT be mistaken for "nothing to retire".
      await expect(me.curseChannelLaw(ch.name, "alice:Plant")).resolves.toBeUndefined();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("refuses rather than reporting a retirement it did not make", async () => {
    // Striking nothing used to return SUCCESS, one line below a docstring promising "the lens leaves
    // the surface" — H7 exactly. A first fix removed the lookup that happened to throw, which
    // reintroduced it; the refusal is now explicit rather than a side effect of another call.
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
});
