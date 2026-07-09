// The spike's shared world: a small garden, observed by two signing authors. Every spike test
// grows from these fixtures, exercising four of SPEC §2's claim clusters (schema-schema,
// resolution, reactor, function substrate) over one domain.

import {
  Reactor,
  authorForSeed,
  parseTerm,
  signClaims,
  type Delta,
  type Term,
} from "@bombadil/rhizomatic";

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

// A reactor watching the garden: the "plant" materialization rooted at each given plant.
export function plantReactor(roots: readonly string[] = [FERN]): Reactor {
  const reactor = new Reactor();
  reactor.register("plant", PLANT_BODY, roots);
  return reactor;
}

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
