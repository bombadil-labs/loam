// Step 0's contract: the scaffold stands on the real substrate. Signed deltas travel the whole
// short road — claims → signature → set → union — and come back intact.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  authorForSeed,
  computeId,
  merge,
  signClaims,
  verifyDelta,
  type Delta,
} from "@bombadil/rhizomatic";

// A fixed 32-byte seed: deterministic keys, deterministic deltas, deterministic test.
const SEED = "11".repeat(32);
const AUTHOR = authorForSeed(SEED);

function planted(role: string, value: string, timestamp: number): Delta {
  return signClaims(
    { timestamp, author: AUTHOR, pointers: [{ role, target: { kind: "primitive", value } }] },
    SEED,
  );
}

const ground = planted("name", "loam", 1_720_000_000_000);
const bed = planted("medium", "soil", 1_720_000_000_001);
const seed = planted("planted", "step-0", 1_720_000_000_002);

describe("smoke: deltas round-trip through the real @bombadil/rhizomatic", () => {
  it("signs claims into a content-addressed delta that verifies", () => {
    expect(ground.id).toBe(computeId(ground.claims));
    expect(verifyDelta(ground)).toBe("verified");
  });

  it("stores and returns the identical delta", () => {
    const set = new DeltaSet();
    expect(set.add(ground)).toBe(true);
    expect(set.add(ground)).toBe(false); // the ground does not repeat itself
    expect(set.get(ground.id)).toEqual(ground);
    expect(set.size).toBe(1);
  });

  it("merges as union — order-blind, idempotent, nothing lost", () => {
    const a = DeltaSet.from([ground, bed]);
    const b = DeltaSet.from([bed, seed]); // overlaps a on `bed`

    const ab = merge(a, b);
    const ba = merge(b, a);

    for (const s of [ab, ba]) {
      expect(s.size).toBe(3);
      for (const d of [ground, bed, seed]) expect(s.get(d.id)).toEqual(d);
    }
    expect(ab.digest()).toBe(ba.digest()); // order-blind
    expect(merge(a, a).digest()).toBe(a.digest()); // idempotent
  });
});
