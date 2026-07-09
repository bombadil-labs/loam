// Accounts & capabilities: no ambient authority, anywhere. A tenant is an entity; membership
// and grants are signed deltas filed at it; revocation is negation; audit is a query. The
// gateway enforces — a write is authorized iff a surviving grant permits it — but the POLICY
// is entirely data: every permission in force is a delta someone signed, someone can query,
// and someone with standing can negate.
//
// The reserved contexts (`loam.tenant`, `loam.members`, `loam.grants`) are the constitution's
// alphabet: writing them takes `admin` standing on every tenant involved; everything else takes
// `write` on the entity's tenant; an entity with no tenant is the operator's alone; and the
// operator — the gateway's own identity — roots the whole chain, needing no grant.

import {
  parseTerm,
  type Claims,
  type Delta,
  type HyperSchema,
  type Policy,
  type Reactor,
} from "@bombadil/rhizomatic";

export const CTX_TENANT = "loam.tenant";
export const CTX_MEMBERS = "loam.members";
export const CTX_GRANTS = "loam.grants";
const CONSTITUTIONAL = new Set([CTX_TENANT, CTX_MEMBERS, CTX_GRANTS]);

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

// The surviving (non-negated) deltas filed at `entity` under `context`.
function survivingAt(reactor: Reactor, entity: string, context: string): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(entity)) {
    if (reactor.negationsOf(id).length > 0) continue;
    const delta = reactor.get(id);
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

// The tenant `entity` currently belongs to — the latest surviving membership claim wins.
export function tenantOf(reactor: Reactor, entity: string): string | undefined {
  let winner: { tenant: string; timestamp: number; id: string } | undefined;
  for (const d of survivingAt(reactor, entity, CTX_TENANT)) {
    const member = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_MEMBERS,
    );
    if (member?.target.kind !== "entity") continue;
    const candidate = { tenant: member.target.entity.id, timestamp: d.claims.timestamp, id: d.id };
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

// Does `author` hold `verb` (or better — admin covers write) on `tenant`, by a surviving grant?
export function holdsGrant(reactor: Reactor, tenant: string, author: string, verb: Verb): boolean {
  for (const d of survivingAt(reactor, tenant, CTX_GRANTS)) {
    let subject: string | undefined;
    let granted: string | undefined;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string") subject = p.target.value;
      if (p.role === "verb" && typeof p.target.value === "string") granted = p.target.value;
    }
    if (subject !== author) continue;
    if (granted === "admin" || granted === verb) return true;
  }
  return false;
}

// --- enforcement: the one question the gateway asks -----------------------------------------------

// Everything `delta` needs standing for. Ordinary entity targets need `write` on their tenant;
// constitutional contexts need `admin` on every tenant the delta references (and on the current
// tenant of any entity whose allegiance it would change); a negation needs whatever the delta it
// strikes needed. A requirement with no tenant is unmeetable except by the operator.
export interface Requirement {
  readonly tenant: string | undefined;
  readonly verb: Verb;
  readonly reason: string;
}

export function requirementsOf(reactor: Reactor, delta: Delta): Requirement[] {
  const requirements: Requirement[] = [];
  const constitutional = delta.claims.pointers.some(
    (p) => p.target.kind === "entity" && CONSTITUTIONAL.has(p.target.entity.context ?? ""),
  );

  for (const p of delta.claims.pointers) {
    if (p.target.kind === "entity") {
      const { id, context } = p.target.entity;
      if (constitutional) {
        if (context === CTX_GRANTS || context === CTX_MEMBERS) {
          requirements.push({ tenant: id, verb: "admin", reason: `governs ${id}` });
        } else if (context === CTX_TENANT) {
          const current = tenantOf(reactor, id);
          if (current !== undefined) {
            requirements.push({
              tenant: current,
              verb: "admin",
              reason: `re-tenants ${id} away from ${current}`,
            });
          } else {
            // First allegiance of an untenanted entity: the operator's to give.
            requirements.push({ tenant: undefined, verb: "admin", reason: `adopts ${id}` });
          }
        } else {
          requirements.push({
            tenant: tenantOf(reactor, id),
            verb: "write",
            reason: `writes ${id}`,
          });
        }
      } else {
        requirements.push({ tenant: tenantOf(reactor, id), verb: "write", reason: `writes ${id}` });
      }
    } else if (p.target.kind === "delta" && p.role === "negates") {
      const struck = reactor.get(p.target.deltaRef.delta);
      if (struck === undefined) {
        requirements.push({
          tenant: undefined,
          verb: "admin",
          reason: `negates an unknown delta ${p.target.deltaRef.delta}`,
        });
      } else {
        requirements.push(...requirementsOf(reactor, struck));
      }
    }
  }

  if (requirements.length === 0) {
    // A delta touching no entity and striking nothing files nowhere anyone governs.
    requirements.push({ tenant: undefined, verb: "write", reason: "touches no governed ground" });
  }
  return requirements;
}

// The verdict. The operator needs no grant; everyone else meets every requirement or is refused.
export function authorize(
  reactor: Reactor,
  delta: Delta,
  operator: string | undefined,
): { ok: true } | { ok: false; refusal: string } {
  const author = delta.claims.author;
  if (operator !== undefined && author === operator) return { ok: true };
  for (const req of requirementsOf(reactor, delta)) {
    if (req.tenant === undefined || !holdsGrant(reactor, req.tenant, author, req.verb)) {
      const scope = req.tenant === undefined ? "unclaimed ground" : req.tenant;
      return {
        ok: false,
        refusal:
          `${author} is not permitted: ${req.reason} requires ${req.verb} on ${scope}, ` +
          `and no surviving grant says so`,
      };
    }
  }
  return { ok: true };
}
