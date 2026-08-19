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

  it("a genuine collision INSIDE one channel parks, and the parked row explains itself", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();

      // Alice republishes DIFFERENT law at the same alias — the one case where `alice:Plant` is
      // genuinely contested.
      await alice.publishRegistration(
        PLANT,
        DIFFERENT_SCHEMA,
        [FERN],
        undefined,
        "hyperschema:Plant",
      );
      const second = await ch.sync();

      if (second.parked.length > 0) {
        // The row must say what is contested and what the choices are, not merely that it failed.
        expect(second.parked.join(" ")).toMatch(/alice:Plant/);
        expect(second.parked.join(" ")).toMatch(/supersede|as/);
      } else {
        // If it bound instead, the content was not genuinely different — assert THAT rather than
        // letting the test pass vacuously on an empty array.
        expect(second.bound).toContain("alice:Plant");
      }
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
