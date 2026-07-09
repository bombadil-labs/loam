// Step 0's contract: the scaffold stands on the real substrate. One delta, signed with a real
// key, travels the whole short road — claims → signature → set → union — and comes back intact.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  authorForSeed,
  merge,
  signClaims,
  verifyDelta,
  type Claims,
} from "@bombadil/rhizomatic";

// A fixed 32-byte seed: deterministic keys, deterministic test.
const SEED = "11".repeat(32);

function plantedClaims(): Claims {
  return {
    timestamp: 1_720_000_000_000,
    author: authorForSeed(SEED),
    pointers: [{ role: "name", target: { kind: "primitive", value: "loam" } }],
  };
}

describe("smoke: a delta round-trips through the real @bombadil/rhizomatic", () => {
  it("signs claims into a delta that verifies", () => {
    const delta = signClaims(plantedClaims(), SEED);
    expect(delta.id).toMatch(/^1e20[0-9a-f]{64}$/);
    expect(verifyDelta(delta)).toBe("verified");
  });

  it("stores and returns the identical delta", () => {
    const delta = signClaims(plantedClaims(), SEED);
    const set = new DeltaSet();
    expect(set.add(delta)).toBe(true);
    expect(set.add(delta)).toBe(false); // the ground does not repeat itself
    expect(set.get(delta.id)).toEqual(delta);
    expect(set.size).toBe(1);
  });

  it("merges as union — order-blind, idempotent", () => {
    const delta = signClaims(plantedClaims(), SEED);
    const a = DeltaSet.from([delta]);
    const b = new DeltaSet();

    const ab = merge(a, b);
    const ba = merge(b, a);
    const aa = merge(a, a);

    for (const s of [ab, ba, aa]) {
      expect(s.size).toBe(1);
      expect(s.get(delta.id)).toEqual(delta);
    }
    expect(ab.digest()).toBe(ba.digest());
    expect(ab.digest()).toBe(aa.digest());
  });
});
