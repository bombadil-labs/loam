import {
  associatedKeys,
  authorsForPrincipal,
  resolvePrincipal,
  computeId,
  verifyDelta,
  type Claims,
  type Delta,
  type Reactor,
  type Suppression,
} from "@bombadil/rhizomatic";
import { recoveredFrom, userGroundOf } from "./user-root.js";

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

// Loam's scope rule: EXACT, and never the universal edge. A delegation reaches the one ground whose
// declared scope it names (an inbox pool, by its own name) and no other: not a child, not a sibling
// that shares its prefix. Every child container has its own pool, so prefix coverage could only
// carry a hand-signed ancestor scope into pools it was never meant for (README ruling 6).
const loamScope = (edgeScope: string, request: string): boolean =>
  edgeScope !== "*" && edgeScope === request;

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
 * to exactly `scope` (never `*`), valid at `now`, and unrevoked. Every
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
 * Every key whose deltas count as `who`'s own: the history question, asked where "your own" deltas
 * are selected (clear, unlink, a translator's renderings). The root, plus each earlier key a
 * recovery replaced, when BOTH hold: an unbroken operator recovery chain names the pair (previous
 * → root), and the later root's SPEC-14 binding for the earlier key is held. A binding alone is only
 * association evidence, which any writer can sign about anyone's key, so it never makes a key "own".
 * Read from the host's ground, where recoveries and bindings live; a ground with no host answers
 * the root alone.
 */
export function keysEverOf(
  reactor: Reactor,
  now: number,
  who: PrincipalRef,
  operator: string | undefined,
): ReadonlySet<string> {
  const out = new Set<string>([who.root]);
  if (!AUTHOR.test(who.root)) return out;
  const users = userGroundOf(reactor);
  const erased = users.erased();
  const frontier = [who.root];
  while (frontier.length > 0) {
    const key = frontier.pop()!;
    for (const earlier of recoveredFrom(users.reactor, operator, key, erased)) {
      if (out.has(earlier) || !bindingHeld(users.reactor, now, key, earlier, erased)) continue;
      out.add(earlier);
      frontier.push(earlier);
    }
  }
  return out;
}

// Does `root` hold a SPEC-14 binding for `key` (negated or not: history is history)? Read through
// the substrate's own association evidence, which parses only the exact binding shape and verifies
// each binding's signature, so a raw-ingested row that merely looks like one does not count.
function bindingHeld(
  reactor: Reactor,
  now: number,
  root: string,
  key: string,
  erased: ReadonlySet<string>,
): boolean {
  return associatedKeys(reactor, root, now, "rootOrSameAuthor").some(
    (row) => row.key === key && row.via.length === 1 && !erased.has(row.via[0]!),
  );
}

// The scope a ground's write door asks delegations about. Only a ground that declares one honors a
// delegate at all: an inbox pool declares its own name, and the root store declares none, so a
// delegation record copied anywhere else grants nothing. Keyed by reactor because every road into a
// ground reaches it through its reactor; a gateway that replaces its reactor declares again.
const declaredScopes = new WeakMap<Reactor, string>();

/** Declare `scope` as the one scope `reactor`'s ground honors delegations for. */
export function declarePrincipalScope(reactor: Reactor, scope: string): void {
  declaredScopes.set(reactor, scope);
}

/** The scope `reactor`'s ground honors delegations for, or undefined: it honors none. */
export function principalScopeOf(reactor: Reactor): string | undefined {
  return declaredScopes.get(reactor);
}

const prim = (role: string, value: string | boolean) =>
  ({ role, target: { kind: "primitive", value } }) as const;

/**
 * The one delegation shape Loam signs (README ruling 6): from `root` to `key`, for `scope`, sealed.
 * A SPEC-14 §2 evidence record: one `principal` pointer at the root, one `kind`, and the listed roles.
 */
export function delegationClaims(root: string, key: string, scope: string, t: number): Claims {
  return {
    timestamp: t,
    validFrom: t,
    author: root,
    pointers: [
      {
        role: "principal",
        target: { kind: "entity", entity: { id: root, context: "rhizomatic.principal" } },
      },
      prim("kind", "delegation"),
      prim("key", key),
      prim("scope", scope),
      prim("delegable", false),
    ],
  };
}

/**
 * The delegation records that make `key` act for `who` in `scope` right now: what a revocation
 * must strike so the key stops acting. Empty when the key does not act by delegation.
 */
export function standingDelegationIds(
  reactor: Reactor,
  now: number,
  who: PrincipalRef,
  key: string,
  scope: string,
  operator: string | undefined,
): string[] {
  if (key === who.root || !AUTHOR.test(who.root) || !AUTHOR.test(key)) return [];
  const paths = resolvePrincipal(
    reactor,
    who.root,
    key,
    readOptions(now, scope, operator),
  ).authorityPaths;
  return [...new Set(paths.filter((p) => p.every((id) => sealed(reactor, id))).flat())].sort();
}

/**
 * What each delegation record from one of `roots` naming `key` in this ground says at `now`: "revoked" when a negation
 * the suppression rule honors strikes it, "not yet valid" or "expired" by its own window, and
 * "standing" otherwise. A label reads the record only; it does not say its signer could delegate.
 */
export function delegationStatesFor(
  reactor: Reactor,
  now: number,
  roots: Iterable<string>,
  key: string,
  operator: string | undefined,
): ("revoked" | "not yet valid" | "expired" | "standing")[] {
  const negated = reactor.negationPredicate(now, principalSuppression(operator));
  const out: ("revoked" | "not yet valid" | "expired" | "standing")[] = [];
  for (const d of delegationRecordsFor(reactor, roots, key)) {
    const { validFrom, validUntil } = d.claims;
    if (now < validFrom) out.push("not yet valid");
    else if (validUntil !== undefined && now >= validUntil) out.push("expired");
    else out.push(negated(d.id) ? "revoked" : "standing");
  }
  return out;
}

/**
 * `standingDelegationIds` for each of `roots` that delegated to `key` in this ground: the records a
 * revocation of the key must strike, whoever signed them. Empty when the key acts by none.
 */
export function standingDelegationIdsFor(
  reactor: Reactor,
  now: number,
  roots: Iterable<string>,
  key: string,
  scope: string,
  operator: string | undefined,
): string[] {
  const ids = [...roots].flatMap((root) =>
    standingDelegationIds(reactor, now, { root }, key, scope, operator),
  );
  return [...new Set(ids)].sort();
}

/**
 * Every root that has signed a delegation to `key` held here, whatever its standing. Delegations are
 * filed at their root, not their key, so this walks the log: a revoke asks it, and revokes are rare.
 */
export function delegationRootsTo(reactor: Reactor, key: string): string[] {
  const out = new Set<string>();
  for (const d of reactor.arrivalLog()) {
    const at = (role: string) => d.claims.pointers.find((p) => p.role === role)?.target;
    const kind = at("kind");
    const named = at("key");
    if (kind?.kind !== "primitive" || kind.value !== "delegation") continue;
    if (named?.kind === "primitive" && named.value === key) out.add(d.claims.author);
  }
  return [...out];
}

/**
 * The delegation records naming `key` signed by one of `roots`, read from each root's own index:
 * every SPEC-14 evidence record points at its root's entity. A delegate only ever acts for a root
 * that holds a grant here, so the grant subjects are the roots worth asking about.
 */
export function delegationRecordsFor(
  reactor: Reactor,
  roots: Iterable<string>,
  key: string,
): Delta[] {
  const out: Delta[] = [];
  for (const root of new Set(roots)) {
    for (const id of reactor.byTarget(root)) {
      const d = reactor.get(id);
      if (d === undefined || d.claims.author !== root) continue;
      const at = (role: string) => d.claims.pointers.find((p) => p.role === role)?.target;
      const kind = at("kind");
      const named = at("key");
      if (kind?.kind !== "primitive" || kind.value !== "delegation") continue;
      if (named?.kind === "primitive" && named.value === key) out.push(d);
    }
  }
  return out;
}
