// The Ground pane's classifier (SPEC §19): kind badges are recognized by the constitutional
// contexts and pointer shapes Loam itself uses. This suite pins the classification over REAL
// deltas built by the library's own constructors — a badge that misnames a record would
// teach a falsehood on every row.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { operatorMarkerClaims, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { publicClaims } from "../../src/gateway/public.js";
import { registrationClaims } from "../../src/gateway/registration.js";
import { trustClaims } from "../../src/gateway/trust.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
// The page and this test share the classifier — same import discipline as the arc.
import { classifyDelta } from "../../demos/tutorial/instruments.mjs";

const SEED = "0e".repeat(32);
const ME = authorForSeed(SEED);
const sign = (claims: Parameters<typeof signClaims>[0]) => signClaims(claims, SEED);

const kindOf = (delta: Parameters<typeof classifyDelta>[0], self = ME) =>
  classifyDelta(delta, self).kind;

describe("classifyDelta: every badge earns its name", () => {
  it("recognizes the constitution", () => {
    expect(kindOf(sign(operatorMarkerClaims(ME)))).toBe("constitution");
  });

  it("recognizes a registration", () => {
    const policy = {
      props: new Map(),
      default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } },
    };
    expect(kindOf(sign(registrationClaims("schema:Plant", policy as never, [FERN], ME, 5)))).toBe(
      "registration",
    );
  });

  it("recognizes a grant", () => {
    expect(kindOf(sign(grantClaims(STORE_ENTITY, GARDENER, "write", ME, 6)))).toBe("grant");
  });

  it("recognizes a trust posture", () => {
    expect(kindOf(sign(trustClaims("open", [], ME, 7)))).toBe("trust");
  });

  it("recognizes an open-door declaration", () => {
    expect(kindOf(sign(publicClaims(["Plant"], ME, 8)))).toBe("public");
  });

  it("recognizes a tombstone", () => {
    expect(kindOf(sign(eraseClaims("1e20" + "ab".repeat(34), GARDENER, ME, 9)))).toBe("tombstone");
  });

  it("recognizes a negation (and a tombstone is NOT merely a negation)", () => {
    const target = observed(FERN, "height", 30, 1000, SEED);
    expect(kindOf(sign(makeNegationClaims(ME, 10, target.id, "retracted")))).toBe("negation");
  });

  it("a plain claim is a fact, and someone else's is foreign", () => {
    const mine = observed(FERN, "height", 30, 1000, SEED);
    const theirs = observed(FERN, "height", 34, 2000, GARDENER_SEED);
    expect(kindOf(mine)).toBe("fact");
    expect((classifyDelta(mine, ME) as { foreign: boolean }).foreign).toBe(false);
    expect((classifyDelta(theirs, ME) as { foreign: boolean }).foreign).toBe(true);
  });
});
