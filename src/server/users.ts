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
  type Delta,
  type HyperSchema,
  type Policy,
  type Reactor,
  type Schema,
  type View,
} from "@bombadil/rhizomatic";
import { DeltaSet, evalTerm, parseTerm } from "@bombadil/rhizomatic";
import { erasedFromReading } from "../gateway/erase.js";
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
import { containerDeclarationName } from "../gateway/container.js";
export { CTX_ROLE, CTX_ROOT, userEntity };

const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

/** The roles §36 ships. Anything else is a future ticket, and refused rather than guessed at. */
export type UserRole = "operator" | "actor";
export const ROLES: readonly UserRole[] = ["operator", "actor"];

/**
 * A name safe to read back as an entity id, a JSON object key, and an HTML page — one expression,
 * stated once. `userEntity` does not call this itself: it is a pure formatter, and validating a
 * caller-supplied name before it ever reaches an entity id is the caller's job.
 */

// The rule itself lives with the user's other at-rest vocabulary (gateway/user-root.ts), where the
// gateway's membership validator reads it too.
export { userNameDefect } from "../gateway/user-root.js";

// THE POOL TOKENS ARE RESERVED, AT MINTING ONLY.
//
// A person's name is the root of their container path, so a person named `inbox` owns
// `inbox:notes`, `inbox:journal`, and every other name below their home. Those names lead with
// `inbox:`, which is exactly what the reading side calls a POOL: `governingLeeway` treats such a
// name as a pool and resolves its leeway through the container it was opened into, and
// `openerStands` reconstructs a bound channel's opener from the same `inbox:<container>:` stem.
// Neither would find what it expects, because nothing wrote a pointer onto a person's own child.
// The home itself is safe — `inbox` has no colon and is not pool-shaped — so it is the SUBTREE
// that collides, not the name.
//
// THIS IS NOT `userNameDefect`, deliberately. That one is asked on every READ and every login,
// so folding this in would lock out a person already named `inbox` in a store provisioned before
// the rule — no login, no roles resolved, no road back, and if they held the operator role, no
// admin surface at all. A name at rest keeps working; only a NEW one is refused.
const RESERVED = new Set(["inbox", "channel"]);

/** Why this name may not be MINTED. Absent means it may. Asked by the doors that create a person. */
export function reservedNameDefect(name: string): string | undefined {
  return RESERVED.has(name)
    ? `"${name}" is reserved: a container whose name begins with it is a pool, which takes its ` +
        `leeway from the container it was opened into. Pick another name.`
    : undefined;
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

/**
 * The root pointer: this user's current root key. The operator signs it when it mints the user a
 * key, and signs a new one to re-point a user who lost theirs. The latest unstruck one wins; an
 * earlier one stays in the ground as history. Removing a role leaves the root in place: a root is
 * who the user is, not what they may do. Stamp it with the store's ordering clock (`stamp`), never a
 * bare wall clock, or an older pointer stamped ahead of that clock would outrank it.
 */
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

/** The role binding: this user holds this role on this store. */
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
    [CTX_ROOT, pickLatest],
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
  now: number,
  name: string,
): View | undefined {
  if (operator === undefined) return undefined; // no operator, no constitution, no users
  if (userNameDefect(name) !== undefined) return undefined;
  // An erased user or role record stops counting at once, even before its bytes are purged. An
  // operator-authored row at this user that does not verify never counts: the indexed readers in
  // user-root.ts skip it too. So is an operator negation of such a row, or of a negation of one,
  // that does not verify: a negation is filed at the delta it strikes, not at the user, so it is
  // found by walking each row's negations. Only this entity's own rows and the negations that reach
  // them are checked, never the whole store (H8).
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

/**
 * The root key `name` currently acts from, read through the same operator-only View as the user's
 * name and roles. Undefined when the user does not exist, or the ground names no root that is a
 * well-formed key: absence is absence, never a guess from a seed file.
 */
export function rootOf(
  reactor: Reactor,
  operator: string | undefined,
  now: number,
  name: string,
): string | undefined {
  const view = resolveUserView(reactor, operator, now, name);
  if (view === undefined) return undefined;
  // Once a user has a recovery chain, only its head's root is eligible. It is derived from the chain
  // and checked against the operator's standing root claims, never read off the View's latest pick,
  // which a later claim for a retired key would win.
  const fenced = chainRoot(reactor, now, operator, name, erasedFromReading(reactor, operator));
  if (fenced !== undefined) return fenced ?? undefined;
  const root = (view as Record<string, View>)[CTX_ROOT];
  return typeof root === "string" && AUTHOR.test(root) ? root : undefined;
}

// Is `d` a container declaration that could bind here: the governing account's own, and a
// declaration by the container READER's own test (`containerDeclarationName`, the predicate the
// table binds with). Not the door's admission test: that weighs today's leeway and tree, and can
// refuse a declaration that still binds.
function isDeclaration(operator: string, d: Delta): boolean {
  return d.claims.author === operator && containerDeclarationName(d.claims) !== undefined;
}

// Does `text` parse as a valid membership Term with a well-formed `loam.memberOf` node naming `user`?
function membershipNames(text: string, user: string): boolean {
  let json: unknown;
  try {
    json = JSON.parse(text);
    parseTerm(membershipForValidation(json)); // a real Term, every node well formed
  } catch {
    return false;
  }
  return namesMemberOf(json, user);
}

/**
 * Does the ground still HOLD anything that would pass to a new person given the entity `user:<name>`?
 * Everything that can bind or revive counts, struck or not yet valid included, because a strike can
 * lapse:
 *   - the governing account's own record, roles, root, recovery records and lineage at the entity;
 *   - any held, verified grant (loam.grants) whose subject is the entity, whoever issued it;
 *   - any held, verified container membership that names the user (loam.memberOf).
 * This is tooling that tells the truth about what remains, not a uniqueness rule: reusing the entity
 * on purpose is an explicit act (erase what is found, or recover the entity to the new key).
 */
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
  // Claims that name the entity from elsewhere. Rare (a user is created once), so a walk.
  // A membership counts only where one can serve: the inline `membership` of a declaration, or the
  // published `term` a declaration cites by `membershipAt`, and only when it parses as a valid
  // membership Term. The same text inside any other claim is just data.
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
    // Only a container DECLARATION can serve a membership: its shape is checked by the same
    // validator the door runs, so a claim that merely carries the role is data.
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
