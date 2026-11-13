import { type Delta } from "@bombadil/rhizomatic";
import type { Ground } from "./ground.js";

export function withNegationClosure(
  ground: { readonly reactor: Ground },
  admitted: readonly Delta[],
): Delta[] {
  const out = new Map(admitted.map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const negationId of ground.reactor.negationsOf(id)) {
      if (out.has(negationId)) continue;
      const negation = ground.reactor.get(negationId);
      if (negation === undefined) continue;
      out.set(negationId, negation);
      pending.push(negationId);
    }
  }
  return [...out.values()];
}

export function withNegationClosureAcross(
  grounds: readonly { readonly reactor: Ground }[],
  admitted: readonly Delta[],
): Delta[] {
  const out = new Map(admitted.map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const g of grounds) {
      for (const negId of g.reactor.negationsOf(id)) {
        if (out.has(negId)) continue;
        const neg = g.reactor.get(negId);
        if (neg === undefined) continue;
        out.set(negId, neg);
        pending.push(negId);
      }
    }
  }
  return [...out.values()];
}
