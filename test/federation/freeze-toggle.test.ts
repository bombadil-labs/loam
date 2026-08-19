// §46 criterion 12 — freezing a channel stops new deltas arriving and leaves everything already
// received readable. Freeze is the REVERSIBLE act; drop is the irreversible one, and they are
// deliberately different verbs on different surfaces (T188 keeps them apart for agents too).

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

describe("§46 — freezing a channel", () => {
  it("stops new deltas and keeps what already arrived", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      const first = observed(FERN, "height", 62, 1000, "a1".repeat(32));
      await alice.append([first]);
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();

      await me.setChannel(ch.name, { receiving: false });
      const later = observed(FERN, "height", 99, 5000, "a1".repeat(32));
      await alice.append([later]);
      const frozen = await ch.sync();

      // Nothing new crossed...
      expect(frozen.accepted).toBe(0);
      const pool = ch.pool.gateway!.reactor.arrivalLog().map((d) => d.id);
      expect(pool).not.toContain(later.id);
      // ...and everything already received still reads. Two-sided: a freeze that emptied the pool
      // would pass the first assertion and be a catastrophe.
      expect(pool).toContain(first.id);
      expect(me.containerScope({ containers: ["friends"] }).map((d) => d.id)).toContain(first.id);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("resuming a frozen channel takes what it missed", async () => {
    const alice = await store("a1".repeat(32));
    const me = await store("cc".repeat(32));
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await me.setChannel(ch.name, { receiving: false });
      const missed = observed(FERN, "height", 42, 3000, "a1".repeat(32));
      await alice.append([missed]);
      await ch.sync();
      expect(ch.pool.gateway!.reactor.arrivalLog().map((d) => d.id)).not.toContain(missed.id);

      await me.setChannel(ch.name, { receiving: true });
      const resumed = await ch.sync();
      expect(resumed.accepted).toBeGreaterThan(0);
      expect(ch.pool.gateway!.reactor.arrivalLog().map((d) => d.id)).toContain(missed.id);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
