import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { Ground } from "./ground.js";

export const BUDGET_ENTITY = "loam:budget";
export const CTX_BUDGET = "loam.budget";

export interface BudgetPolicy {
  readonly maxAppends?: number;
}

export function budgetClaims(
  subject: string,
  maxAppends: number,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: BUDGET_ENTITY, context: CTX_BUDGET } },
      },
      { role: "subject", target: { kind: "primitive", value: subject } },
      { role: "maxAppends", target: { kind: "primitive", value: maxAppends } },
    ],
  };
}

export function budgetDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === BUDGET_ENTITY &&
      p.target.entity.context === CTX_BUDGET,
  );
  if (!declares) return undefined;
  const subjects = claims.pointers.filter((p) => p.role === "subject");
  if (
    subjects.length !== 1 ||
    subjects[0]!.target.kind !== "primitive" ||
    typeof subjects[0]!.target.value !== "string" ||
    subjects[0]!.target.value === ""
  ) {
    return "a budget declaration names exactly one author subject";
  }
  const dimensions = claims.pointers.filter((p) => p.role !== "declares" && p.role !== "subject");
  if (dimensions.length === 0) {
    return "a budget declaration carries at least one limit (v1: maxAppends)";
  }
  const ceilings = claims.pointers.filter((p) => p.role === "maxAppends");
  if (ceilings.length > 1) return "a budget declaration carries at most one maxAppends";
  if (
    ceilings.length === 1 &&
    (ceilings[0]!.target.kind !== "primitive" ||
      typeof ceilings[0]!.target.value !== "number" ||
      !Number.isInteger(ceilings[0]!.target.value) ||
      ceilings[0]!.target.value < 0)
  ) {
    return "maxAppends must be a non-negative integer";
  }
  return undefined;
}

export function readBudgetPolicy(
  reactor: Ground,
  now: number,
  operator?: string,
): ReadonlyMap<string, BudgetPolicy> {
  const budgets = new Map<string, BudgetPolicy>();
  if (operator === undefined) return budgets;
  const negated = negatedAt(reactor, now, operator);
  const latest = new Map<string, { policy: BudgetPolicy; timestamp: number; id: string }>();
  for (const delta of lawfulDeltasAt(
    reactor,
    now,
    { entity: BUDGET_ENTITY, context: CTX_BUDGET },
    operator,
  )) {
    if (negated(delta.id)) continue;

    let subject: string | undefined;
    const policy: { maxAppends?: number } = {};
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string" && p.target.value !== "") {
        subject = p.target.value;
      }
      if (
        p.role === "maxAppends" &&
        typeof p.target.value === "number" &&
        Number.isInteger(p.target.value) &&
        p.target.value >= 0
      ) {
        policy.maxAppends = p.target.value;
      }
    }
    if (subject === undefined) continue;

    const current = latest.get(subject);
    if (
      current === undefined ||
      delta.claims.timestamp > current.timestamp ||
      (delta.claims.timestamp === current.timestamp && delta.id > current.id)
    ) {
      latest.set(subject, { policy, timestamp: delta.claims.timestamp, id: delta.id });
    }
  }
  for (const [subject, { policy }] of latest) {
    if (policy.maxAppends !== undefined) budgets.set(subject, policy);
  }
  return budgets;
}

function countHeldBy(reactor: Reactor, author: string): number {
  let held = 0;
  for (const d of reactor.snapshot()) if (d.claims.author === author) held += 1;
  return held;
}

export function budgetRefusal(
  reactor: Reactor,
  now: number,
  operator: string,
  batch: readonly Delta[],
): string | undefined {
  const budgets = readBudgetPolicy(reactor, now, operator);
  if (budgets.size === 0) return undefined;
  const additions = new Map<string, number>();
  for (const d of batch) {
    const author = d.claims.author;
    if (author === operator || !budgets.has(author)) continue;
    if (reactor.get(d.id) !== undefined) continue;
    additions.set(author, (additions.get(author) ?? 0) + 1);
  }
  for (const [author, added] of additions) {
    const quota = budgets.get(author)!.maxAppends!;
    const held = countHeldBy(reactor, author);
    if (held + added > quota) {
      return (
        `${author} is over budget: this store's operator set a volume quota of ${quota} ` +
        `deltas for this author, who already holds ${held}` +
        (added > 1 ? ` and this batch would add ${added}` : ``) +
        ` — the operator may raise the quota with a delta at ${BUDGET_ENTITY}`
      );
    }
  }
  return undefined;
}
