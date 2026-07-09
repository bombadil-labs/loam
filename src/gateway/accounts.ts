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
  parseTerm,
  type Claims,
  type Delta,
  type HyperSchema,
  type Policy,
  type Reactor,
} from "@bombadil/rhizomatic";
import { STORE_ENTITY } from "./genesis.js";

export const CTX_TENANT = "loam.tenant";
export const CTX_MEMBERS = "loam.members";
export const CTX_GRANTS = "loam.grants";
export type Verb = "write" | "admin";

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
    author,
    pointers: [
      { role: "member", target: { kind: "entity", entity: { id: tenant, context: CTX_MEMBERS } } },
      { role: "entity", target: { kind: "entity", entity: { id: entity, context: CTX_TENANT } } },
    ],
  };
}

// `subject` may `verb` within `tenant`: the capability itself, as one signed delta.
export function grantClaims(
  tenant: string,
  subject: string,
  verb: Verb,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      { role: "tenant", target: { kind: "entity", entity: { id: tenant, context: CTX_GRANTS } } },
      { role: "subject", target: { kind: "primitive", value: subject } },
      { role: "verb", target: { kind: "primitive", value: verb } },
    ],
  };
}

// Revocation is negation — the grant delta is struck, and resolution forgets it.
export function revocationClaims(grantDeltaId: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
    author,
    pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: grantDeltaId } } }],
  };
}

// --- the audit surface ----------------------------------------------------------------------------

// A tenant, gathered: its grants, its members, anything filed at it.
export const TENANT: HyperSchema = {
  name: "Tenant",
  alg: 1,
  body: parseTerm({
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  }),
};

export const TENANT_POLICY: Policy = {
  props: new Map(),
  default: { kind: "all", order: { kind: "byTimestamp", dir: "asc" } },
};

// --- resolution: what the ground says about who may do what -------------------------------------
//
// Everything here answers under one discipline: in a governed store (an operator is named), a
// constitutional delta — a grant, a membership, or a strike against one — is EFFECTIVE only if
// its authority chain roots in the operator. The chain is timeless: it needs no arrival order,
// only reachability, so a store poisoned while ungoverned (self-signed grants, hostile strikes)
// resolves to nothing the moment an operator opens it — a cycle of self-appointed admins roots
// nowhere. Ungoverned stores skip the discipline entirely: no operator, no constitution.

interface Ctx {
  readonly reactor: Reactor;
  readonly operator: string | undefined;
}

// Is `id` struck by a negation that (a) itself survives and (b) had the standing to strike?
// Content addressing makes the negation graph a DAG, but `visited` guards it regardless.
function struck(ctx: Ctx, id: string, visited: ReadonlySet<string>): boolean {
  for (const negId of ctx.reactor.negationsOf(id)) {
    if (visited.has(negId)) continue;
    const branch = new Set(visited).add(negId);
    if (struck(ctx, negId, branch)) continue; // the strike is itself struck: inert
    const neg = ctx.reactor.get(negId);
    if (neg === undefined) continue;
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

// The surviving deltas filed at `entity` under `context`.
function survivingAt(
  ctx: Ctx,
  entity: string,
  context: string,
  visited: ReadonlySet<string>,
): Delta[] {
  const out: Delta[] = [];
  for (const id of ctx.reactor.byTarget(entity)) {
    if (visited.has(id)) continue;
    if (struck(ctx, id, visited)) continue;
    const delta = ctx.reactor.get(id);
    if (delta === undefined) continue;
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
    if (subject !== author) continue;
    if (granted !== "admin" && granted !== verb) continue;
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
export function tenantOf(reactor: Reactor, entity: string, operator?: string): string | undefined {
  return tenantOfWith({ reactor, operator }, entity, new Set());
}

// Does `author` hold `verb` (admin covers write) on `tenant`, by an effective surviving grant?
export function holdsGrant(
  reactor: Reactor,
  tenant: string,
  author: string,
  verb: Verb,
  operator?: string,
): boolean {
  return grantHeld({ reactor, operator }, tenant, author, verb, new Set());
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
    const subject = ptrs.find((p) => p.role === "subject" && p.target.kind === "primitive");
    const verb = ptrs.find((p) => p.role === "verb" && p.target.kind === "primitive");
    if (subject?.target.kind !== "primitive" || typeof subject.target.value !== "string") {
      return "a grant carries a string subject";
    }
    if (
      verb?.target.kind !== "primitive" ||
      (verb.target.value !== "write" && verb.target.value !== "admin")
    ) {
      return 'a grant\'s verb is "write" or "admin"';
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
  delta: Delta,
  operator: string | undefined,
): { ok: true } | { ok: false; refusal: string } {
  const defect = constitutionalDefect(delta);
  if (defect !== undefined) {
    return { ok: false, refusal: `delta ${delta.id} is malformed law: ${defect}` };
  }
  const author = delta.claims.author;
  if (operator === undefined || author === operator) return { ok: true };
  if (grantHeld({ reactor, operator }, STORE_ENTITY, author, "write", new Set())) {
    return { ok: true };
  }
  return {
    ok: false,
    refusal:
      `${author} is not permitted: publishing through this store requires write standing ` +
      `(a surviving grant at ${STORE_ENTITY}), and no surviving grant says so`,
  };
}
