// Accounts & capabilities: no ambient authority, anywhere — and no OWNERSHIP of ids, anywhere
// (revised 2026-07-09, "authors, not owners"). Entities are unowned: pointer resolution is
// string matching, a delta is an assertion from a perspective, and anyone with standing may
// point at anything. What the gateway enforces is the AUTHOR'S STANDING ON THIS INSTANCE — a
// publishing relationship, one surviving operator-rooted `write` grant at the store entity —
// never the tenancy of whatever the delta touches. Whether anyone LISTENS to a claim is the
// reader's business: lenses, author ranks, admission predicates, operator-filtered
// constitutional reads. Revocation is negation; audit is a query; the POLICY is entirely data.
//
// Tenant vocabulary (`loam.tenant` / `loam.members` / `loam.grants`) survives as data for
// author-communities and read lenses — memberships still resolve (tenantOf), grants still
// chain — but `authorize` consults exactly one thing: standing at `loam:store`.

import {
  DeltaSet,
  evalTerm,
  parseTerm,
  type Claims,
  type Delta,
  type HyperSchema,
  type Schema,
  type Reactor,
  type Term,
} from "@bombadil/rhizomatic";
import { keysActingFor } from "./principal.js";
import { STORE_ENTITY } from "./genesis.js";
import { entityGatherBody } from "./gather.js";
import { eraseDefect } from "./erase.js";
import { publicDefect } from "./public.js";
import { artifactDefect } from "./artifact.js";
import { trustDefect } from "./trust.js";
import { bindingPolicyDefect } from "./binding-policy.js";
import { budgetDefect } from "./budget.js";
import { envelopeDefect } from "./envelope.js";
import { containerDefect } from "./container.js";
import { slateDefect } from "./slate.js";

export const CTX_TENANT = "loam.tenant";
export const CTX_MEMBERS = "loam.members";
export const CTX_GRANTS = "loam.grants";
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
export const VERBS: ReadonlySet<string> = new Set<Verb>(["write", "admin", "register", "federate"]);

// THE FENCE (T174). A register grant carries a prefix, and this is the whole of what "inside the
// prefix" means — read it before changing anything downstream of it, because an escape from here is
// an unauthorized registration.
//
// The rule: `name` is admitted iff `prefix` is a NON-EMPTY LITERAL prefix of it, compared code unit
// by code unit, on the strings exactly as they arrived.
//
//  - LITERAL, never a pattern and never a namespace-aware match. `thread:` admits `thread:groove`
//    and `thread:groove:2`; it refuses `x-thread:foo`, where the prefix appears LATER and so is not
//    a prefix at all. It also admits `threadbare` — a prefix need not stop at a separator, because
//    inventing a separator here would mean two definitions of a namespace boundary (this one and
//    the store's, which has none) and the two would drift.
//  - THE BARE PREFIX IS INSIDE ITS OWN FENCE. `thread:` admits the name `thread:`. Refusing it would
//    be an arbitrary hole in a range that is otherwise contiguous.
//  - AN EMPTY PREFIX ADMITS NOTHING. `"".startsWith` is true of every string, so a naive check would
//    turn a prefixless grant into ROOT authority — the single most expensive way to get this wrong.
//    `constitutionalDefect` already refuses to let such a grant exist; this refuses to honour one
//    that somehow does. Two independent fail-closed points, on purpose.
//  - NO NORMALIZATION, NO DECODING, NO CASE FOLDING. `Thread:foo`, `thread%3Afoo`, and `thread：foo`
//    (fullwidth colon) are three DIFFERENT names, and none of them is inside `thread:`. This is not
//    laxity: every ENTITY ID the store derives from the name is that same literal string, so any
//    folding here would compare a folded form against an unfolded key and could admit a name whose
//    deltas land outside the fence. The comparison and the derivation must run on one string.
//
// AND THE FENCE'S DISJOINTNESS DOES NOT CARRY TO THE GRAPHQL FIELD NAMESPACE. Read the bullet above
// precisely — it is true of entity ids and FALSE of the served field. `legalNameFor` (gql.ts) maps
// every `[^_A-Za-z0-9]` to `_` and `queryFieldFor` lowercases an initial capital, so the mapping is
// MANY-TO-ONE: `x:Foo` and `x_Foo` are disjoint entity namespaces that both serve at the field
// `x_Foo`. Two prefixes an operator believes are separate can therefore collide at the surface. That
// fails CLOSED — `buildGqlSchema` refuses the second publisher, whoever it is, the operator
// included — so the reachable harm is SQUATTING rather than capture. It is written here because the
// next author to extend this fence will otherwise read the bullet above as covering the field too.
//
// This predicate fences ONE name. A registration carries THREE independently-chosen names — the
// program, the reading, and an optional explicit entity — and each reaches a different part of the
// store, so the door applies this to each of them rather than to one. `registerFenceAdmits` in
// src/server/http.ts is where that composition lives, and it says which name reaches what.
export function fenceAdmits(prefix: string, name: string): boolean {
  return prefix.length > 0 && name.startsWith(prefix);
}

// --- the claims vocabulary ----------------------------------------------------------------------

// E belongs to T: filed at the tenant (its member roll) and at the entity (its allegiance).
export function membershipClaims(
  tenant: string,
  entity: string,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      { role: "member", target: { kind: "entity", entity: { id: tenant, context: CTX_MEMBERS } } },
      { role: "entity", target: { kind: "entity", entity: { id: entity, context: CTX_TENANT } } },
    ],
  };
}

// `subject` may `verb` within `tenant`: the capability itself, as one signed delta. A `register`
// grant carries a FOURTH pointer, `prefix` — the entity namespace it may shape and no other. The
// scope rides the grant rather than a table beside it, so revoking the grant revokes the scope in
// the same strike and there is no second place for the two to disagree.
export function grantClaims(
  tenant: string,
  subject: string,
  verb: Verb,
  author: string,
  timestamp: number,
  prefix?: string,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      { role: "tenant", target: { kind: "entity", entity: { id: tenant, context: CTX_GRANTS } } },
      { role: "subject", target: { kind: "primitive", value: subject } },
      { role: "verb", target: { kind: "primitive", value: verb } },
      ...(prefix === undefined
        ? []
        : [{ role: "prefix", target: { kind: "primitive" as const, value: prefix } }]),
    ],
  };
}

// Revocation is negation — the grant delta is struck, and resolution forgets it.
export function revocationClaims(grantDeltaId: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: grantDeltaId } } }],
  };
}

// --- the audit surface ----------------------------------------------------------------------------

// A tenant, gathered: its grants, its members, anything filed at it. This UNGOVERNED form
// masks with `drop` — every negation present binds. A governed store should audit through
// `tenantSchemaFor(operator)` below, whose mask honors only lawful strikes.
export const TENANT: HyperSchema = { name: "Tenant", alg: 1, body: entityGatherBody() };

// --- governed read lenses (rhizomatic 0.2.0: trust masks + inView) --------------------------------
//
// Under open writes, `mask drop` honors every negation present — a federated stranger's strike
// becomes a heckler's veto. These lenses honor only LAWFUL strikers: the operator, plus the
// authors the operator's surviving grants name (the community the door admitted). The trusted
// set is an `inView` — a view over the same delta-set, always current: mint a grant and its
// grantee's strikes bind on the next read; revoke it and they stop. The sets reach ONE LINK
// from the operator: subjects of grants the OPERATOR authored, surviving the OPERATOR's own
// strikes (stratification bans inView inside the sub-term — the chain cannot recurse here).
// Stated plainly: standing minted by an ADMIN binds enforcement but never enters these sets;
// and an admin's revocation — honored by the door, and by these lenses' OUTER masks — does
// not by itself remove the revoked author from a trusted set (only the operator's strike
// does). grantHeld keeps the full recursion; the chain's second link is exactly where lens
// and door can disagree.
//
// NAMED GAP: the wide set matches any grant the operator minted, so a `register` grantee is in it.
// That is inert today — a register grant confers no write standing, so `authorize` refuses every
// delta such an author signs, and a striker with no deltas strikes nothing. It stops being inert if
// a federated pull ever admits deltas authored by that key. Closing it means narrowing this term,
// which moves the bytes of an exported gather body; the rail that would close it asserts a register
// grantee's ingested strike is inert in a governed read.
// The operator's surviving grants, as a Term: grant-shaped deltas the operator minted (admin grants
// only, when asked), after masking by the operator's own negations — a stranger cannot shrink the
// trusted set by negating a grant delta. `lawfulStrikersJson` reflects over it and `dataStruck`
// evaluates it, so the two read one definition.
function lawfulGrantsTermJson(operator: string, adminsOnly: boolean): unknown {
  const operatorMinted = { match: { field: "author", cmp: "eq", const: operator } };
  const grantShaped = {
    hasPointer: { targetEntity: STORE_ENTITY, context: { exact: CTX_GRANTS } },
  };
  const adminVerbed = {
    hasPointer: { role: { exact: "verb" }, targetValue: { vcmp: { cmp: "eq", value: "admin" } } },
  };
  return {
    op: "select",
    pred: {
      and: [grantShaped, adminsOnly ? { and: [operatorMinted, adminVerbed] } : operatorMinted],
    },
    in: {
      op: "mask",
      policy: { trust: { match: { field: "author", cmp: "eq", const: operator } } },
      in: "input",
    },
  };
}

/** @internal — the data-strike trust predicate, exported for its parity rail */
export function lawfulStrikersJson(operator: string, adminsOnly: boolean): unknown {
  return {
    or: [
      { match: { field: "author", cmp: "eq", const: operator } },
      {
        inView: {
          term: lawfulGrantsTermJson(operator, adminsOnly),
          field: "author",
          extract: { role: "subject" },
        },
      },
    ],
  };
}

// The strings an `inView` extract reflects from one pointer role, exactly as the substrate's
// `extractReflected` does: an entity id, a delta id, or a STRING primitive. Any other primitive
// names no author.
function reflectedSubjects(d: Delta, role: string): string[] {
  const out: string[] = [];
  for (const p of d.claims.pointers) {
    if (p.role !== role) continue;
    const t = p.target;
    if (t.kind === "entity") out.push(t.entity.id);
    else if (t.kind === "delta") out.push(t.deltaRef.delta);
    else if (typeof t.value === "string") out.push(t.value);
  }
  return out;
}

// The canonical gather with a TRUST-AWARE negation mask: data negations bind only from the
// operator and the operator's grantees. A federated stranger's strike is inert here — the
// heckler's veto ends where this body begins.
export function governedGatherBody(operator: string): Term {
  return entityGatherBody({ mask: { trust: lawfulStrikersJson(operator, false) } });
}

// Is `id` struck AS DATA — the question a governed READER answers, which is not the question
// `lawfulNegated` answers. That one counts a negation only from the OPERATOR: right for LAW (a
// grantee's strike must not retire the operator's schema) and wrong for data, where the governed
// gather honors the wider community — the operator plus any author their surviving grants name. Any
// operation that FILTERS data by survival wants this one; anything resolving the constitution wants
// the other. The striker set RESTATES `lawfulStrikersJson(operator, false)` in code: the substrate
// predicate takes a function, not a Pred, so the gather's mask and this filter are two derivations
// of one rule, and a change to one must change the other. Ungoverned, every negation binds.
//
// Absence is not suppression: an id the store does not hold answers FALSE — it is not something
// this can say has been struck. Callers weighing a purged source (§11) must ask erasure, not this.
// Build it once per pass and reuse the closure; it clears its memo after an accepted ingest.
//
// A strike counts only while it is valid at `now`; the target's own validity is not asked.
export function dataStruck(
  reactor: Reactor,
  now: number,
  operator?: string,
): (id: string) => boolean {
  const witnesses = dataStrikeWitnesses(reactor, now, operator);
  return (id) => witnesses(id).length > 0;
}

/** The strikes that hold on `id` as data at `now`: the witness form of `dataStruck`. */
export function dataStrikeWitnesses(
  reactor: Reactor,
  now: number,
  operator?: string,
): (id: string) => readonly Delta[] {
  if (operator === undefined) return reactor.negationWitnesses(now, () => true);
  const strikers = dataStrikers(reactor, now, operator);
  return reactor.negationWitnesses(now, (n) => strikers.has(n.claims.author));
}

// The trusted strikers, read from the same Term the gather's mask reflects over: the operator,
// plus the subject of every surviving operator grant valid at `now`.
function dataStrikers(reactor: Reactor, now: number, operator: string): Set<string> {
  // Every grant is filed at the store entity, so the index finds the candidates. The term's mask
  // must see every negation that can reach them, so the candidates carry their whole negation
  // closure (H1); nothing else in the store can change which grants survive.
  const scope = new Map<string, Delta>();
  const take = (id: string): void => {
    const d = reactor.get(id);
    if (d === undefined || scope.has(id)) return;
    scope.set(id, d);
    for (const n of reactor.negationsOf(id)) take(n);
  };
  for (const id of reactor.byTarget(STORE_ENTITY)) take(id);
  const grants = evalTerm(
    parseTerm(lawfulGrantsTermJson(operator, false)),
    DeltaSet.from(scope.values()),
    now,
  );
  if (grants.sort !== "dset")
    throw new Error("the lawful-grants term always evaluates to a delta set");
  const strikers = new Set<string>([operator]);
  for (const g of grants.set) for (const s of reflectedSubjects(g, "subject")) strikers.add(s);
  return strikers;
}

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

// The governed audit schema: like TENANT, but negations bind only from the operator and the
// operator's ADMIN grantees — the same standing `standsFor` demands — so what the audit shows
// agrees with what enforcement honors (to the chain's first link).
export function tenantSchemaFor(operator: string): HyperSchema {
  return {
    name: "Tenant",
    alg: 1,
    body: entityGatherBody({ mask: { trust: lawfulStrikersJson(operator, true) } }),
  };
}

export const TENANT_POLICY: Schema = {
  props: new Map(),
  default: { kind: "all", order: { kind: "byTimestamp", dir: "asc" } },
};

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

interface Ctx {
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
function struck(ctx: Ctx, id: string, visited: ReadonlySet<string>): boolean {
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

/** Is `id` struck at `now` by a negation the constitution honours (the door's own reading)? */
export function struckAt(reactor: Reactor, now: number, id: string, operator?: string): boolean {
  return struck({ reactor, now, operator }, id, new Set());
}

// May this negation RETIRE what it strikes? Constitutional resolution honors a strike only
// from the operator or an effective store admin — a mere writer (or a federated stranger) may
// assert a negation, but the constitution does not bend to it. (Whether DATA bends to a
// negation is the reader's mask policy, not decided here.)
function standsFor(ctx: Ctx, delta: Delta, visited: ReadonlySet<string>): boolean {
  if (delta.claims.author === ctx.operator) return true;
  return grantHeld(ctx, STORE_ENTITY, delta.claims.author, "admin", visited);
}

// The surviving deltas filed at `entity` under `context`: valid now, and not struck.
function survivingAt(
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

function tenantOfWith(ctx: Ctx, entity: string, visited: ReadonlySet<string>): string | undefined {
  let winner: { tenant: string; timestamp: number; id: string } | undefined;
  for (const d of survivingAt(ctx, entity, CTX_TENANT, visited)) {
    const member = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_MEMBERS,
    );
    if (member?.target.kind !== "entity") continue;
    const tenant = member.target.entity.id;
    // A membership is effective only if its author had the standing to make it: admin on the
    // entity's then-current tenant AND on the receiving one (first adoption is operator-only).
    if (ctx.operator !== undefined && d.claims.author !== ctx.operator) {
      const branch = new Set(visited).add(d.id);
      const current = tenantOfWith(ctx, entity, branch);
      if (
        current === undefined ||
        !grantHeld(ctx, current, d.claims.author, "admin", branch) ||
        !grantHeld(ctx, tenant, d.claims.author, "admin", branch)
      ) {
        continue;
      }
    }
    const candidate = { tenant, timestamp: d.claims.timestamp, id: d.id };
    if (
      winner === undefined ||
      candidate.timestamp > winner.timestamp ||
      (candidate.timestamp === winner.timestamp && candidate.id > winner.id)
    ) {
      winner = candidate;
    }
  }
  return winner?.tenant;
}

function grantHeld(
  ctx: Ctx,
  tenant: string,
  author: string,
  verb: Verb,
  visited: ReadonlySet<string>,
): boolean {
  for (const d of survivingAt(ctx, tenant, CTX_GRANTS, visited)) {
    let subject: string | undefined;
    let granted: string | undefined;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string") subject = p.target.value;
      if (p.role === "verb" && typeof p.target.value === "string") granted = p.target.value;
    }
    if (
      subject === undefined ||
      !keysActingFor(ctx.reactor, ctx.now, { root: subject }, tenant).has(author)
    )
      continue;
    // `admin` covers `write`, and NEVER `register`. An admin grant carries no prefix, so "admin
    // covers register" could only ever mean register AT ROOT — the one authority that is not
    // delegable through the verb lattice. An admin who wants to register mints themselves a
    // prefixed register grant, which is a visible act in the audit rather than an implication.
    if (verb === "register" ? granted !== "register" : granted !== "admin" && granted !== verb) {
      continue;
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

// The tenant `entity` currently belongs to — the latest effective membership claim wins.
export function tenantOf(
  reactor: Reactor,
  now: number,
  entity: string,
  operator?: string,
): string | undefined {
  return tenantOfWith({ reactor, now, operator }, entity, new Set());
}

// One grant `author` currently holds at the store entity, as an operator reads it.
export interface HeldGrant {
  readonly id: string;
  readonly verb: Verb;
  /** Present on a `register` grant and on no other: the namespace it may shape. */
  readonly prefix?: string;
}

// Every EFFECTIVE surviving grant naming `author` at the store entity — the one derivation both
// `loam grant list` and the registration door read, so what an operator sees and what a door
// honours cannot drift. "Effective" is the same discipline `grantHeld` runs: in a governed store a
// grant binds only if the operator signed it or an effective admin did, and only if it survives
// strikes that themselves had standing. A revocation therefore removes a row here on the very next
// read, with nothing to invalidate.
export function grantsHeldBy(
  reactor: Reactor,
  now: number,
  author: string,
  operator?: string,
): HeldGrant[] {
  const ctx: Ctx = { reactor, now, operator };
  const out: HeldGrant[] = [];
  for (const d of survivingAt(ctx, STORE_ENTITY, CTX_GRANTS, new Set())) {
    if (constitutionalDefect(d) !== undefined) continue; // malformed law binds nothing
    let subject: string | undefined;
    let verb: string | undefined;
    let prefix: string | undefined;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "primitive" || typeof p.target.value !== "string") continue;
      if (p.role === "subject") subject = p.target.value;
      if (p.role === "verb") verb = p.target.value;
      if (p.role === "prefix") prefix = p.target.value;
    }
    if (subject !== author || verb === undefined || !VERBS.has(verb)) continue;
    if (operator !== undefined && d.claims.author !== operator) {
      // ONLY THE OPERATOR MINTS REGISTER STANDING. `write` and `admin` are delegable through the
      // admin chain, as they always have been. `register` is not, and the asymmetry is deliberate:
      // an admin could otherwise sign itself `register` with a one-character prefix, and since the
      // publish carries no request context the store would sign the result WITH THE OPERATOR'S OWN
      // SEED — the operator's constitutional schemas superseded under the operator's key. Nobody
      // decided to delegate that, so it is not delegated.
      if (verb === "register") continue;
      const branch = new Set([d.id]);
      if (!grantHeld(ctx, STORE_ENTITY, d.claims.author, "admin", branch)) continue;
    }
    out.push({
      id: d.id,
      verb: verb as Verb,
      ...(prefix === undefined ? {} : { prefix }),
    });
  }
  return out;
}

// The namespaces `author` may register inside, right now. Empty means no register standing at all,
// which is the door's cue to answer the ordinary authority refusal — a caller with an empty list
// and a caller with no token learn exactly the same thing.
/**
 * The containers this author may federate on, by an effective surviving grant.
 *
 * The scope rides the same `prefix` slot T174's register verb uses, because a grant already carries
 * one scoping string and a second would be a parallel vocabulary for the same idea. What differs is
 * the COMPARISON: a register prefix is a literal prefix of an entity name, while a federate scope is
 * a container name matched WHOLE. A channel lives in exactly one container, so prefix-matching here
 * would silently admit `friends-archive` to a grant that said `friends`.
 */
export function federateContainersOf(
  reactor: Reactor,
  now: number,
  author: string,
  operator?: string,
): string[] {
  const seen = new Set<string>();
  for (const g of grantsHeldBy(reactor, now, author, operator)) {
    if (g.verb === "federate" && g.prefix !== undefined) seen.add(g.prefix);
  }
  return [...seen];
}

export function registerPrefixesOf(
  reactor: Reactor,
  now: number,
  author: string,
  operator?: string,
): string[] {
  const seen = new Set<string>();
  for (const g of grantsHeldBy(reactor, now, author, operator)) {
    if (g.verb === "register" && g.prefix !== undefined) seen.add(g.prefix);
  }
  return [...seen];
}

// Does `author` hold `verb` (admin covers write) on `tenant`, by an effective surviving grant?
export function holdsGrant(
  reactor: Reactor,
  now: number,
  tenant: string,
  author: string,
  verb: Verb,
  operator?: string,
): boolean {
  return grantHeld({ reactor, now, operator }, tenant, author, verb, new Set());
}

// --- enforcement: the one question the gateway asks -----------------------------------------------
//
// Standing: may this author publish through this instance at all? One surviving,
// operator-rooted `write` grant at the store entity answers it — for every delta the author
// signs, whatever it points at. Pointing is free; ids are unowned; the fences are the
// reader's. (`admin` covers `write` and additionally mints grants and retires constitution.)

// A constitutional delta must be exactly what its context claims: a grant carries a tenant, a
// string subject, and a known verb; a membership carries one member roll and one allegiance.
// Anything else would sit in the audit looking like law while binding nothing — refused, for
// everyone, the operator included.
export function constitutionalDefect(delta: Delta): string | undefined {
  const ptrs = delta.claims.pointers;
  const grants = ptrs.filter(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_GRANTS,
  );
  const members = ptrs.filter(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_MEMBERS,
  );
  const allegiances = ptrs.filter(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_TENANT,
  );
  if (grants.length === 0 && members.length === 0 && allegiances.length === 0) return undefined;

  if (grants.length > 0) {
    if (grants.length !== 1 || members.length + allegiances.length > 0) {
      return "a grant names exactly one tenant and nothing else constitutional";
    }
    // Exactly ONE subject and ONE verb: duplicates would read differently in enforcement
    // (last wins), validation (first checked), and the inView lenses (any match) — a delta
    // that means three things in three places is malformed law, whoever signed it.
    const subjects = ptrs.filter((p) => p.role === "subject");
    const verbs = ptrs.filter((p) => p.role === "verb");
    const prefixes = ptrs.filter((p) => p.role === "prefix");
    if (
      subjects.length !== 1 ||
      subjects[0]!.target.kind !== "primitive" ||
      typeof subjects[0]!.target.value !== "string"
    ) {
      return "a grant carries exactly one string subject";
    }
    const verbTarget = verbs[0]?.target;
    if (
      verbs.length !== 1 ||
      verbTarget?.kind !== "primitive" ||
      typeof verbTarget.value !== "string" ||
      !VERBS.has(verbTarget.value)
    ) {
      return 'a grant carries exactly one verb: "write", "admin", "register" or "federate"';
    }
    // The scope is part of the verb's meaning, so it is checked as law rather than at the door.
    // A register grant with no prefix is REFUSED rather than read as meaningless: a grant-shaped
    // delta that binds nothing sits in the audit looking like authority, and the next reader is
    // as free to read a missing fence as "unrestricted" as to read it as "nothing".
    // Two verbs are SCOPED, and a scoped grant with no scope is REFUSED rather than read as
    // meaningless: a grant-shaped delta that binds nothing sits in the audit looking like authority,
    // and the next reader is as free to read a missing fence as "unrestricted" as to read it as
    // "nothing". `register` names an entity namespace; `federate` (T188) names a container.
    if (verbTarget.value === "register" || verbTarget.value === "federate") {
      const prefix = prefixes[0]?.target;
      if (
        prefixes.length !== 1 ||
        prefix?.kind !== "primitive" ||
        typeof prefix.value !== "string" ||
        prefix.value.length === 0
      ) {
        return verbTarget.value === "register"
          ? "a register grant carries exactly one non-empty string prefix — the entity namespace " +
              "it may register inside; registration at the root is the operator's and is not delegable"
          : "a federate grant carries exactly one non-empty string scope — the container it may " +
              "open channels into; federating the whole store is the operator's and is not delegable";
      }
    } else if (prefixes.length > 0) {
      return `a ${verbTarget.value} grant carries no scope — only register and federate are scoped`;
    }
    return undefined;
  }
  if (members.length !== 1 || allegiances.length !== 1) {
    return "a membership carries exactly one member roll and one allegiance";
  }
  return undefined;
}

// The verdict. Malformed law is refused for everyone (a grant-shaped delta that could never
// bind would sit in the audit lying); past that, the operator needs no grant, an ungoverned
// store welcomes any verified author, and everyone else holds standing — or is refused.
export function authorize(
  reactor: Reactor,
  now: number,
  delta: Delta,
  operator: string | undefined,
): { ok: true } | { ok: false; refusal: string } {
  const defect =
    constitutionalDefect(delta) ??
    trustDefect(delta.claims) ??
    bindingPolicyDefect(delta.claims) ??
    publicDefect(delta.claims) ??
    artifactDefect(delta.claims) ??
    budgetDefect(delta.claims) ??
    envelopeDefect(delta.claims) ??
    containerDefect(delta, reactor, now, operator) ??
    eraseDefect(delta, reactor, operator) ??
    slateDefect(delta, reactor, now, operator);
  if (defect !== undefined) {
    return { ok: false, refusal: `delta ${delta.id} is malformed law: ${defect}` };
  }
  const author = delta.claims.author;
  if (operator === undefined || author === operator) return { ok: true };
  if (grantHeld({ reactor, now, operator }, STORE_ENTITY, author, "write", new Set())) {
    return { ok: true };
  }
  return {
    ok: false,
    refusal:
      `${author} is not permitted: publishing through this store requires write standing ` +
      `(a surviving grant at ${STORE_ENTITY}), and no surviving grant says so`,
  };
}
