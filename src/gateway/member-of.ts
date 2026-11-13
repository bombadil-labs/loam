import { bindingHeld, keysActingFor } from "./principal.js";
import { historyBefore } from "./recovery-cut.js";
import {
  recoveriesOf,
  retiredKeysOf,
  subjectKeyAt,
  USER_PREFIX,
  userGroundOf,
  usersGovernor,
  userNameDefect,
} from "./user-root.js";
import type { Reactor } from "@bombadil/rhizomatic";

export const MEMBER_OF = "loam.memberOf";

export const memberOf = (user: string, scope: string): Record<string, unknown> => ({
  [MEMBER_OF]: { user, scope },
});

export const writtenByUser = (user: string, scope: string): unknown => ({
  op: "select",
  pred: memberOf(user, scope),
  in: "input",
});

function nodeDefect(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${MEMBER_OF} takes { user, scope }`;
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "scope,user") return `${MEMBER_OF} takes exactly { user, scope }`;
  const { user, scope } = value as { user: unknown; scope: unknown };
  if (typeof user !== "string" || userNameDefect(user) !== undefined) {
    return `${MEMBER_OF}.user must be a user name`;
  }
  if (typeof scope !== "string" || scope.length === 0) {
    return `${MEMBER_OF}.scope must be a non-empty string`;
  }
  return undefined;
}

function mapNodes(
  json: unknown,
  replace: (user: string, scope: string) => unknown,
): { json: unknown; defect?: string } {
  let defect: string | undefined;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    const rec = node as Record<string, unknown>;
    if (MEMBER_OF in rec) {
      if (Object.keys(rec).length !== 1) {
        defect ??= `${MEMBER_OF} must stand alone as a predicate`;
        return node;
      }
      const bad = nodeDefect(rec[MEMBER_OF]);
      if (bad !== undefined) {
        defect ??= bad;
        return node;
      }
      const { user, scope } = rec[MEMBER_OF] as { user: string; scope: string };
      return replace(user, scope);
    }
    return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, walk(v)]));
  };
  const out = walk(json);
  return defect === undefined ? { json: out } : { json: out, defect };
}

const inSet = (authors: readonly string[]): unknown => ({
  match: { field: "author", cmp: "inSet", const: [...authors].sort() },
});

export function hasMemberOf(json: unknown): boolean {
  if (Array.isArray(json)) return json.some(hasMemberOf);
  if (json === null || typeof json !== "object") return false;
  const rec = json as Record<string, unknown>;
  return MEMBER_OF in rec || Object.values(rec).some(hasMemberOf);
}

export function namesMemberOf(json: unknown, user: string): boolean {
  if (Array.isArray(json)) return json.some((j) => namesMemberOf(j, user));
  if (json === null || typeof json !== "object") return false;
  const rec = json as Record<string, unknown>;
  const node = rec[MEMBER_OF] as { user?: unknown } | undefined;
  if (node !== undefined && node !== null && typeof node === "object" && node.user === user) {
    return true;
  }
  return Object.values(rec).some((v) => namesMemberOf(v, user));
}

export function membershipForValidation(json: unknown): unknown {
  const { json: out, defect } = mapNodes(json, () => inSet([]));
  if (defect !== undefined) throw new Error(defect);
  return out;
}

export function lowerMembershipJson(
  json: unknown,
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  refused: ReadonlySet<string>,
): unknown {
  const { json: out, defect } = mapNodes(json, (user, scope) => ({
    or: [
      inSet(presentAuthors(reactor, now, operator, user, scope)),
      {
        match: {
          field: "id",
          cmp: "inSet",
          const: historyIds(reactor, now, operator, user, refused).sort(),
        },
      },
    ],
  }));
  if (defect !== undefined) throw new Error(defect);
  return out;
}

export function historyIds(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  user: string,
  refused: ReadonlySet<string>,
): string[] {
  const root = subjectKeyAt(reactor, now, operator, `${USER_PREFIX}${user}`);
  if (root === undefined) return [];
  const users = userGroundOf(reactor);
  const erased = users.erased();
  const out = new Set<string>();
  const seen = new Set<string>([root]);
  const frontier = [root];
  while (frontier.length > 0) {
    const key = frontier.pop()!;
    for (const { record, previous } of recoveriesOf(
      users.reactor,
      usersGovernor(users, operator),
      user,
      key,
      erased,
    )) {
      if (seen.has(previous) || !bindingHeld(users.reactor, now, key, previous, erased)) continue;
      seen.add(previous);
      frontier.push(previous);
      for (const id of historyBefore(reactor, operator, record, previous, refused)) out.add(id);
    }
  }
  return [...out];
}

export function presentAuthors(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  user: string,
  scope: string,
): string[] {
  const root = subjectKeyAt(reactor, now, operator, `${USER_PREFIX}${user}`);
  if (root === undefined) return [];
  const users = userGroundOf(reactor);
  const retired = retiredKeysOf(users.reactor, usersGovernor(users, operator), users.erased());
  return [...keysActingFor(reactor, now, { root }, scope, operator)].filter((k) => !retired.has(k));
}
