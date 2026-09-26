import type { Reactor } from "@bombadil/rhizomatic";

/**
 * A Loam principal: the root key it is pinned to. A user's root is their own key (README ruling
 * 5), so today a user reference and a bare key coincide. A connection's signing key is not a root;
 * a caller that holds one must pass the user's root, not the connection key.
 */
export type PrincipalRef = { readonly root: string };

/**
 * The keys that act for `who` at `now` within `scope`: the present question, asked where a
 * grant's subject is matched to an author, or a user's accepted keys are listed. `scope` is the
 * requested scope under the prefix policy; `"*"` asks for authority in every scope.
 */
export function keysActingFor(
  reactor: Reactor,
  now: number,
  who: PrincipalRef,
  scope: string,
): ReadonlySet<string> {
  // Step-5 limit: a principal is exactly its root key. Step 5 swaps in `authorsForPrincipal`.
  void reactor;
  void now;
  void scope;
  return new Set([who.root]);
}

/**
 * Every key ever associated with `who`, as evidence held at `now`: the history question, asked
 * where "your own" deltas are selected, so a recovered principal can still retract what an
 * earlier key wrote. Step 5 reads negations of that evidence under `rootOrSameAuthor`.
 */
export function keysEverOf(reactor: Reactor, now: number, who: PrincipalRef): ReadonlySet<string> {
  // Step-5 limit: a principal is exactly its root key. Step 5 swaps in `associatedKeys`.
  void reactor;
  void now;
  return new Set([who.root]);
}
