// The spike's shared world: a small garden, observed by two signing authors. Every spike test
// grows from these fixtures so the four SPEC §2 claim clusters are exercised over one domain.

import { authorForSeed, parseTerm, signClaims, type Delta, type Term } from "@bombadil/rhizomatic";

export const GARDENER_SEED = "a1".repeat(32);
export const SURVEYOR_SEED = "b2".repeat(32);
export const GARDENER = authorForSeed(GARDENER_SEED);
export const SURVEYOR = authorForSeed(SURVEYOR_SEED);

export const FERN = "plant:fern";

// The gather stage: everything pointing at the root, bucketed by target context.
export const PLANT_BODY: Term = parseTerm({
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
});

// One signed observation: `plant` has `value` in the `context` bucket, says `seed`'s key.
export function observed(
  plant: string,
  context: string,
  value: string | number,
  timestamp: number,
  seed: string,
): Delta {
  return signClaims(
    {
      timestamp,
      author: authorForSeed(seed),
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: plant, context } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    seed,
  );
}
