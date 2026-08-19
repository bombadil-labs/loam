// §46 criterion 7 — deltas added at the publisher AFTER the channel opened arrive without the
// receiver running a command. Driven through the real standing instruction, not a hand-called sync:
// a rail that called `sync()` itself would prove the sync works and say nothing about whether
// anything ever calls it, which is the whole promise of the story.
//
// The transport stays behind the channel contract on purpose. This poller is the implementation
// today; a push transport would replace it without changing anything above.

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}
const until = async (p: () => boolean, ms = 4000): Promise<boolean> => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (p()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return p();
};

describe("§46 — the standing instruction", () => {
  it("a delta published after the channel opened arrives with no command from the receiver", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    const ch = await me.openChannel({
      into: "friends",
      prefix: "alice",
      source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    });
    const standing = me.keepSyncing({ everyMs: 40 });
    try {
      const later = observed(FERN, "height", 77, 9000, "a1".repeat(32));
      await alice.append([later]);

      const arrived = await until(() =>
        ch.pool.gateway!.reactor.arrivalLog().some((d) => d.id === later.id),
      );
      expect(arrived).toBe(true);
      // And the channel's own record shows it succeeded — the story's observable half.
      expect(me.channelStatus(ch.name)[0]!.lastSyncedAt).toBeGreaterThan(0);
    } finally {
      await standing.stop();
      await alice.close();
      await me.close();
    }
  });

  it("stopping the standing instruction stops the arrivals", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    const ch = await me.openChannel({
      into: "friends",
      prefix: "alice",
      source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    });
    const standing = me.keepSyncing({ everyMs: 40 });
    await until(() => me.channelStatus(ch.name)[0]!.lastSyncedAt > 0);
    await standing.stop();
    try {
      const after = observed(FERN, "height", 88, 12000, "a1".repeat(32));
      await alice.append([after]);
      await new Promise((r) => setTimeout(r, 200));
      // Two-sided: the poller genuinely stopped, so the first rail is not passing on a timer that
      // never turns off.
      expect(ch.pool.gateway!.reactor.arrivalLog().some((d) => d.id === after.id)).toBe(false);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
