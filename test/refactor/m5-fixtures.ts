// The nested Bed fixture the M5 tests share: a bed whose plants expand through the Plant reading.

import { parseTerm, signClaims } from "@bombadil/rhizomatic";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";

export const BED = "bed:shade";
const PICK = {
  kind: "pick" as const,
  order: { kind: "byTimestamp" as const, dir: "desc" as const },
};
export const BED_WITH_PLANTS_JSON = {
  op: "expand",
  role: { exact: "plant" },
  schema: "Plant",
  reading: "Plant",
  in: {
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  },
};
export const BED_WITH_PLANTS = {
  name: "BedWithPlants",
  alg: 1,
  body: parseTerm(BED_WITH_PLANTS_JSON),
};
export const BED_READING = {
  name: "BedWithPlants",
  alg: 1,
  props: new Map([["plants", PICK]]),
  default: PICK,
};
export const planting = signClaims(
  {
    timestamp: 1100,
    validFrom: 1100,
    author: GARDENER,
    pointers: [
      { role: "bed", target: { kind: "entity", entity: { id: BED, context: "plants" } } },
      { role: "plant", target: { kind: "entity", entity: { id: FERN, context: "planted" } } },
    ],
  },
  GARDENER_SEED,
);
