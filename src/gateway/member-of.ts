// A container membership that names a USER (step 5, PR 3f): `{"loam.memberOf": {user, scope}}`, a
// Loam predicate node in a membership Term, where `authoredBy(key)` names one key. It is not a
// rhizomatic Pred, so no membership reaches the substrate parser with it: every site either
// VALIDATES the shape (a placeholder stands in, and the user's current state is not asked) or
// LOWERS it at read time to the authors who act for the user now. The signed JSON keeps the node;
// only the program handed to an evaluator is lowered.
//
// PRESENT authority only: the user's current root (read from the host's user ground, so the
// recovery fence and head-only root apply) and the keys it delegates to for exactly `scope`, less
// every key a recovery retired. A user with no readable root lowers to no one. History — what an
// earlier key wrote before a recovery (ruling 8, M1) — is NOT part of this node yet: the cut that
// separates old writes from new ones across stores is an open decision.

import { keysActingFor } from "./principal.js";
import {
  retiredKeysOf,
  subjectKeyAt,
  USER_PREFIX,
  userGroundOf,
  userNameDefect,
} from "./user-root.js";
import type { Reactor } from "@bombadil/rhizomatic";

export const MEMBER_OF = "loam.memberOf";

/** A membership predicate: the authors who act for `user` in `scope`, read at evaluation time. */
export const memberOf = (user: string, scope: string): Record<string, unknown> => ({
  [MEMBER_OF]: { user, scope },
});

/** A container that gathers what a user's present authority wrote. */
export const writtenByUser = (user: string, scope: string): unknown => ({
  op: "select",
  pred: memberOf(user, scope),
  in: "input",
});

// Why a `loam.memberOf` node's own shape is malformed, or undefined. Only the node's shape: its
// user's current state is a read-time question, never a validity one.
function nodeDefect(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${MEMBER_OF} takes { user, scope }`;
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "scope,user") return `${MEMBER_OF} takes exactly { user, scope }`;
  const { user, scope } = value as { user: unknown; scope: unknown };
  // The same rule `loam user create` applies, so a membership cannot name a user no one can be.
  if (typeof user !== "string" || userNameDefect(user) !== undefined) {
    return `${MEMBER_OF}.user must be a user name`;
  }
  if (typeof scope !== "string" || scope.length === 0) {
    return `${MEMBER_OF}.scope must be a non-empty string`;
  }
  return undefined;
}

// Rebuild `json`, replacing every `loam.memberOf` node (an object whose ONLY key is the node's) by
// `replace(user, scope)`. A node beside other keys is malformed: it would be a Pred with two tags.
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

/**
 * Does this membership JSON carry a `loam.memberOf` node anywhere, well-formed or not? An object KEY
 * is what counts: the same text as a string value (a `const`, say) is ordinary data.
 */
export function hasMemberOf(json: unknown): boolean {
  if (Array.isArray(json)) return json.some(hasMemberOf);
  if (json === null || typeof json !== "object") return false;
  const rec = json as Record<string, unknown>;
  return MEMBER_OF in rec || Object.values(rec).some(hasMemberOf);
}

/** Does this membership JSON carry a `loam.memberOf` node naming `user`? */
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

/**
 * The membership as the substrate parser can check it: each well-formed node replaced by an empty
 * author set, so validation never depends on any user's current root. Throws on a malformed node.
 */
export function membershipForValidation(json: unknown): unknown {
  const { json: out, defect } = mapNodes(json, () => inSet([]));
  if (defect !== undefined) throw new Error(defect);
  return out;
}

/**
 * The membership as an evaluator runs it at `now` over `reactor`'s ground: each node lowered to the
 * present authors acting for its user in its scope. Throws on a malformed node.
 */
export function lowerMembershipJson(
  json: unknown,
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): unknown {
  const { json: out, defect } = mapNodes(json, (user, scope) =>
    inSet(presentAuthors(reactor, now, operator, user, scope)),
  );
  if (defect !== undefined) throw new Error(defect);
  return out;
}

/** The keys that act for `user` in `scope` at `now`: the current root and its scoped delegates. */
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
  const retired = retiredKeysOf(users.reactor, operator, users.erased());
  return [...keysActingFor(reactor, now, { root }, scope, operator)].filter((k) => !retired.has(k));
}
