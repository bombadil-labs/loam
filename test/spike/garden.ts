import { Reactor, authorForSeed, signClaims, type Delta, type Term } from "@bombadil/rhizomatic";
import { entityGatherBody } from "../../src/gateway/gather.js";
import { stamped, type Stamp } from "../../src/gateway/stamp.js";

export const GARDENER_SEED = "a1".repeat(32);
export const SURVEYOR_SEED = "b2".repeat(32);
export const GARDENER = authorForSeed(GARDENER_SEED);
export const SURVEYOR = authorForSeed(SURVEYOR_SEED);

export const FERN = "plant:fern";

export const PLANT_BODY: Term = entityGatherBody();

export function plantReactor(roots: readonly string[] = [FERN]): Reactor {
  const reactor = new Reactor();
  reactor.register("plant", PLANT_BODY, roots, Date.now());
  return reactor;
}

export function observed(
  plant: string,
  context: string,
  value: string | number,
  at: number | Stamp,
  seed: string,
): Delta {
  return signClaims(
    {
      ...(typeof at === "number" ? stamped(at) : at),
      author: authorForSeed(seed),
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: plant, context } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    seed,
  );
}
