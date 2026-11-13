import { DeltaSet, governedDeltas, type Delta, type Reactor } from "@bombadil/rhizomatic";
import type { Ground } from "./ground.js";

export function lawfulSnapshot(
  reactor: Reactor,
  now: number,
  operator?: string | readonly string[],
): DeltaSet {
  return governedDeltas(
    reactor.snapshot(),
    now,
    operator === undefined
      ? () => true
      : new Set(typeof operator === "string" ? [operator] : operator),
  );
}

export function lawfulHistory(reactor: Reactor, operator?: string): DeltaSet {
  if (operator === undefined) return reactor.snapshot();
  return DeltaSet.from([...reactor.snapshot()].filter((d) => d.claims.author === operator));
}

export interface LawAt {
  readonly entity: string;
  readonly context: string;
}

export function lawfulDeltasAt(
  reactor: Ground,
  now: number,
  at: LawAt,
  operator?: string,
): Delta[] {
  return lawfulHistoryAt(reactor, at, operator).filter(
    (d) =>
      d.claims.validFrom <= now && (d.claims.validUntil === undefined || now < d.claims.validUntil),
  );
}

export function lawfulHistoryAt(reactor: Ground, at: LawAt, operator?: string): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(at.entity)) {
    const delta = indexed(reactor, id, at.entity);
    if (operator !== undefined && delta.claims.author !== operator) continue;
    const filedHere = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === at.entity &&
        p.target.entity.context === at.context,
    );
    if (filedHere) out.push(delta);
  }
  return out;
}

function indexed(ground: Ground, id: string, entity: string): Delta {
  const delta = ground.get(id);
  if (delta === undefined) {
    throw new Error(
      `the target index names delta ${id} at ${entity}, and the store cannot resolve it — ` +
        `refusing to read law from a ground that disagrees with its own index`,
    );
  }
  return delta;
}

export function lawfulScopeAt(
  ground: Ground,
  now: number,
  entity: string,
  operator?: string,
  alsoNegated: Iterable<string> = [],
): DeltaSet {
  if (!Number.isFinite(now)) throw new Error("now must be a finite number");
  const out = new Map<string, Delta>();
  const pending = [...ground.byTarget(entity)];
  for (const id of alsoNegated) pending.push(...ground.negationsOf(id));
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (out.has(id)) continue;
    const delta = indexed(ground, id, entity);
    const { author, validFrom, validUntil } = delta.claims;
    if (operator !== undefined && author !== operator) continue;
    if (validFrom > now || (validUntil !== undefined && now >= validUntil)) continue;
    out.set(id, delta);
    pending.push(...ground.negationsOf(id));
  }
  return DeltaSet.from(out.values());
}
