// Law from a peer whose clock runs ahead of ours starts later than our present. The sync parks it
// and says when it starts; the first sync after that moment binds it. Both steps are asserted, so
// a park that never recovers, or a reason that hides the start, both fail here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const ALICE_SEED = "a7".repeat(32);
const ME_SEED = "b8".repeat(32);
const T = 1_800_000_000_000;
const SKEW = 5_000;

const store = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));

afterEach(() => {
  vi.useRealTimers();
});

describe("blessing law from a peer whose clock runs ahead", () => {
  it("parks with the start time, then binds once our clock reaches it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T + SKEW);
    const alice = await store(ALICE_SEED);
    await alice.append([observed(FERN, "tag", "alice's tag", T + SKEW, ALICE_SEED)]);
    await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

    vi.setSystemTime(T);
    const me = await store(ME_SEED);
    const ch = await me.openChannel({
      into: "friends",
      prefix: "alice",
      source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    });
    const early = await ch.sync();
    expect(early.bound).toEqual([]);
    expect(early.parked).toHaveLength(1);
    expect(early.parked[0]).toMatch(
      /alice:Plant: a schema definition for hyperschema:Plant first survives at/,
    );
    const start = Number(/first survives at (\d+)/.exec(early.parked[0]!)?.[1]);
    expect(start).toBeGreaterThanOrEqual(T + SKEW); // the peer's clock, not ours
    expect(start).toBeLessThan(T + SKEW + 1_000);
    const readsAt = Number(/this store reads at (\d+)/.exec(early.parked[0]!)?.[1]);
    expect(readsAt).toBeGreaterThanOrEqual(T);
    expect(readsAt).toBeLessThan(start); // the read time comes before the definition's start
    expect(early.parked[0]).not.toMatch(/no surviving schema definition/);

    vi.setSystemTime(T + SKEW + 1_000);
    const later = await ch.sync();
    expect(later.bound).toEqual(["alice:Plant"]);
    expect(later.parked).toEqual([]);
    await Promise.all([me.close(), alice.close()]);
  });
});
