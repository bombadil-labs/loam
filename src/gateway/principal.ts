import {
  associatedKeys,
  authorsForPrincipal,
  resolvePrincipal,
  computeId,
  verifyDelta,
  type Delta,
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

const negates = (d: Delta): boolean => d.claims.pointers.some((p) => p.role === "negates");

// The door asks this on every write, so a verified signature is cached per held object, keyed by
// the id AND the signature it was verified over, with the content address rechecked: an object
// whose claims, id or signature changed since is verified afresh.
const verified = new WeakMap<Delta, { readonly id: string; readonly sig: string }>();
function signed(d: Delta): boolean {
  const hit = verified.get(d);
  if (hit !== undefined && hit.id === d.id && hit.sig === d.sig && computeId(d.claims) === d.id) {
    return true;
  }
  if (verifyDelta(d) !== "verified") return false;
  verified.set(d, { id: d.id, sig: d.sig! });
  return true;
}

/**
 * Who may revoke principal evidence (README ruling 6): the record's own signer — the root, for
 * every delegation Loam honors — or the store's pinned operator. The operator may only REVOKE: its
 * signature counts against evidence, never against another negation, or it could undo the root's
 * own revocation and hand the delegate back. The negation's signature must verify; an unsigned
 * negation revokes nothing. The rule never reads the root, so one callback serves every principal
 * and a membership lowering can share it across roots. Memoized per operator so the reactor sees
 * one stable callback.
 */
export function principalSuppression(operator: string | undefined): Suppression {
  const key = operator ?? "";
  let rule = suppressions.get(key);
  if (rule === undefined) {
    rule = (negation, target) =>
      (negation.claims.author === target.claims.author ||
        (operator !== undefined && negation.claims.author === operator && !negates(target))) &&
      signed(negation);
    suppressions.set(key, rule);
  }
  return rule;
}

// Loam's scope rule: SPEC-14's prefix policy, minus the universal edge, which would carry a
// delegate everywhere. This alone does not hold a delegate to one container: a broad scope still
// covers every request beneath it, so the one-container rule is kept by what Loam signs and by
// the scope each door asks with.
const loamScope = (edgeScope: string, request: string): boolean =>
  edgeScope !== "*" && (edgeScope === request || request.startsWith(`${edgeScope}:`));

const readOptions = (now: number, scope: string, operator: string | undefined) =>
  ({
    at: now,
    now,
    scope,
    scopePolicy: loamScope,
    suppression: principalSuppression(operator),
  }) as const;

// Is `id` a delegation that says it cannot be passed on? Its bytes are held: the path came from them.
const sealed = (reactor: Reactor, id: string): boolean =>
  reactor
    .get(id)
    ?.claims.pointers.some(
      (p) => p.role === "delegable" && p.target.kind === "primitive" && p.target.value === false,
    ) === true;

/**
 * Does `key` act for `who` at `now` within `scope`? The root always does. Any other key needs the
 * one delegation shape Loam honors (README ruling 6): from the root, `delegable: false`, scoped
 * to something other than `*`, covering `scope` by prefix, valid at `now`, and unrevoked. Every
 * edge must be sealed, and SPEC-14 ends a chain at a sealed edge, so the path is one edge long.
 * SPEC-14 would also honor a delegable edge, the chain behind it, or a universal scope; Loam
 * refuses all three on the read, so a hand-signed record cannot widen a delegate past its scope.
 * What the key may then DO is the caller's question — a delegate satisfies write standing only.
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
  // Every piece of principal evidence points at the root's entity; a root nothing points at has
  // delegated nothing, and the door skips the full read for every grant it is not about.
  if (reactor.byTarget(who.root).length === 0) return false;
  return resolvePrincipal(
    reactor,
    who.root,
    key,
    readOptions(now, scope, operator),
  ).authorityPaths.some((path) => path.every((id) => sealed(reactor, id)));
}

/**
 * Every key that acts for `who` at `now` within `scope`, by `keyActsFor`'s rule: the present
 * question, asked where a user's accepted keys are listed. `"*"` asks for authority in every
 * scope, which no delegation Loam honors grants: that request answers the root alone.
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
