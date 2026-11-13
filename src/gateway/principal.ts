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
import { declarationsOf } from "./ground-declarations.js";
import { recoveredFrom, userGroundOf, usersGovernor } from "./user-root.js";
import type { Ground } from "./ground.js";

export type PrincipalRef = { readonly root: string };

const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

const suppressions = new Map<string, Suppression>();

const negates = (d: Delta): boolean => d.claims.pointers.some((p) => p.role === "negates");

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

const sealed = (reactor: Ground, id: string): boolean =>
  reactor
    .get(id)
    ?.claims.pointers.some(
      (p) => p.role === "delegable" && p.target.kind === "primitive" && p.target.value === false,
    ) === true;

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
  if (reactor.byTarget(who.root).length === 0) return false;
  return resolvePrincipal(
    reactor,
    who.root,
    key,
    readOptions(now, scope, operator),
  ).authorityPaths.some((path) => path.every((id) => sealed(reactor, id)));
}

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
    for (const earlier of recoveredFrom(
      users.reactor,
      usersGovernor(users, operator),
      key,
      erased,
    )) {
      if (out.has(earlier) || !bindingHeld(users.reactor, now, key, earlier, erased)) continue;
      out.add(earlier);
      frontier.push(earlier);
    }
  }
  return out;
}

export function bindingHeld(
  reactor: Reactor,
  now: number,
  root: string,
  key: string,
  erased: ReadonlySet<string>,
): boolean {
  return associatedKeys(reactor, root, now, "rootOrSameAuthor").some((row) => {
    if (row.key !== key || row.via.length !== 1 || row.negated || erased.has(row.via[0]!)) {
      return false;
    }
    const kind = reactor.get(row.via[0]!)?.claims.pointers.find((p) => p.role === "kind")?.target;
    return kind?.kind === "primitive" && kind.value === "binding";
  });
}

export function declarePrincipalScope(reactor: Reactor, scope: string): void {
  declarationsOf(reactor).principalScope = scope;
}

export function principalScopeOf(reactor: Reactor): string | undefined {
  return declarationsOf(reactor).principalScope;
}

const prim = (role: string, value: string | boolean) =>
  ({ role, target: { kind: "primitive", value } }) as const;

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

export function delegationStatesFor(
  reactor: Ground,
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

export function delegatesEverOf(
  reactor: Ground,
  roots: Iterable<string>,
  scope: string,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const root of new Set(roots)) {
    for (const id of reactor.byTarget(root)) {
      const d = reactor.get(id);
      if (d === undefined || d.claims.author !== root || !signed(d)) continue;
      const ps = d.claims.pointers;
      const one = (role: string) => ps.filter((p) => p.role === role);
      const prim1 = (role: string) => {
        const [p, extra] = one(role);
        return extra === undefined && p?.target.kind === "primitive" ? p.target.value : undefined;
      };
      const [principal, extraPrincipal] = one("principal");
      const key = prim1("key");
      if (
        ps.length !== 5 ||
        extraPrincipal !== undefined ||
        principal?.target.kind !== "entity" ||
        principal.target.entity.id !== root ||
        principal.target.entity.context !== "rhizomatic.principal" ||
        prim1("kind") !== "delegation" ||
        prim1("scope") !== scope ||
        prim1("delegable") !== false ||
        typeof key !== "string" ||
        !AUTHOR.test(key)
      ) {
        continue;
      }
      out.add(key);
    }
  }
  return out;
}

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

export function delegationRecordsFor(
  reactor: Ground,
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
