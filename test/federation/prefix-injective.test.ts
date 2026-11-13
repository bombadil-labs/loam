import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "c3".repeat(32);
const nothing = { pull: () => Promise.resolve([]) };

async function store(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
  );
}

describe("§46 — a receiver-assigned prefix is checked for injectivity when it is assigned", () => {
  it("two prefixes that flatten onto the same GraphQL field cannot both be assigned", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "friends", prefix: "al:ice", source: nothing });
      await expect(
        gw.openChannel({ into: "friends", prefix: "al_ice", source: nothing }),
      ).rejects.toThrow(/al:ice/);
    } finally {
      await gw.close();
    }
  });

  it("the refusal NAMES the prefix it would collide with", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "friends", prefix: "al:ice", source: nothing });
      const err = await gw
        .openChannel({ into: "friends", prefix: "al_ice", source: nothing })
        .then(() => undefined)
        .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
      expect(err).toBeDefined();
      expect(err).toContain("al:ice");
    } finally {
      await gw.close();
    }
  });

  it("a prefix that does not collide is accepted — the check is not a blanket refusal", async () => {
    const gw = await store();
    try {
      await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
      const bob = await gw.openChannel({ into: "friends", prefix: "bob", source: nothing });
      expect(bob.prefix).toBe("bob");
    } finally {
      await gw.close();
    }
  });

  it("the same prefix into the SAME container resumes rather than colliding with itself", async () => {
    const gw = await store();
    try {
      const first = await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
      const again = await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
      expect(again.name).toBe(first.name);
    } finally {
      await gw.close();
    }
  });
});
