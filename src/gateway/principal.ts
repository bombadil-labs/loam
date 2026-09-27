import {
  associatedKeys,
  authorsForPrincipal,
  resolvePrincipal,
  verifyDelta,
  type Reactor,
  type Suppression,
} from "@bombadil/rhizomatic";

/**
 * A Loam principal: the root key it is pinned to. A user's root is their own key (README ruling
 * 5). A connection's signing key is not a root; a caller that holds one must pass the user's root,
 * not the connection key.
 */
export type PrincipalRef = { readonly root: string };

// SPEC-14 reads refuse a root that is not a lowercase Ed25519 author id. A grant subject is an
// opaque string in Loam, so a subject that is not a key names no principal and matches itself only.
const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

const suppressions = new Map<string, Suppression>();

/**
 * Who may revoke principal evidence (README ruling 6): the record's own signer — the root, for
 * every delegation Loam honors — or the store's pinned operator. The negation's signature must
 * verify; an unsigned negation revokes nothing. The rule never reads the root, so one callback
 * serves every principal and a membership lowering can share it across roots. Memoized per
 * operator so the reactor sees one stable callback.
 */
export function principalSuppression(operator: string | undefined): Suppression {
  const key = operator ?? "";
  let rule = suppressions.get(key);
  if (rule === undefined) {
    rule = (negation, target) =>
      (negation.claims.author === target.claims.author ||
        (operator !== undefined && negation.claims.author === operator)) &&
      verifyDelta(negation) === "verified";
    suppressions.set(key, rule);
  }
  return rule;
}

const readOptions = (now: number, scope: string, operator: string | undefined) =>
  ({
    at: now,
    now,
    scope,
    scopePolicy: "prefix",
    suppression: principalSuppression(operator),
  }) as const;

/**
 * Does `key` act for `who` at `now` within `scope`? The root always does. Any other key needs a
 * DIRECT delegation from the root, valid at `now`, unrevoked, whose scope covers `scope` under the
 * prefix policy: a delegation cannot be passed on (ruling 6), so a key reached through a second
 * edge does not count even when the first edge says `delegable`. What the key may then DO is the
 * caller's question — a delegate satisfies write standing and nothing else.
 */
export function keyActsFor(
  reactor: Reactor,
  now: number,
  who: PrincipalRef,
  key: string,
  scope: string,
  operator: string | undefined,
): boolean {
  if (key === who.root) return true;
  if (!AUTHOR.test(who.root) || !AUTHOR.test(key)) return false;
  return resolvePrincipal(
    reactor,
    who.root,
    key,
    readOptions(now, scope, operator),
  ).authorityPaths.some((path) => path.length === 1);
}

/**
 * Every key that acts for `who` at `now` within `scope`, by `keyActsFor`'s rule: the present
 * question, asked where a user's accepted keys are listed. `"*"` asks for authority in every
 * scope, which only a `*`-scoped delegation grants.
 */
export function keysActingFor(
  reactor: Reactor,
  now: number,
  who: PrincipalRef,
  scope: string,
  operator: string | undefined,
): ReadonlySet<string> {
  if (!AUTHOR.test(who.root)) return new Set([who.root]);
  const authors = authorsForPrincipal(reactor, who.root, readOptions(now, scope, operator));
  return new Set(authors.filter((key) => keyActsFor(reactor, now, who, key, scope, operator)));
}

/**
 * Every key ever associated with `who`, as evidence held at `now`: the history question, asked
 * where "your own" deltas are selected, so a recovered principal can still retract what an
 * earlier key wrote. Association comes only from root-signed bindings and successions; rows whose
 * evidence is now negated or expired still count, because history is history.
 */
export function keysEverOf(reactor: Reactor, now: number, who: PrincipalRef): ReadonlySet<string> {
  if (!AUTHOR.test(who.root)) return new Set([who.root]);
  const rows = associatedKeys(reactor, who.root, now, "rootOrSameAuthor");
  return new Set([who.root, ...rows.map((row) => row.key)]);
}
