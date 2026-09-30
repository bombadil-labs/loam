// The strikes that travel with a set of deltas: every surviving negation of a member, and of
// those negations, as a ground holds them. Pure over reactors, so every reader can import it
// without joining the gateway's import cycle.

import { type Delta, type Reactor } from "@bombadil/rhizomatic";

// A filter narrows what you SEE; it must never resurrect what was STRUCK (SPEC §28.4, ticket T38).
//
// rhizomatic's `negated(d, D)` ranges over the OPERAND SET (SPEC-2 §4.3): suppression is a property
// of the set being evaluated, not of the delta. So filtering a delta-set and keeping a claim while
// dropping the negation that struck it hands the reader a claim that reads as LIVE — the substrate's
// own `select-then-mask-scopes-to-operand` vector, correct behavior punishing a careless filter.
// Loam had exactly that hole in both of its filters (the membership seeding edge inward, the offered
// lens outward) until T38.
//
// The remedy is a closure, and its DIRECTION is the whole of its safety: from an admitted delta to
// the negations OF it, transitively — never the reverse. Following negations forward preserves what
// survives; following them backward would drag in targets the filter deliberately excluded, turning
// a scope into a leak. Transitive because a struck strike REVIVES: carrying one link would leave a
// revived claim wrongly suppressed, which is the same failure mirrored.
//
// Terminates because the output set only grows and is bounded by the store (and the chain is
// acyclic anyway — content addressing means a negation cannot precede its target).
//
// It asks the ground exactly two questions, both answered from the reactor's INDEXES: who negates
// this id, and is that negation still held? Materializing the store into a private id→delta map
// instead would cost a pass over every delta plus a content re-address of each (`snapshot()` is
// `DeltaSet.from`) — per call, on a path six callers share, one of which runs it per accepted delta
// per watcher (H8: the affordance that avoids the scan must itself be correct; here the index IS the
// affordance, and `get` returning undefined for a purged negation is the same answer the map gave).
//
// THE CLOSURE IS DRAWN FROM THE LOCAL GROUND. A caller handing it deltas that are not in this store
// would silently under-close — the negations it needs are not local yet. That is the inbound
// federation case, and it has its own batch-scoped closure below.
// Typed on the REACTOR rather than the Gateway (structurally satisfied by one) so the readers that
// must compute a §27.2 freeze WITHOUT a gateway — and therefore without any chance of a read-door
// narrowing reaching the membership machinery (SPEC §29.3) — share this one closure instead of
// growing a second copy of it.
export function withNegationClosure(
  ground: { readonly reactor: Reactor },
  admitted: readonly Delta[],
): Delta[] {
  const out = new Map(admitted.map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const negationId of ground.reactor.negationsOf(id)) {
      if (out.has(negationId)) continue;
      const negation = ground.reactor.get(negationId);
      if (negation === undefined) continue; // purged (§11) — the hole is the point
      out.set(negationId, negation);
      pending.push(negationId);
    }
  }
  return [...out.values()];
}

// The same closure, but over SEVERAL grounds at once (SPEC §39): a container's gather may compose
// deltas from more than one store — a parent's own ground plus each of its inbox pools — and a
// strike of an admitted delta can live in ANY of them. A per-ground closure treats each store as a
// closure boundary, so it returns a claim from one ground while its strike sits in another. This one
// asks EVERY ground `negationsOf`/`get`, so a strand across the pool boundary cannot survive.
//
// Direction and monotonicity are identical to `withNegationClosure`: it only ADDS negations of what
// is already admitted, never drops a member and never revives a struck claim (more strikes in play
// means more suppression). Terminates for the same reason — the output set only grows and is bounded
// by the union of the grounds.
export function withNegationClosureAcross(
  grounds: readonly { readonly reactor: Reactor }[],
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
        if (neg === undefined) continue; // purged (§11) — the hole is the point
        out.set(negId, neg);
        pending.push(negId);
      }
    }
  }
  return [...out.values()];
}
