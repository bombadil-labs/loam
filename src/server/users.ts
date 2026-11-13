import {
  resolveView,
  type Claims,
  type Delta,
  type HyperSchema,
  type Policy,
  type Reactor,
  type Schema,
  type View,
} from "@bombadil/rhizomatic";
import { DeltaSet, evalTerm, parseTerm } from "@bombadil/rhizomatic";
import { erasedFromReading } from "../gateway/erase-law.js";
import { entityGatherBody } from "../gateway/gather.js";

import {
  chainRoot,
  CTX_ROLE,
  CTX_ROOT,
  CTX_USER,
  CTX_RECOVERY,
  CTX_LINEAGE,
  userEntity,
  userNameDefect,
  verified,
} from "../gateway/user-root.js";
import { CTX_GRANTS } from "../gateway/governed-trust.js";
import { membershipForValidation, namesMemberOf } from "../gateway/member-of.js";
import { containerDeclarationName } from "../gateway/container-law.js";
import type { Ground } from "../gateway/ground.js";
export { CTX_ROLE, CTX_ROOT, userEntity };

const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

export type UserRole = "operator" | "actor";
export const ROLES: readonly UserRole[] = ["operator", "actor"];

export { userNameDefect } from "../gateway/user-root.js";

const RESERVED = new Set(["inbox", "channel"]);

export function reservedNameDefect(name: string): string | undefined {
  return RESERVED.has(name)
    ? `"${name}" is reserved: a container whose name begins with it is a pool, which takes its ` +
        `leeway from the container it was opened into. Pick another name.`
    : undefined;
}

export function userRoleDefect(role: string): string | undefined {
  if (!ROLES.includes(role as UserRole)) {
    return `"${role}" is not a role this store ships: use ${ROLES.join(" or ")}`;
  }
  return undefined;
}

export function userClaims(name: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "user",
        target: { kind: "entity", entity: { id: userEntity(name), context: CTX_USER } },
      },
      { role: "name", target: { kind: "primitive", value: name } },
    ],
  };
}

export function rootClaims(name: string, root: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "user",
        target: { kind: "entity", entity: { id: userEntity(name), context: CTX_ROOT } },
      },
      { role: "root", target: { kind: "primitive", value: root } },
    ],
  };
}

export function roleClaims(
  name: string,
  role: UserRole,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "user",
        target: { kind: "entity", entity: { id: userEntity(name), context: CTX_ROLE } },
      },
      { role: "role", target: { kind: "primitive", value: role } },
    ],
  };
}

export function userHyperSchema(operator: string): HyperSchema {
  return {
    name: "LoamUser",
    alg: 1,
    body: entityGatherBody({
      authoredBy: operator,
      mask: { trust: { match: { field: "author", cmp: "eq", const: operator } } },
    }),
  };
}

const pickLatest: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };

const allRoles: Policy = { kind: "all", order: { kind: "byTimestamp", dir: "asc" } };

const USER_SCHEMA: Schema = {
  props: new Map<string, Policy>([
    [CTX_USER, pickLatest],
    [CTX_ROLE, allRoles],
    [CTX_ROOT, pickLatest],
  ]),
  default: pickLatest,
};

export function resolveUserView(
  reactor: Reactor,
  operator: string | undefined,
  now: number,
  name: string,
): View | undefined {
  if (operator === undefined) return undefined;
  if (userNameDefect(name) !== undefined) return undefined;
  const hidden = new Set(erasedFromReading(reactor, operator));
  const walked = new Set<string>();
  const check = (id: string): void => {
    if (walked.has(id)) return;
    walked.add(id);
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator) return;
    if (!verified(d)) {
      hidden.add(id);
      return;
    }
    for (const n of reactor.negationsOf(id)) check(n);
  };
  for (const id of reactor.byTarget(userEntity(name))) check(id);
  const snapshot = reactor.snapshot();
  const ground =
    hidden.size === 0 ? snapshot : DeltaSet.from([...snapshot].filter((d) => !hidden.has(d.id)));
  const result = evalTerm(userHyperSchema(operator).body, ground, now, userEntity(name));
  if (result.sort !== "hview") return undefined;
  const view = resolveView(USER_SCHEMA, result.hview);
  if (view === null || typeof view !== "object" || Array.isArray(view)) return undefined;
  return (view as Record<string, View>)[CTX_USER] === name ? view : undefined;
}

export function rolesOf(
  reactor: Reactor,
  operator: string | undefined,
  now: number,
  name: string,
): ReadonlySet<UserRole> {
  const view = resolveUserView(reactor, operator, now, name);
  const roles = new Set<UserRole>();
  if (view === undefined) return roles;
  const raw = (view as Record<string, View>)[CTX_ROLE];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    const known = ROLES.find((role) => role === value);
    if (known !== undefined) roles.add(known);
  }
  return roles;
}

export function rootOf(
  reactor: Reactor,
  operator: string | undefined,
  now: number,
  name: string,
): string | undefined {
  const view = resolveUserView(reactor, operator, now, name);
  if (view === undefined) return undefined;
  const fenced = chainRoot(reactor, now, operator, name, erasedFromReading(reactor, operator));
  if (fenced !== undefined) return fenced ?? undefined;
  const root = (view as Record<string, View>)[CTX_ROOT];
  return typeof root === "string" && AUTHOR.test(root) ? root : undefined;
}

function isDeclaration(operator: string, d: Delta): boolean {
  return d.claims.author === operator && containerDeclarationName(d.claims) !== undefined;
}

function membershipNames(text: string, user: string): boolean {
  let json: unknown;
  try {
    json = JSON.parse(text);
    parseTerm(membershipForValidation(json));
  } catch {
    return false;
  }
  return namesMemberOf(json, user);
}

export function keyEvidenceHeld(reactor: Ground, operator: string, name: string): boolean {
  const entity = userEntity(name);
  const BINDS = new Set([CTX_ROOT, CTX_RECOVERY, CTX_LINEAGE]);
  for (const id of reactor.byTarget(entity)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || !verified(d)) continue;
    if (
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === entity &&
          p.target.entity.context !== undefined &&
          BINDS.has(p.target.entity.context),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function nameStillHeld(
  reactor: Reactor,
  operator: string,
  now: number,
  name: string,
):
  | { readonly held: false }
  | { readonly held: true; readonly notYetValid: boolean; readonly ids: readonly string[] } {
  const entity = userEntity(name);
  const ids = new Set<string>();
  let notYetValid = false;
  const hold = (d: Delta): void => {
    ids.add(d.id);
    if (d.claims.validFrom > now) notYetValid = true;
  };
  const ACCOUNT = new Set([CTX_USER, CTX_ROLE, CTX_ROOT, CTX_RECOVERY, CTX_LINEAGE]);
  for (const id of reactor.byTarget(entity)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || !verified(d)) continue;
    const aboutPerson = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context !== undefined &&
        ACCOUNT.has(p.target.entity.context),
    );
    if (aboutPerson) hold(d);
  }
  const cited = new Map<string, Delta>();
  for (const d of reactor.arrivalLog()) {
    if (!verified(d)) continue;
    const grant =
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_GRANTS,
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === entity,
      );
    if (grant) hold(d);
    if (!isDeclaration(operator, d)) continue;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "primitive" || typeof p.target.value !== "string") continue;
      if (p.role === "membership" && membershipNames(p.target.value, name)) hold(d);
      if (p.role === "membershipAt") cited.set(p.target.value, d);
    }
  }
  for (const [id, declaration] of cited) {
    const published = reactor.get(id);
    if (published === undefined || !verified(published)) continue;
    const term = published.claims.pointers.find((p) => p.role === "term")?.target;
    if (
      term?.kind === "primitive" &&
      typeof term.value === "string" &&
      membershipNames(term.value, name)
    ) {
      hold(declaration);
      hold(published);
    }
  }
  return ids.size === 0 ? { held: false } : { held: true, notYetValid, ids: [...ids].sort() };
}
