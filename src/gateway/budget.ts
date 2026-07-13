// Door resource budgets are data (SPEC §25). §12 caps the STRANGER at the public door — a
// safety LAW no operator has to tune, because a tokenless visitor is untrusted by definition and
// the store must survive their arrival unconfigured. A GRANTED author is a different creature:
// the operator's chain already decided to trust them with the door (§7), so how much append
// volume they may spend is not a constitutional invariant but DEPLOYMENT CONFIG — a property of
// this store's disk and cost model, the operator's to tune per deployment. And being Loam,
// configuration is DATA. One operator-authored declaration at `loam:budget` names a granted
// author and the ceiling on their volume: the maximum number of deltas that author may hold on
// this store. The append door consults it, re-resolved from the live deltas each request
// (trust.ts does the same for `loam:trust`) — so raising a quota is a delta, not a restart — and
// an author with NO surviving declaration stays UNMETERED, exactly as today. This is purely
// additive: the §12 floor stays law; this ceiling stays config, layered above it.
//
// Volume (SPEC §25 names rate, volume, and storage-share as candidate dimensions; this realizes
// volume — the one that is a pure, deterministic function of the ground and therefore
// time-travels for free): the metered quantity is the count of deltas the author holds on the
// store — their true grow-only FOOTPRINT. Grow-only honesty applies — a negation is itself a
// delta and counts, so the footprint is MONOTONIC: nothing an author writes ever shrinks it
// (retracting one's own claim spends another delta, it does not reclaim one). The only thing that
// lowers an author's footprint is an operator ERASURE (§11), which actually removes a delta from
// the ground. The whole ledger of who was budgeted what, when, is a query like any other.
//
// Lawful reads apply, exactly as trust: in a governed store only the OPERATOR's declarations
// bind — a federated stranger cannot meter someone else's author, nor raise their own quota — and
// an UNGOVERNED store meters no one (no operator, no lawful voice to set a budget with).
// Revocation is one negation: strike the declaration and the author is unmetered again on the
// next request; a fresh declaration for the same author supersedes (latest lawful wins).

import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";

export const BUDGET_ENTITY = "loam:budget";
export const CTX_BUDGET = "loam.budget";

// One declaration: the metered author (a `subject` primitive, echoing a grant's subject) and the
// volume ceiling (a single `maxAppends` primitive — the count of deltas the author may hold).
// Operator-signed; a fresh declaration for the same subject supersedes by timestamp.
export function budgetClaims(
  subject: string,
  maxAppends: number,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
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

// Is this delta a budget declaration, and if so, is it WELL-FORMED law? A declaration carries
// exactly one string `subject` and exactly one `maxAppends` that is a non-negative integer.
// The DOOR refuses malformed declarations at append (wired into authorize), so nothing can sit
// at `loam:budget` looking like a quota while metering nothing — door and lens read one ground.
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
  const ceilings = claims.pointers.filter((p) => p.role === "maxAppends");
  if (
    ceilings.length !== 1 ||
    ceilings[0]!.target.kind !== "primitive" ||
    typeof ceilings[0]!.target.value !== "number" ||
    !Number.isInteger(ceilings[0]!.target.value) ||
    ceilings[0]!.target.value < 0
  ) {
    return "a budget declaration carries exactly one maxAppends: a non-negative integer";
  }
  return undefined;
}

// The per-author volume ceilings in force: for each metered author, the maximum count of
// surviving deltas the operator will let them hold. Governed stores only — an ungoverned store
// returns the empty map, always (no operator, no lawful voice). The latest surviving lawful
// declaration per subject wins (timestamp, id as tiebreak); a subject with no declaration is
// absent from the map and therefore unmetered. The harvest mirrors readTrustPolicy: malformed
// declarations are refused at APPEND (`budgetDefect`), so on any store whose law arrived through
// the door, door and this reader cannot disagree.
export function readBudgetPolicy(reactor: Reactor, operator?: string): ReadonlyMap<string, number> {
  const budgets = new Map<string, number>();
  if (operator === undefined) return budgets;
  const negated = lawfulNegated(reactor, operator);
  const latest = new Map<string, { max: number; timestamp: number; id: string }>();
  for (const delta of lawfulSnapshot(reactor, operator)) {
    const declares = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === BUDGET_ENTITY &&
        p.target.entity.context === CTX_BUDGET,
    );
    if (!declares || negated(delta.id)) continue;

    let subject: string | undefined;
    let max: number | undefined;
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
        max = p.target.value;
      }
    }
    // The same shape the door enforces (budgetDefect): a declaration missing either half reads
    // exactly as the law says — as no budget at all.
    if (subject === undefined || max === undefined) continue;

    const current = latest.get(subject);
    if (
      current === undefined ||
      delta.claims.timestamp > current.timestamp ||
      (delta.claims.timestamp === current.timestamp && delta.id > current.id)
    ) {
      latest.set(subject, { max, timestamp: delta.claims.timestamp, id: delta.id });
    }
  }
  for (const [subject, { max }] of latest) budgets.set(subject, max);
  return budgets;
}

// How many deltas this author holds on the store — the metered footprint. `snapshot()` is the
// whole set the store holds (negation is applied at read time, not here), so this counts every
// delta the author has written, negated or not: the honest grow-only cost. It falls only when an
// operator erasure (§11) removes a delta from the ground and the reactor is rebuilt.
function countHeldBy(reactor: Reactor, author: string): number {
  let held = 0;
  for (const d of reactor.snapshot()) if (d.claims.author === author) held += 1;
  return held;
}

// The append door's budget verdict for a whole batch (SPEC §25). For each metered author with
// NEW deltas in this batch — deltas not already held, since a re-send is idempotent under union
// and adds no volume — the author's held count plus those additions must not exceed the
// operator's ceiling. An author with no budget is unmetered (returns nothing); the operator is
// never metered (they set the budgets). Reads the state as it stands BEFORE the batch, exactly
// like `authorize`. Returns a refusal string when some author would exceed their quota, else
// undefined; a metered batch is refused whole, as every batch here is.
export function budgetRefusal(
  reactor: Reactor,
  operator: string,
  batch: readonly Delta[],
): string | undefined {
  const budgets = readBudgetPolicy(reactor, operator);
  if (budgets.size === 0) return undefined;
  const additions = new Map<string, number>();
  for (const d of batch) {
    const author = d.claims.author;
    if (author === operator || !budgets.has(author)) continue;
    if (reactor.get(d.id) !== undefined) continue; // already held: union dedups, no new volume
    additions.set(author, (additions.get(author) ?? 0) + 1);
  }
  for (const [author, added] of additions) {
    const quota = budgets.get(author)!;
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
