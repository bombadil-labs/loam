import type { Ground } from "./ground.js";

export function negatedAt(
  reactor: Ground,
  now: number,
  author: string | undefined,
): (id: string) => boolean {
  return reactor.negationPredicate(
    now,
    author === undefined ? () => true : (negation) => negation.claims.author === author,
  );
}

export function lawfulNegated(reactor: Ground, operator?: string): (id: string) => boolean {
  const memo = new Map<string, boolean>();
  const negated = (id: string): boolean => {
    const memoed = memo.get(id);
    if (memoed !== undefined) return memoed;
    memo.set(id, false);
    const verdict = reactor
      .negationsOf(id)
      .some((negation) => isLawful(reactor, negation, operator) && !negated(negation));
    memo.set(id, verdict);
    return verdict;
  };
  return negated;
}

function isLawful(reactor: Ground, id: string, operator?: string): boolean {
  const delta = reactor.get(id);
  if (delta === undefined) return false;
  return operator === undefined || delta.claims.author === operator;
}
