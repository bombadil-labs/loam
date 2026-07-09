// SPEC §2, "Resolution & policy": resolveView(Policy, HView) → View. One gathered HView backs
// many resolutions; pluralism is policy choice. pick = one truth, all = set union, conflicts =
// contested-kept, merge = reduction; a resolved View is content-addressed and deterministic.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  evalTerm,
  resolveView,
  viewCanonicalHex,
  type HView,
  type Policy,
  type PropPolicy,
  type View,
} from "@bombadil/rhizomatic";
import { FERN, GARDENER, GARDENER_SEED, PLANT_BODY, SURVEYOR_SEED, observed } from "./garden.js";

// The contested garden: two authors measured the fern differently; tags accumulate; the kind
// is agreed once.
const deltas = [
  observed(FERN, "height", 30, 1000, GARDENER_SEED),
  observed(FERN, "height", 34, 2000, SURVEYOR_SEED),
  observed(FERN, "tag", "shade", 1500, GARDENER_SEED),
  observed(FERN, "tag", "fronds", 1600, SURVEYOR_SEED),
  observed(FERN, "kind", "fern", 1200, GARDENER_SEED),
];

function gather(set: DeltaSet): HView {
  const result = evalTerm(PLANT_BODY, set, FERN);
  if (result.sort !== "hview") throw new Error(`expected an hview, got ${result.sort}`);
  return result.hview;
}

const hview = gather(DeltaSet.from(deltas));

const pickLatest: PropPolicy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const policy = (overrides: Record<string, PropPolicy> = {}): Policy => ({
  props: new Map(Object.entries(overrides)),
  default: pickLatest,
});

const asObj = (v: View) => v as Record<string, View>;

describe("spike: resolveView(Policy, HView) → View", () => {
  it("pick byTimestamp: latest wins", () => {
    const view = asObj(resolveView(policy(), hview));
    expect(view["height"]).toBe(34);
    expect(view["kind"]).toBe("fern");
  });

  it("pick byAuthorRank: the trusted author wins — one HView, two truths (pluralism)", () => {
    const trustGardener = policy({
      height: { kind: "pick", order: { kind: "byAuthorRank", authors: [GARDENER] } },
    });
    expect(asObj(resolveView(trustGardener, hview))["height"]).toBe(30);
    expect(asObj(resolveView(policy(), hview))["height"]).toBe(34); // same HView, other policy
  });

  it("all: set union, deterministically ordered", () => {
    const union = policy({ tag: { kind: "all", order: { kind: "byTimestamp", dir: "asc" } } });
    expect(asObj(resolveView(union, hview))["tag"]).toEqual(["shade", "fronds"]);
  });

  it("conflicts: contested values are kept in superposition; agreement is silence", () => {
    const contested = policy({
      height: { kind: "conflicts", order: { kind: "byTimestamp", dir: "desc" } },
      kind: { kind: "conflicts", order: { kind: "byTimestamp", dir: "desc" } },
    });
    const view = asObj(resolveView(contested, hview));
    expect(view["height"]).toEqual([34, 30]); // both claims held, newest first
    expect(view["kind"]).toBeUndefined(); // a single agreed value is not a conflict
  });

  it("merge: reduction over the bucket", () => {
    const reduced = policy({
      height: { kind: "merge", fn: "max" },
      tag: { kind: "merge", fn: "count" },
    });
    const view = asObj(resolveView(reduced, hview));
    expect(view["height"]).toBe(34);
    expect(view["tag"]).toBe(2);
  });

  it("snapshots: same policy + same deltas (any order) → the same content address", () => {
    const a = viewCanonicalHex(resolveView(policy(), hview));
    const b = viewCanonicalHex(resolveView(policy(), gather(DeltaSet.from([...deltas].reverse()))));
    expect(a).toBe(b);
  });
});
