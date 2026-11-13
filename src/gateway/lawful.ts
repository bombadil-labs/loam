// The lawful readers: the deltas a governed ground's own key signed, filed at an entity or across
// the ground, at a read time or across history. A leaf, so every reader of law can import it.

import { DeltaSet, governedDeltas, type Delta, type Reactor } from "@bombadil/rhizomatic";
import type { Ground } from "./ground.js";

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
  reactor: Ground,
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
export function lawfulHistoryAt(reactor: Ground, at: LawAt, operator?: string): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(at.entity)) {
    const delta = indexed(reactor, id, at.entity);
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

// Unreachable against today's substrate: nothing removes from the reactor's set, and an erase
// replays a fresh one, so an id an index names is an id the set holds. It REFUSES rather than
// skipping, because skipping would fail in the wrong direction — a dropped declaration shrinks
// the lawful list, and an empty trust list reads as `open`; a dropped strike revives what it
// struck. That is H9 exactly: an answer the reader never determined, spent as a licence to admit.
// If a removal API ever lands, this wants a decision, and a hard error is what makes the decision
// unavoidable.
function indexed(ground: Ground, id: string, entity: string): Delta {
  const delta = ground.get(id);
  if (delta === undefined) {
    throw new Error(
      `the target index names delta ${id} at ${entity}, and the store cannot resolve it — ` +
        `refusing to read law from a ground that disagrees with its own index`,
    );
  }
  return delta;
}

/**
 * The operand for an evaluation that selects the deltas pointing at `entity` and masks them, such
 * as the two definition loaders: the operator's deltas that hold at `now` and point at `entity`,
 * and every negation in their chains that is the operator's and holds at `now`.
 *
 * It is `lawfulSnapshot` cut down to the members such an evaluation can see. The select keeps only
 * the deltas at `entity`, and whether one is masked depends only on the lawful negations of it, of
 * those negations, and so on (H1). A lawful negation whose target is outside this set changes
 * nothing the select keeps, so it is left out. A body that reads a second entity (an expand, a
 * reference) needs more than this and must not be handed it.
 *
 * `alsoNegated` names deltas the caller will add to the set itself. Their lawful negations in the
 * ground join the set, because a strike can be held before the delta it strikes.
 *
 * ORDER: members come in index order, not ingest order. The loaders sort by (timestamp, id), so
 * they cannot see the difference; a caller that reads this set's iteration order must not use it.
 */
export function lawfulScopeAt(
  ground: Ground,
  now: number,
  entity: string,
  operator?: string,
  alsoNegated: Iterable<string> = [],
): DeltaSet {
  if (!Number.isFinite(now)) throw new Error("now must be a finite number");
  const out = new Map<string, Delta>();
  const pending = [...ground.byTarget(entity)];
  for (const id of alsoNegated) pending.push(...ground.negationsOf(id));
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (out.has(id)) continue;
    const delta = indexed(ground, id, entity);
    const { author, validFrom, validUntil } = delta.claims;
    if (operator !== undefined && author !== operator) continue;
    if (validFrom > now || (validUntil !== undefined && now >= validUntil)) continue;
    out.set(id, delta);
    pending.push(...ground.negationsOf(id));
  }
  return DeltaSet.from(out.values());
}
