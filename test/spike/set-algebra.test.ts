// Rhizomatic 0.6.0's rail: the set algebra is whole. `union` has had first-class company since
// 0.6.0 — `difference` (of ∖ without) and `intersect` (left ∩ right), both dset-sort, both keyed
// by content-addressed id, both nestable to any depth. This smoke test proves the operators are
// actually reachable through Loam's substrate surface (the JSON `op` profile through parseTerm,
// evaluated by evalTerm against a real ground), including the one thing the old depth-1
// `select(not(inView(...)))` idiom could never do: a difference against a difference.

import { describe, expect, it } from "vitest";
import { DeltaSet, evalTerm, parseTerm } from "@bombadil/rhizomatic";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "./garden.js";

// A two-delta ground: one height, one tag, distinct authors and ids.
const heightDelta = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const tagDelta = observed(FERN, "tag", "shade", 1500, SURVEYOR_SEED);
const ground = DeltaSet.from([heightDelta, tagDelta]);

// The heights, selected: { heightDelta }.
const heightsOnly = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

// Evaluate a JSON term profile over the ground and return the surviving delta ids, sorted.
function idsOf(raw: unknown): string[] {
  const result = evalTerm(parseTerm(raw), ground);
  if (result.sort !== "dset") throw new Error(`expected a dset result, got ${result.sort}`);
  return [...result.set].map((d) => d.id).sort();
}

describe("rhizomatic 0.6.0 set algebra through Loam's surface", () => {
  it("difference: of ∖ without — everything minus the heights leaves the tag", () => {
    expect(idsOf({ op: "difference", of: "input", without: heightsOnly })).toEqual([tagDelta.id]);
  });

  it("intersect: left ∩ right — everything crossed with the heights leaves the height", () => {
    expect(idsOf({ op: "intersect", left: "input", right: heightsOnly })).toEqual([heightDelta.id]);
  });

  it("a difference may difference against a difference (the depth the inView idiom lacked)", () => {
    // inner = input ∖ heights = { tag }; outer = input ∖ inner = { height }.
    const nested = {
      op: "difference",
      of: "input",
      without: { op: "difference", of: "input", without: heightsOnly },
    };
    expect(idsOf(nested)).toEqual([heightDelta.id]);
  });
});
