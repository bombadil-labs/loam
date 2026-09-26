import type { Reactor } from "@bombadil/rhizomatic";

/**
 * Whether a delta is negated at `now`, counting only negations signed by `author` (any author
 * when `author` is undefined), applied down the whole negation chain. A negation counts only
 * while it is valid at `now`; the target's own validity is not asked. A target the store does not
 * hold answers false. The reader clears its memo after an accepted ingest.
 */
export function negatedAt(
  reactor: Reactor,
  now: number,
  author: string | undefined,
): (id: string) => boolean {
  return reactor.negationPredicate(
    now,
    author === undefined ? () => true : (negation) => negation.claims.author === author,
  );
}

// The substrate's negation algebra, over the lawful slice — shared by every constitutional
// reader (registrations here, binding definitions in the runner): a negation retires its
// target only while it survives itself (negating the negation revives), and only LAWFUL
// negations count — a write-granted author's strike, or a federated stranger's, retires
// nothing the operator planted. Content addressing keeps the chain acyclic; memoized anyway.
export function lawfulNegated(reactor: Reactor, operator?: string): (id: string) => boolean {
  const memo = new Map<string, boolean>();
  const negated = (id: string): boolean => {
    const memoed = memo.get(id);
    if (memoed !== undefined) return memoed;
    memo.set(id, false); // in-progress: treat as surviving (acyclic by construction)
    const verdict = reactor
      .negationsOf(id)
      .some((negation) => isLawful(reactor, negation, operator) && !negated(negation));
    memo.set(id, verdict);
    return verdict;
  };
  return negated;
}

// Membership of the lawful slice, asked one id at a time (hazard H8). The set answer and this one
// agree by construction: `lawfulSnapshot` is `reactor.snapshot()` filtered on author, `reactor.get`
// reads the same set, so `lawfulIds.has(id)` and this are the SAME predicate — one materializes
// every delta to answer, the other answers from the id.
//
// It is not a stored index and cannot go stale: there is no state here to fall behind the ground.
// Every answer is read from the reactor at the moment it is asked.
function isLawful(reactor: Reactor, id: string, operator?: string): boolean {
  const delta = reactor.get(id);
  if (delta === undefined) return false; // gone is gone — a purged strike retires nothing (§11)
  return operator === undefined || delta.claims.author === operator;
}
