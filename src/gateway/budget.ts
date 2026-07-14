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

// A resolved budget: the per-dimension ceilings in force for one author. v1 recognizes exactly one
// dimension — `maxAppends` (volume: the count of deltas the author may hold). The shape is
// EXTENSIBLE by addition, never by migration: a future dimension (a rate window, a byte ceiling) is
// a new OPTIONAL field here and a new pointer role on the wire, so an old store tolerates and
// ignores a dimension it does not recognize while enforcing the ones it does. The whole feature is
// OPT-IN and OFF by default — an author with no surviving declaration has no policy and is
// unmetered; there is no global cap, so nothing is limited until an operator names an author here.
export interface BudgetPolicy {
  readonly maxAppends?: number; // volume ceiling; future dimensions join here (maxRate?, maxBytes?)
}

// One declaration: the metered author (a `subject` primitive, echoing a grant's subject) and one or
// more limit dimensions — v1 emits `maxAppends` (the count of deltas the author may hold).
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

// Is this delta a budget declaration, and if so, is it WELL-FORMED law? A declaration names exactly
// one string `subject` and carries at least one limit dimension; the dimensions this store knows
// (v1: `maxAppends`, a non-negative integer) must be well-formed, and any it does NOT know are a
// newer store's limits — tolerated, not rejected. The DOOR refuses malformed declarations at append
// (wired into authorize), so nothing sits at `loam:budget` looking like a quota it cannot honor.
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
  // Dimensions are every pointer that is not the `declares` anchor or the `subject`. A declaration
  // must carry at least one (an empty budget is a mistake, not a silent no-op), and each dimension
  // this store RECOGNIZES must be well-formed. A dimension it does NOT recognize is a newer store's
  // limit — tolerated and ignored, never rejected — so the vocabulary grows without a migration.
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

// The per-author budgets in force: for each metered author, the ceilings the operator set — v1,
// their `maxAppends` volume cap. Governed stores only (an ungoverned store returns the empty map,
// always). The latest surviving lawful declaration per subject wins (timestamp, id as tiebreak); a
// subject with no declaration is absent and therefore unmetered. Only subjects whose latest
// declaration carries a dimension THIS store recognizes are surfaced — a declaration bearing only a
// newer store's limit leaves the subject unmetered here, the honest forward-compatible reading.
// Mirrors readTrustPolicy; malformed declarations are refused at APPEND (`budgetDefect`), so door
// and reader cannot disagree on any store whose law arrived through the door.
export function readBudgetPolicy(
  reactor: Reactor,
  operator?: string,
): ReadonlyMap<string, BudgetPolicy> {
  const budgets = new Map<string, BudgetPolicy>();
  if (operator === undefined) return budgets;
  const negated = lawfulNegated(reactor, operator);
  const latest = new Map<string, { policy: BudgetPolicy; timestamp: number; id: string }>();
  for (const delta of lawfulSnapshot(reactor, operator)) {
    const declares = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === BUDGET_ENTITY &&
        p.target.entity.context === CTX_BUDGET,
    );
    if (!declares || negated(delta.id)) continue;

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
    if (subject === undefined) continue; // no subject binds nothing (the door refuses it anyway)

    const current = latest.get(subject);
    if (
      current === undefined ||
      delta.claims.timestamp > current.timestamp ||
      (delta.claims.timestamp === current.timestamp && delta.id > current.id)
    ) {
      latest.set(subject, { policy, timestamp: delta.claims.timestamp, id: delta.id });
    }
  }
  // Surface only what this store can meter: a latest declaration whose every dimension is
  // unrecognized (a newer store's limit) leaves its subject unmetered here.
  for (const [subject, { policy }] of latest) {
    if (policy.maxAppends !== undefined) budgets.set(subject, policy);
  }
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
    const quota = budgets.get(author)!.maxAppends!; // in the map ⇒ this dimension is set
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
