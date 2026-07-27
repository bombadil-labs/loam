// Users and roles in the ground (SPEC §36): the half of a user that IS a delta.
//
// Three things answer three questions, and collapsing any two of them is the bug this section exists
// to undo. A USER answers "who is this person?". A ROLE BINDING answers "what may this user do on
// this store?". A SEED answers "what key signs a delta?" — and a user is not a seed. So a login
// authenticates a user, a permission check reads the role binding, and a write is signed by whatever
// seed the role entitles the session to use.
//
// Both facts are ordinary operator-signed deltas: readable, provenance-carrying, and erasable like
// any other fact. That is deliberate. Erasing a user's record must actually shut the door, which is
// what `roleOf` returning undefined does — and it is the half of §36's erasure honesty that the
// report cannot supply on its own.
//
// "Operator-signed" is enforced on the READ, not only asserted on the write — see `userHyperSchema`.

import {
  resolveView,
  type Claims,
  type HyperSchema,
  type Policy,
  type Reactor,
  type Schema,
  type View,
} from "@bombadil/rhizomatic";
import { evalTerm } from "@bombadil/rhizomatic";
import { operatorGatherBody } from "../gateway/accounts.js";

export const CTX_USER = "loam.user";
export const CTX_ROLE = "loam.role";

/** The roles §36 ships. Anything else is a future ticket, and refused rather than guessed at. */
export type UserRole = "operator" | "actor";
export const ROLES: readonly UserRole[] = ["operator", "actor"];

export const userEntity = (name: string): string => `user:${name}`;

// A user name reaches an entity id, a JSON object key, and an HTML page. Keep it to the characters
// that are safe in all three, and short enough to read in a provenance trail.
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function userNameDefect(name: string): string | undefined {
  if (!NAME.test(name)) {
    return (
      `"${name}" is not a user name: use 1–64 characters of a–z, 0–9, dot, dash or underscore, ` +
      `starting with a letter or digit`
    );
  }
  return undefined;
}

/** The user record: this store knows a person by this name. */
export function userClaims(name: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
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

/** The role binding: this user holds this role on this store. */
export function roleClaims(
  name: string,
  role: UserRole,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
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

/**
 * The GATHER PROGRAM a user's deltas are selected by — a HyperSchema, resolved into a View through
 * `USER_SCHEMA` below.
 *
 * It counts the OPERATOR'S ASSERTIONS ONLY, and that is the whole security of a role binding. A role
 * binding is filed at an ordinary entity in an ordinary context, so it has no grant shape for
 * `constitutionalDefect` to recognise and nothing refuses it at the append door: any author holding
 * write standing may sign one. Gathering every author and then picking the latest claim would let that
 * author name themselves — or anyone — an operator. So the select names the operator, and the mask
 * keeps a stranger's negation from retracting what the operator said.
 *
 * There is no ungoverned form. A store with no operator has no one whose word this could be, so a
 * caller with no operator gets no user and no role — the door stays shut rather than opening on a
 * fact nobody is answerable for.
 */
export function userHyperSchema(operator: string): HyperSchema {
  return { name: "LoamUser", alg: 1, body: operatorGatherBody(operator) };
}

const pickLatest: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };

/** The resolution program over that gather: one value per field, the latest claim winning. */
export const USER_SCHEMA: Schema = {
  props: new Map<string, Policy>([
    [CTX_USER, pickLatest],
    [CTX_ROLE, pickLatest],
  ]),
  default: pickLatest,
};

/**
 * What a READER resolves about `name` — the object level of the two deltas above. Undefined when the
 * ground does not say this user exists: an absent record, or one a lawful strike retired. Absence is
 * absence, never a default.
 */
export function resolveUserView(
  reactor: Reactor,
  operator: string | undefined,
  name: string,
): View | undefined {
  if (operator === undefined) return undefined; // no operator, no constitution, no users
  if (userNameDefect(name) !== undefined) return undefined;
  const result = evalTerm(userHyperSchema(operator).body, reactor.snapshot(), userEntity(name));
  if (result.sort !== "hview") return undefined;
  const view = resolveView(USER_SCHEMA, result.hview);
  if (view === null || typeof view !== "object" || Array.isArray(view)) return undefined;
  return (view as Record<string, View>)[CTX_USER] === name ? view : undefined;
}

/**
 * The role `name` holds, read through the same View. Undefined means the door does not open: no user
 * record, or a role this version does not ship. Fails closed on both, which is why a login checks it
 * AFTER the password and a token mint checks it AGAIN.
 */
export function roleOf(
  reactor: Reactor,
  operator: string | undefined,
  name: string,
): UserRole | undefined {
  const view = resolveUserView(reactor, operator, name);
  if (view === undefined) return undefined;
  const role = (view as Record<string, View>)[CTX_ROLE];
  return ROLES.find((known) => known === role);
}
