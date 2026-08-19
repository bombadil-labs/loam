// §46 criterion 3 — the RECEIVER assigns a peer's namespace prefix, and a prefix that would collide
// at the GraphQL door is refused AT ASSIGNMENT TIME, while a person is present to choose another.
//
// The hazard is already documented at accounts.ts: `legalNameFor` maps every non-alphanumeric to
// `_`, so distinct entity namespaces can serve at ONE field. Measured, not assumed — `al:ice` and
// `al_ice` both flatten to `al_ice`, while `alice` and `alice_` do NOT collide. (An earlier draft of
// this rail asserted the second pair and would have driven a check that refused the wrong thing.)
// With federation the peer no longer picks any part of that name — the receiver does — which is what
// makes injectivity LOCALLY CHECKABLE: this store knows every prefix it has assigned, so it refuses
// the collision instead of discovering it at publish time.
//
// Two-sided: a prefix that does NOT collide is accepted, so the check cannot pass by refusing
// everything.

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
      // `al:ice` and `al_ice` are disjoint namespaces that both flatten to the field lead `al_ice`.
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
      expect(err).toContain("al:ice"); // the standing prefix, so the operator can choose around it
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
