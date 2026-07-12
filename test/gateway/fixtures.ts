// The gateway suite's shared world: the Plant schema, its policy, and a small settled garden.

import {
  authorForSeed,
  signClaims,
  type Delta,
  type HyperSchema,
  type Schema,
  type Policy,
} from "@bombadil/rhizomatic";
import { grantClaims, membershipClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import {
  FERN,
  GARDENER,
  PLANT_BODY,
  SURVEYOR,
  GARDENER_SEED,
  SURVEYOR_SEED,
  observed,
} from "../spike/garden.js";

export const PLANT: HyperSchema = { name: "Plant", alg: 1, body: PLANT_BODY };

export const pickLatest: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };

export const PLANT_POLICY: Schema = {
  props: new Map<string, Policy>([
    ["height", pickLatest],
    ["tag", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
    ["watered", { kind: "absentAs", constant: false, then: pickLatest }],
    ["readings", { kind: "merge", fn: "count" }],
  ]),
  default: pickLatest,
};

// A governed gateway's constitution under the authors-not-owners model: the garden fixture's
// two authors hold write STANDING on the store — signed by whatever operator the suite runs
// under. (The membership stays as vocabulary: the fern still belongs to the garden community,
// but authorize never asks.)
export function governedBootstrap(operatorSeed: string): Delta[] {
  const operator = authorForSeed(operatorSeed);
  return [
    signClaims(membershipClaims("tenant:garden", FERN, operator, 9_001), operatorSeed),
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", operator, 9_002), operatorSeed),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", operator, 9_003), operatorSeed),
  ];
}

// Two readings whose VALUES (7, 9) differ from their COUNT (2): an assertion on the count can
// never be satisfied by a picked value.
export const garden = [
  observed(FERN, "height", 30, 1000, GARDENER_SEED),
  observed(FERN, "height", 34, 2000, SURVEYOR_SEED),
  observed(FERN, "tag", "shade", 1500, GARDENER_SEED),
  observed(FERN, "tag", "fronds", 1600, SURVEYOR_SEED),
  observed(FERN, "readings", 7, 1700, GARDENER_SEED),
  observed(FERN, "readings", 9, 1800, SURVEYOR_SEED),
];
