import { describe, expect, it } from "vitest";
import { DeltaSet, evalTerm, parseTerm } from "@bombadil/rhizomatic";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "./garden.js";

const heightDelta = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const tagDelta = observed(FERN, "tag", "shade", 1500, SURVEYOR_SEED);
const ground = DeltaSet.from([heightDelta, tagDelta]);

const heightsOnly = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

function idsOf(raw: unknown): string[] {
  const result = evalTerm(parseTerm(raw), ground, Date.now());
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
    const nested = {
      op: "difference",
      of: "input",
      without: { op: "difference", of: "input", without: heightsOnly },
    };
    expect(idsOf(nested)).toEqual([heightDelta.id]);
  });
});
