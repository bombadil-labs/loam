import type { Reactor } from "@bombadil/rhizomatic";

/**
 * A Loam principal reference: today a bare key; after step 5 a Loam user (resolved to its pinned
 * root at read time) or the operator.
 */
export type PrincipalRef = { readonly key: string };

/**
 * The keys that act for `who` at `now`: the present question, asked where a grant's subject is
 * matched to an author, or a user's accepted keys are listed.
 */
export function keysActingFor(
  reactor: Reactor,
  now: number,
  who: PrincipalRef,
): ReadonlySet<string> {
  // Step-5 limit: a principal is exactly its one key. Step 5 swaps in `authorsForPrincipal`.
  void reactor;
  void now;
  return new Set([who.key]);
}

/**
 * Every key ever associated with `who`: the history question, asked where "your own" deltas are
 * selected, so a recovered principal can still retract what an earlier key wrote.
 */
export function keysEverOf(reactor: Reactor, who: PrincipalRef): ReadonlySet<string> {
  // Step-5 limit: a principal is exactly its one key. Step 5 swaps in `associatedKeys`.
  void reactor;
  return new Set([who.key]);
}
