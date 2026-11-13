import { type Delta, type Reactor } from "@bombadil/rhizomatic";
import { keyActsFor, principalScopeOf } from "./principal.js";
import { retiredKeysOf, subjectKeyAt, userGroundOf, usersGovernor } from "./user-root.js";
import { STORE_ENTITY } from "./genesis.js";
import { CTX_GRANTS } from "./governed-trust.js";
import type { Ground } from "./ground.js";

export type Verb = "write" | "admin" | "register" | "federate";

export function honoredStrikeOn(
  reactor: Reactor,
  now: number,
  id: string,
  operator?: string,
): { readonly id: string; readonly timestamp: number } | undefined {
  const ctx: Ctx = { reactor, now, operator };
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

export interface Ctx {
  readonly reactor: Reactor;
  readonly now: number;
  readonly operator: string | undefined;
}

export function validAt(d: Delta, now: number): boolean {
  const { validFrom, validUntil } = d.claims;
  return validFrom <= now && (validUntil === undefined || now < validUntil);
}

export function struck(ctx: Ctx, id: string, visited: ReadonlySet<string>): boolean {
  for (const negId of ctx.reactor.negationsOf(id)) {
    if (visited.has(negId)) continue;
    const neg = ctx.reactor.get(negId);
    if (neg === undefined || !validAt(neg, ctx.now)) continue;
    const branch = new Set(visited).add(negId);
    if (struck(ctx, negId, branch)) continue;
    if (ctx.operator !== undefined && !standsFor(ctx, neg, branch)) continue;
    return true;
  }
  return false;
}

function standsFor(ctx: Ctx, delta: Delta, visited: ReadonlySet<string>): boolean {
  if (delta.claims.author === ctx.operator) return true;
  return grantHeld(ctx, STORE_ENTITY, delta.claims.author, "admin", visited);
}

export function grantSubjects(reactor: Ground): string[] {
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
    if (verb === "register" ? granted !== "register" : granted !== "admin" && granted !== verb) {
      continue;
    }
    const key = subjectKeyAt(ctx.reactor, ctx.now, ctx.operator, subject);
    if (key === undefined) continue;
    if (retiredIn(ctx).has(key)) continue;
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
    if (ctx.operator !== undefined && d.claims.author !== ctx.operator) {
      const branch = new Set(visited).add(d.id);
      if (!grantHeld(ctx, tenant, d.claims.author, "admin", branch)) continue;
    }
    return true;
  }
  return false;
}
