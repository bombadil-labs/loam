import {
  type Claims,
  type Delta,
  type HyperSchema,
  type Schema,
  type Reactor,
  type Term,
} from "@bombadil/rhizomatic";
import { recoveryDefect, subjectKeyAt, userGroundOf } from "./user-root.js";
import { STORE_ENTITY } from "./genesis.js";
import { CTX_GRANTS, dataStrikers, lawfulStrikersJson } from "./governed-trust.js";
export { CTX_GRANTS, lawfulStrikersJson } from "./governed-trust.js";
import { entityGatherBody } from "./gather.js";
import { isErasure, orderBinds, eraseDefect, erasedInBatch, refusedIds } from "./erase-law.js";
import { publicDefect } from "./public.js";
import { artifactDefect } from "./artifact.js";
import { trustDefect } from "./trust.js";
import { bindingPolicyDefect } from "./binding-policy.js";
import { budgetDefect } from "./budget.js";
import { envelopeDefect } from "./envelope.js";
import { containerDefect } from "./container-law.js";
import { slateDefect } from "./slate-law.js";
import { pausedKeys } from "./recovery-cut.js";
import { type Ctx, type Verb, grantHeld, struck, survivingAt } from "./grants-law.js";

export const CTX_TENANT = "loam.tenant";
export const CTX_MEMBERS = "loam.members";
export const VERBS: ReadonlySet<string> = new Set<Verb>(["write", "admin", "register", "federate"]);

export function fenceAdmits(prefix: string, name: string): boolean {
  return prefix.length > 0 && name.startsWith(prefix);
}

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

export function revocationClaims(grantDeltaId: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: grantDeltaId } } }],
  };
}

export const TENANT: HyperSchema = { name: "Tenant", alg: 1, body: entityGatherBody() };

export function governedGatherBody(operator: string): Term {
  return entityGatherBody({ mask: { trust: lawfulStrikersJson(operator, false) } });
}

export function dataStruck(
  reactor: Reactor,
  now: number,
  operator?: string,
): (id: string) => boolean {
  const witnesses = dataStrikeWitnesses(reactor, now, operator);
  return (id) => witnesses(id).length > 0;
}

export function dataStrikeWitnesses(
  reactor: Reactor,
  now: number,
  operator?: string,
): (id: string) => readonly Delta[] {
  if (operator === undefined) return reactor.negationWitnesses(now, () => true);
  const strikers = dataStrikers(reactor, now, operator);
  return reactor.negationWitnesses(now, (n) => strikers.has(n.claims.author));
}

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

export function struckAt(reactor: Reactor, now: number, id: string, operator?: string): boolean {
  return struck({ reactor, now, operator }, id, new Set());
}

function tenantOfWith(ctx: Ctx, entity: string, visited: ReadonlySet<string>): string | undefined {
  let winner: { tenant: string; timestamp: number; id: string } | undefined;
  for (const d of survivingAt(ctx, entity, CTX_TENANT, visited)) {
    const member = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_MEMBERS,
    );
    if (member?.target.kind !== "entity") continue;
    const tenant = member.target.entity.id;
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

export function tenantOf(
  reactor: Reactor,
  now: number,
  entity: string,
  operator?: string,
): string | undefined {
  return tenantOfWith({ reactor, now, operator }, entity, new Set());
}

export interface HeldGrant {
  readonly id: string;
  readonly verb: Verb;
  readonly prefix?: string;
}

export function grantsHeldBy(
  reactor: Reactor,
  now: number,
  author: string,
  operator?: string,
): HeldGrant[] {
  return effectiveGrants(
    reactor,
    now,
    operator,
    (subject) => subjectKeyAt(reactor, now, operator, subject) === author,
  ).map(withoutSubject);
}

export function grantsNaming(
  reactor: Reactor,
  now: number,
  author: string,
  operator?: string,
): HeldGrant[] {
  return effectiveGrants(reactor, now, operator, (subject) => subject === author).map(
    withoutSubject,
  );
}

const withoutSubject = (g: HeldGrant & { readonly subject: string }): HeldGrant => ({
  id: g.id,
  verb: g.verb,
  ...(g.prefix === undefined ? {} : { prefix: g.prefix }),
});

function effectiveGrants(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  names: (subject: string) => boolean,
): (HeldGrant & { readonly subject: string })[] {
  const ctx: Ctx = { reactor, now, operator };
  const out: (HeldGrant & { readonly subject: string })[] = [];
  for (const d of survivingAt(ctx, STORE_ENTITY, CTX_GRANTS, new Set())) {
    if (constitutionalDefect(d) !== undefined) continue;
    let subject: string | undefined;
    let verb: string | undefined;
    let prefix: string | undefined;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "primitive" || typeof p.target.value !== "string") continue;
      if (p.role === "subject") subject = p.target.value;
      if (p.role === "verb") verb = p.target.value;
      if (p.role === "prefix") prefix = p.target.value;
    }
    if (subject === undefined || !names(subject) || verb === undefined || !VERBS.has(verb)) {
      continue;
    }
    if (operator !== undefined && d.claims.author !== operator) {
      if (verb === "register") continue;
      const branch = new Set([d.id]);
      if (!grantHeld(ctx, STORE_ENTITY, d.claims.author, "admin", branch)) continue;
    }
    out.push({
      id: d.id,
      subject,
      verb: verb as Verb,
      ...(prefix === undefined ? {} : { prefix }),
    });
  }
  return out;
}

export function effectiveGrantsAt(
  reactor: Reactor,
  now: number,
  operator?: string,
): (HeldGrant & { readonly subject: string })[] {
  return effectiveGrants(reactor, now, operator, () => true);
}

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

export function authorize(
  reactor: Reactor,
  now: number,
  delta: Delta,
  operator: string | undefined,
  batch: readonly Delta[] = [],
  grantRoots: readonly string[] | undefined = undefined,
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
    eraseDefect(delta, reactor, operator, batch) ??
    slateDefect(delta, reactor, now, operator) ??
    recoveryDefect(delta, reactor, operator, batch, () => {
      const users = userGroundOf(reactor);
      return new Set([...users.erased(), ...erasedInBatch(batch, operator)]);
    });
  if (defect !== undefined) {
    return { ok: false, refusal: `delta ${delta.id} is malformed law: ${defect}` };
  }
  if (pausedKeys(reactor, operator, refusedIds(reactor, operator)).has(delta.claims.author)) {
    return {
      ok: false,
      refusal:
        `${delta.claims.author} is paused here by a recovery in progress: ` +
        `it writes again only if that recovery is aborted`,
    };
  }

  const author = delta.claims.author;
  if (operator === undefined || author === operator) return { ok: true };
  if (isErasure(delta.claims) && orderBinds(delta, reactor, operator)) return { ok: true };
  for (const root of grantRoots ?? [operator]) {
    if (grantHeld({ reactor, now, operator: root }, STORE_ENTITY, author, "write", new Set())) {
      return { ok: true };
    }
  }
  return {
    ok: false,
    refusal:
      `${author} is not permitted: publishing through this store requires write standing ` +
      `(a surviving grant at ${STORE_ENTITY}), and no surviving grant says so`,
  };
}
