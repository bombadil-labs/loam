// Users and roles in the ground (SPEC §36): a user is an ENTITY, and every property this file
// resolves — its name, the roles it holds — comes back through a Schema over a HyperSchema. A user
// is never "half of a delta"; a delta is one claim, and a claim is not the fact a reader resolves.
//
// Three things answer three questions, and collapsing any two of them is the bug this section exists
// to undo. A USER answers "who is this person?". A ROLE BINDING answers "what may this user do on
// this store?". A SEED answers "what key signs a delta?" — and a user is not a seed. So a login
// authenticates a user, a permission check reads the role binding, and a write is signed by whatever
// seed the role entitles the session to use.
//
// Both facts are ordinary operator-signed deltas: readable, provenance-carrying, and erasable like
// any other fact. That is deliberate. Erasing a user's record must actually shut the door, which is
// what an absent `resolveUserView` does — and it is the half of §36's erasure honesty that the
// report cannot supply on its own.
//
// "Operator-signed" is enforced on the READ, not only asserted on the write — see `userHyperSchema`.
// This file does not rail what happens when a USER claim itself (not a role binding) is struck;
// phase 10 (erasure honesty) owns that rail.

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
import { entityGatherBody } from "../gateway/gather.js";

const CTX_USER = "loam.user";
export const CTX_ROLE = "loam.role";

/** The roles §36 ships. Anything else is a future ticket, and refused rather than guessed at. */
export type UserRole = "operator" | "actor";
export const ROLES: readonly UserRole[] = ["operator", "actor"];

/**
 * A name safe to read back as an entity id, a JSON object key, and an HTML page — one expression,
 * stated once. `userEntity` does not call this itself: it is a pure formatter, and validating a
 * caller-supplied name before it ever reaches an entity id is the caller's job.
 */
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

/**
 * Is `role` one this store ships? A future write path (phase 3's CLI, `assign-role`) consults this
 * BEFORE it ever signs a claim, so an unknown role name is refused rather than admitted into the
 * ground and silently dropped on read. This file adds no door of its own — validating here is what
 * lets a later door refuse without re-deriving the rule.
 */
export function userRoleDefect(role: string): string | undefined {
  if (!ROLES.includes(role as UserRole)) {
    return `"${role}" is not a role this store ships: use ${ROLES.join(" or ")}`;
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
 * It counts THE STORE'S OWN SEED'S ASSERTIONS ONLY, and that is the whole security of a role
 * binding. A role binding is filed at an ordinary entity in an ordinary context, so it has no grant
 * shape for `constitutionalDefect` to recognise and nothing refuses it at the append door: any
 * author holding write standing may sign one. Gathering every author and admitting every non-negated
 * claim would let that author name themselves — or anyone — an operator. So the select names the
 * seed, and the mask keeps a stranger's negation from retracting what the seed said.
 *
 * `operator` here is `<the key in <home>/operator.seed>` — the STORE's seed, not a senior
 * operator's. Per §9a every operator with home access is equivalent and every one of them signs
 * with this same key; there is no wider trust set to widen this read into, and doing so is the
 * escalation this section closes rather than reopens.
 *
 * There is no ungoverned form. A store with no operator has no one whose word this could be, so a
 * caller with no operator gets no user and no role — the door stays shut rather than opening on a
 * fact nobody is answerable for.
 */
/**
 * EXPORTED because this reading is not in the registration table. It is assembled here and run
 * directly by `resolveUserView`, so anything enumerating "the masks this store reads under" finds
 * every registered Schema and misses THIS one — the login door, live on every served home.
 */
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

// A user may hold many roles at once — `operator` and `actor` are not mutually exclusive, and
// neither strikes the other. `all` resolves every non-negated role claim; `pick` would let the
// latest grant silently displace an earlier one, which is a permission bug wearing a data model's
// clothes.
const allRoles: Policy = { kind: "all", order: { kind: "byTimestamp", dir: "asc" } };

/** The resolution program over that gather: the user's name picks latest, its roles form a set. */
const USER_SCHEMA: Schema = {
  props: new Map<string, Policy>([
    [CTX_USER, pickLatest],
    [CTX_ROLE, allRoles],
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
 * The SET of roles `name` holds, read through the same View. Always a set, never a single value —
 * a permission check asks MEMBERSHIP ("does this user hold `operator`"), never equality, and a
 * singular `roleOf` would invite the caller to compare instead. Empty when the door does not open at
 * all (no user record, no operator) and empty when the user simply holds no role — both are "holds
 * nothing", never `undefined` and never a default role.
 *
 * Reads through this function, never through the raw View: the resolved `loam.role` field is an
 * array position-ordered by timestamp, and a caller comparing it directly (rather than testing
 * membership here) would be back to counting instead of asking "does this user hold X".
 */
export function rolesOf(
  reactor: Reactor,
  operator: string | undefined,
  name: string,
): ReadonlySet<UserRole> {
  const view = resolveUserView(reactor, operator, name);
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
