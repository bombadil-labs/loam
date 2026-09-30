// The lawful readers: the deltas a governed ground's own key signed, filed at an entity or across
// the ground, at a read time or across history. A leaf, so every reader of law can import it.

import { DeltaSet, governedDeltas, type Delta, type Reactor } from "@bombadil/rhizomatic";

// The slice of the store whose law binds: everything when ungoverned, the operator's deltas
// when governed. Definitions, registrations, and negations are all read from this set — a
// foreign negation can no more retire the operator's schema than a foreign definition can
// replace it.
/** The operator's deltas that hold at `now`. */
export function lawfulSnapshot(
  reactor: Reactor,
  now: number,
  operator?: string | readonly string[],
): DeltaSet {
  return governedDeltas(
    reactor.snapshot(),
    now,
    operator === undefined
      ? () => true
      : new Set(typeof operator === "string" ? [operator] : operator),
  );
}

/** Every delta the operator ever signed, whatever its validity. For questions about history. */
export function lawfulHistory(reactor: Reactor, operator?: string): DeltaSet {
  if (operator === undefined) return reactor.snapshot();
  return DeltaSet.from([...reactor.snapshot()].filter((d) => d.claims.author === operator));
}

// Every surviving registration, its schema GENERATED from the surviving definition deltas.
// The latest registration per schema entity names the policy and roots; `loadHyperSchema` over the
// lawful slice yields the schema itself. A registration whose definition does not survive (or
// never arrived, or is malformed) binds nothing — unbound, never a crash.
// The lawful deltas FILED AT one entity under one context — the question every constitutional
// reader actually asks, answered from the reactor's target index rather than by walking the store
// (hazard H8). `byTarget` is the substrate's own index, written inside `ingest` alongside the set
// it indexes, so it cannot disagree with a snapshot taken in the same breath; an erase rebuilds
// both together by replaying the reactor.
//
// This narrows a delta-set and therefore owes H1 an answer: it does NOT carry negation closure,
// because it is not a set handed to an evaluator. It is a candidate list, and every caller runs
// `lawfulNegated` over the ids it returns — the negation algebra stays where it was, at the reader.
//
// ORDER: `byTarget` answers in id order, where a snapshot answers in ingest order. Callers here
// pick a winner by (timestamp, id) or union into a Set, so both orders give the same answer; a
// caller for whom ingest order MATTERS must not use this.
//
// THE BOUND IS NOT CONSTANT. This costs one pass over the deltas filed at ONE entity id — across
// every context, since the index keys on the id alone. For the store's constitutional entities
// that is the declaration history, which grows only when the operator legislates. For a CONTAINER
// entity it also carries that container's exclusions and detach records. Small, and unrelated to
// the size of the store; still not O(1).
// THE COORDINATE IS ONE ARGUMENT, deliberately. Entity ids and contexts are both bare strings, so
// three positional strings would let a caller drop the context and still compile — and the readers
// do NOT fail in a uniform direction when their candidate list comes back empty: trust answers
// `open` and budget answers unmetered (both ADMIT), while public and artifact answer the empty set
// (which refuses). A silently-widened door is not a mistake the compiler may be allowed to miss.
export interface LawAt {
  readonly entity: string;
  readonly context: string;
}

/** The operator's law filed at `at` that holds at `now`. */
export function lawfulDeltasAt(
  reactor: Reactor,
  now: number,
  at: LawAt,
  operator?: string,
): Delta[] {
  return lawfulHistoryAt(reactor, at, operator).filter(
    (d) =>
      d.claims.validFrom <= now && (d.claims.validUntil === undefined || now < d.claims.validUntil),
  );
}

/**
 * Every lawful delta ever filed at `at`, whatever its validity. For a historical question such as
 * "was this name ever declared", where an expired declaration must still count.
 */
export function lawfulHistoryAt(reactor: Reactor, at: LawAt, operator?: string): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(at.entity)) {
    // Unreachable against today's substrate: nothing removes from the reactor's set, and an erase
    // replays a fresh one, so an id the index names is an id the set holds. It REFUSES rather than
    // skipping, because skipping would fail in the wrong direction — a dropped declaration shrinks
    // the lawful list, and an empty trust list reads as `open`. That is H9 exactly: an answer the
    // reader never determined, spent as a licence to admit. If a removal API ever lands, this
    // wants a decision, and a hard error is what makes the decision unavoidable.
    const delta = reactor.get(id);
    if (delta === undefined) {
      throw new Error(
        `the target index names delta ${id} at ${at.entity}, and the store cannot resolve it — ` +
          `refusing to read law from a ground that disagrees with its own index`,
      );
    }
    if (operator !== undefined && delta.claims.author !== operator) continue;
    const filedHere = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === at.entity &&
        p.target.entity.context === at.context,
    );
    if (filedHere) out.push(delta);
  }
  return out;
}
