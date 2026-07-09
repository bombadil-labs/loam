// The gateway suite's shared world: the Plant schema, its policy, and a small settled garden.

import type { HyperSchema, Policy, PropPolicy } from "@bombadil/rhizomatic";
import { FERN, GARDENER_SEED, PLANT_BODY, SURVEYOR_SEED, observed } from "../spike/garden.js";

export const PLANT: HyperSchema = { name: "Plant", alg: 1, body: PLANT_BODY };

export const pickLatest: PropPolicy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };

export const PLANT_POLICY: Policy = {
  props: new Map<string, PropPolicy>([
    ["height", pickLatest],
    ["tag", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
    ["watered", { kind: "absentAs", constant: false, then: pickLatest }],
    ["readings", { kind: "merge", fn: "count" }],
  ]),
  default: pickLatest,
};

export const garden = [
  observed(FERN, "height", 30, 1000, GARDENER_SEED),
  observed(FERN, "height", 34, 2000, SURVEYOR_SEED),
  observed(FERN, "tag", "shade", 1500, GARDENER_SEED),
  observed(FERN, "tag", "fronds", 1600, SURVEYOR_SEED),
  observed(FERN, "readings", 1, 1700, GARDENER_SEED),
];
