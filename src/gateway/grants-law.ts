// The grant constitution's pure readers: whether a grant holds, whether a strike on it stands, and
// who it names. Kept free of the door and of erasure, so law readers can import it without joining
// the gateway's import cycle.

import { type Delta, type Reactor } from "@bombadil/rhizomatic";
import { keyActsFor, principalScopeOf } from "./principal.js";
import { retiredKeysOf, subjectKeyAt, userGroundOf, usersGovernor } from "./user-root.js";
import { STORE_ENTITY } from "./genesis.js";
import { CTX_GRANTS } from "./governed-trust.js";

// `write` publishes, `admin` additionally mints grants and retires constitution, `register` (T174)
// shapes the store — but only inside the entity-namespace PREFIX its own grant names — and
// `federate` (T188) opens and tends federation channels, but only on the CONTAINER its own grant
// names. Root registration is the operator's and stays there.
//
// `federate` exists because the alternative was worse: `GET /:mount/federate` demands the OPERATOR
// token today, and that token also registers root law, mints grants, drops containers and reads
// everything — so "let me federate with you" cost a peer the entire store. §28 says trust is a
// property of a CONTAINER, so federation authority is scoped to one, and the operator holds it at
// root by construction rather than as a special case.
export type Verb = "write" | "admin" | "register" | "federate";

// WHICH strike actually retired `id`, if any — the constitutional question, answered by the same
// `struck`/`standsFor` walk resolution runs, so a report of WHEN standing ended cannot drift from
// the store's own verdict on WHETHER it ended. Built on the private recursion for exactly the reason
// `dataStruck` is built on `lawfulStrikersJson`: two derivations of one fact disagree eventually.
//
// A negation that is itself struck, or whose author had no standing to strike, is INERT and is not
// returned — it never retired anything, and reporting its timestamp would name a revocation nobody
// lawful performed. The EARLIEST honored strike wins: that is the moment the standing ended, and a
// later strike on the same grant does not move it. Ties break on the negation id so one store always
// reads one way.
//
// `undefined` means no honored strike, which is NOT the same as "this grant binds" — a grant can
// fail for chain reasons with no strike anywhere near it. Callers that need both facts ask this and
// `grantsHeldBy` separately.
export function honoredStrikeOn(
  reactor: Reactor,
  now: number,
  id: string,
  operator?: string,
): { readonly id: string; readonly timestamp: number } | undefined {
  const ctx: Ctx = { reactor, now, operator };
  // Standing is Loam's own walk (`standsFor`), read at the same `now` as the strike edges.
  const witnesses = reactor.negationWitnesses(now, (negation) =>
    operator === undefined ? true : standsFor(ctx, negation, new Set([negation.id])),
  )(id);
  let earliest: { id: string; timestamp: number } | undefined;
  for (const neg of witnesses) {
    const candidate = { id: neg.id, timestamp: neg.claims.timestamp };
    if (
      earliest === undefined ||
      candidate.timestamp < earliest.timestamp ||
      (candidate.timestamp === earliest.timestamp && candidate.id < earliest.id)
    ) {
      earliest = candidate;
    }
  }
  return earliest;
}

// --- resolution: what the ground says about who may do what -------------------------------------
//
// Everything here answers under one discipline: in a governed store (an operator is named), a
// constitutional delta — a grant, a membership, or a strike against one — is EFFECTIVE only if
// its authority chain roots in the operator. The chain needs no arrival order, only reachability,
// so a store compromised while ungoverned (self-signed grants, unauthorized strikes) resolves to
// nothing the moment an operator opens it — a cycle of self-appointed admins roots nowhere.
// Ungoverned stores skip the discipline entirely: no operator, no constitution.
//
// The walk reads at one instant, `now`. A grant, a membership or a negation counts only inside its
// own [validFrom, validUntil). So an expired negation of a grant revives it, and a negation that
// starts later does not bind yet. The door, the revoke panel and the grant ledger all read so.

export interface Ctx {
  readonly reactor: Reactor;
  readonly now: number;
  readonly operator: string | undefined;
}

/** Is `d` valid at `now`: inside [validFrom, validUntil)? */
export function validAt(d: Delta, now: number): boolean {
  const { validFrom, validUntil } = d.claims;
  return validFrom <= now && (validUntil === undefined || now < validUntil);
}

// Is `id` struck by a negation that (a) is valid now, (b) itself survives and (c) had the standing
// to strike? Content addressing makes the negation graph a DAG, but `visited` guards it regardless.
export function struck(ctx: Ctx, id: string, visited: ReadonlySet<string>): boolean {
  for (const negId of ctx.reactor.negationsOf(id)) {
    if (visited.has(negId)) continue;
    const neg = ctx.reactor.get(negId);
    if (neg === undefined || !validAt(neg, ctx.now)) continue; // absent or out of window: inert
    const branch = new Set(visited).add(negId);
    if (struck(ctx, negId, branch)) continue; // the strike is itself struck: inert
    if (ctx.operator !== undefined && !standsFor(ctx, neg, branch)) continue; // no standing: inert
    return true;
  }
  return false;
}

// May this negation RETIRE what it strikes? Constitutional resolution honors a strike only
// from the operator or an effective store admin — a mere writer (or a federated stranger) may
// assert a negation, but the constitution does not bend to it. (Whether DATA bends to a
// negation is the reader's mask policy, not decided here.)
function standsFor(ctx: Ctx, delta: Delta, visited: ReadonlySet<string>): boolean {
  if (delta.claims.author === ctx.operator) return true;
  return grantHeld(ctx, STORE_ENTITY, delta.claims.author, "admin", visited);
}

/** Every subject any grant at the store entity names, struck or not: the roots a delegate here
 *  could act for. */
export function grantSubjects(reactor: Reactor): string[] {
  const out = new Set<string>();
  for (const id of reactor.byTarget(STORE_ENTITY)) {
    const d = reactor.get(id);
    if (d === undefined) continue;
    const filed = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === STORE_ENTITY &&
        p.target.entity.context === CTX_GRANTS,
    );
    const subject = d.claims.pointers.find((p) => p.role === "subject")?.target;
    if (filed && subject?.kind === "primitive" && typeof subject.value === "string") {
      out.add(subject.value);
    }
  }
  return [...out];
}

// The surviving deltas filed at `entity` under `context`: valid now, and not struck.
export function survivingAt(
  ctx: Ctx,
  entity: string,
  context: string,
  visited: ReadonlySet<string>,
): Delta[] {
  const out: Delta[] = [];
  for (const id of ctx.reactor.byTarget(entity)) {
    if (visited.has(id)) continue;
    const delta = ctx.reactor.get(id);
    if (delta === undefined || !validAt(delta, ctx.now)) continue;
    if (struck(ctx, id, visited)) continue;
    const filedHere = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === context,
    );
    if (filedHere) out.push(delta);
  }
  return out;
}

// The keys recoveries retired, read once per question from the ground's users.
const retiredMemo = new WeakMap<Ctx, ReadonlySet<string>>();

function retiredIn(ctx: Ctx): ReadonlySet<string> {
  let hit = retiredMemo.get(ctx);
  if (hit === undefined) {
    const users = userGroundOf(ctx.reactor);
    hit = retiredKeysOf(users.reactor, usersGovernor(users, ctx.operator), users.erased());
    retiredMemo.set(ctx, hit);
  }
  return hit;
}

export function grantHeld(
  ctx: Ctx,
  tenant: string,
  author: string,
  verb: Verb,
  visited: ReadonlySet<string>,
): boolean {
  // A key a recovery retired holds no standing at all: not through its own grants, and not as a
  // delegate of another root (refactor/audit/user-recovery.md, "The root fence").
  if (retiredIn(ctx).has(author)) return false;
  for (const d of survivingAt(ctx, tenant, CTX_GRANTS, visited)) {
    let subject: string | undefined;
    let granted: string | undefined;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string") subject = p.target.value;
      if (p.role === "verb" && typeof p.target.value === "string") granted = p.target.value;
    }
    if (subject === undefined) continue;
    // `admin` covers `write`, and NEVER `register`. An admin grant carries no prefix, so "admin
    // covers register" could only ever mean register AT ROOT — the one authority that is not
    // delegable through the verb lattice. An admin who wants to register mints themselves a
    // prefixed register grant, which is a visible act in the audit rather than an implication.
    if (verb === "register" ? granted !== "register" : granted !== "admin" && granted !== verb) {
      continue;
    }
    // A subject may name a user (`user:<name>`): it stands for that user's current root, read now.
    // A user with no standing root holds nothing through it. Resolved after the verb check, so a
    // grant that could not answer this question costs no user read.
    const key = subjectKeyAt(ctx.reactor, ctx.now, ctx.operator, subject);
    if (key === undefined) continue;
    // A key a recovery retired holds no standing, through any grant or delegation, anywhere the
    // host's users are read (refactor/audit/user-recovery.md, "The root fence").
    if (retiredIn(ctx).has(key)) continue;
    // A delegated key WRITES for its user and does nothing else (README ruling 6): admin,
    // register, and the issuer checks that recurse through here as admin match the subject's
    // own key exactly. The verb is checked first so a delegate never reaches the seam for them.
    // The scope is the ground's own, not the tenant's: only a ground that declares one (an inbox
    // pool, by its name) honors a delegate, so a delegation copied to another ground grants nothing.
    // Delegating is issuing, so only an ADMIN grant carries it: a subject that may only write
    // cannot hand its standing to a delegate.
    if (author !== key) {
      const scope = principalScopeOf(ctx.reactor);
      if (
        verb !== "write" ||
        granted !== "admin" ||
        scope === undefined ||
        !keyActsFor(ctx.reactor, ctx.now, { root: key }, author, scope, ctx.operator)
      ) {
        continue;
      }
    }
    // The grant itself must be effective: minted by the operator, or by an effective admin.
    if (ctx.operator !== undefined && d.claims.author !== ctx.operator) {
      const branch = new Set(visited).add(d.id);
      if (!grantHeld(ctx, tenant, d.claims.author, "admin", branch)) continue;
    }
    return true;
  }
  return false;
}
