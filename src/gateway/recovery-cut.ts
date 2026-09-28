// A recovered user's history, cut per store (refactor/audit/recovery-history.md; ruling 8, M1).
//
// K1 may be stolen, and a thief can sign any timestamp, so "before the recovery" is each store's own
// fact: where in ITS arrival order the recovery happened. Three kinds of operator-signed record carry
// that fact, all filed at `loam:recoveries`:
//   - an INCARNATION marker: which incarnation of this store it is. A store writes its own before it
//     admits anything else; the active one is the lowest-arrival marker held, so a replayed older
//     marker never displaces it.
//   - a CUT: this store's arrival length just before a recovery, naming the incarnation, the recovery
//     record and the retired key. It counts only in the incarnation it names.
//   - an OUTCOME: the cut's terminal state, committed or aborted.
// A cut with no outcome is COMMITTED if the host holds its recovery record, else PREPARED: the store
// pauses the retired key and shows no history for it. That fails closed.
//
// "Operator" here means the governing key of the peer that holds this store (user-identity.md).
// Today inbox pools share the host's key; after step 6 each pool signs its own.

import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import { RECOVERIES, userGroundOf, verified } from "./user-root.js";

export const CTX_INCARNATION = "loam.incarnation";
export const CTX_CUT = "loam.cut";
export const CTX_CUT_OUTCOME = "loam.cutoutcome";

const prim = (role: string, value: string) =>
  ({ role, target: { kind: "primitive", value } }) as const;
const filed = (context: string) =>
  ({ role: "index", target: { kind: "entity", entity: { id: RECOVERIES, context } } }) as const;

const claims = (
  context: string,
  pointers: Claims["pointers"],
  author: string,
  t: number,
): Claims => ({
  timestamp: t,
  validFrom: t,
  author,
  pointers: [filed(context), ...pointers],
});

/** A fresh incarnation id: random, so a re-created store never shares one. */
export const mintIncarnation = (): string =>
  [...globalThis.crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const incarnationClaims = (id: string, operator: string, t: number): Claims =>
  claims(CTX_INCARNATION, [prim("incarnation", id)], operator, t);

export interface CutSpec {
  readonly store: string;
  readonly attempt: string;
  readonly recovery: string;
  readonly key: string;
  readonly index: number;
}
export const cutClaims = (spec: CutSpec, operator: string, t: number): Claims =>
  claims(
    CTX_CUT,
    [
      prim("store", spec.store),
      prim("attempt", spec.attempt),
      prim("recovery", spec.recovery),
      prim("key", spec.key),
      // Named `position`: the filing pointer already uses the role `index`.
      prim("position", String(spec.index)),
    ],
    operator,
    t,
  );

export type Outcome = "committed" | "aborted";
export const outcomeClaims = (cut: string, outcome: Outcome, operator: string, t: number): Claims =>
  claims(CTX_CUT_OUTCOME, [prim("cut", cut), prim("outcome", outcome)], operator, t);

/**
 * Is `d` one of this module's store-local records (an incarnation marker, a cut, an outcome)? Each is
 * a fact about one store; a copy anywhere else is testimony, so none is offered to a peer.
 */
export function isStoreLocal(d: Delta): boolean {
  return [CTX_INCARNATION, CTX_CUT, CTX_CUT_OUTCOME].some((c) => inContext(d, c));
}

// The one primitive value `role` carries, or undefined.
function field(d: Delta, role: string): string | undefined {
  const ps = d.claims.pointers.filter((p) => p.role === role);
  if (ps.length !== 1) return undefined;
  const t = ps[0]!.target;
  return t.kind === "primitive" && typeof t.value === "string" ? t.value : undefined;
}
const inContext = (d: Delta, context: string): boolean =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === RECOVERIES &&
      p.target.entity.context === context,
  );

// Every verified operator record of `context` held here. Negations and validity are not asked:
// these are durable facts about this store, and the erase door keeps them.
function held(reactor: Reactor, operator: string, context: string): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(RECOVERIES)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || !verified(d)) continue;
    if (inContext(d, context)) out.push(d);
  }
  return out;
}

// A delta's position in this store's arrival log, kept incrementally per reactor.
const positions = new WeakMap<Reactor, { n: number; at: Map<string, number> }>();
export function arrivalIndex(reactor: Reactor, id: string): number | undefined {
  const log = reactor.arrivalLog();
  let cache = positions.get(reactor);
  if (cache === undefined) {
    cache = { n: 0, at: new Map() };
    positions.set(reactor, cache);
  }
  for (; cache.n < log.length; cache.n += 1) cache.at.set(log[cache.n]!.id, cache.n);
  return cache.at.get(id);
}

/** This store's active incarnation: the lowest-arrival verified operator marker it holds. */
export function activeIncarnation(
  reactor: Reactor,
  operator: string | undefined,
): Delta | undefined {
  if (operator === undefined) return undefined;
  let best: { d: Delta; at: number } | undefined;
  for (const d of held(reactor, operator, CTX_INCARNATION)) {
    const at = arrivalIndex(reactor, d.id);
    if (field(d, "incarnation") === undefined || at === undefined) continue;
    if (best === undefined || at < best.at) best = { d, at };
  }
  return best?.d;
}

export type CutState = "prepared" | "committed" | "aborted";

/** The state of `cut` in its store: its outcome if one stands, else whether the host committed. */
export function cutState(reactor: Reactor, operator: string, cut: Delta): CutState {
  const outcomes = new Set<string>();
  for (const o of held(reactor, operator, CTX_CUT_OUTCOME)) {
    if (field(o, "cut") === cut.id) outcomes.add(field(o, "outcome") ?? "");
  }
  if (outcomes.size > 1) return "prepared"; // contradictory outcomes: fail closed
  const [only] = outcomes;
  if (only === "committed" || only === "aborted") return only;
  if (only !== undefined) return "prepared";
  // No outcome yet: committed only if the host holds the recovery record, verified and unerased.
  const recovery = field(cut, "recovery");
  const users = userGroundOf(reactor);
  const record = recovery === undefined ? undefined : users.reactor.get(recovery);
  return record !== undefined && verified(record) && !users.erased().has(record.id)
    ? "committed"
    : "prepared";
}

export interface Cut {
  readonly delta: Delta;
  readonly recovery: string;
  readonly key: string;
  readonly index: number;
  readonly state: CutState;
}

/** The cuts that count in THIS store: those naming its active incarnation, with their state. */
export function cutsHere(reactor: Reactor, operator: string | undefined): Cut[] {
  if (operator === undefined) return [];
  const incarnation = activeIncarnation(reactor, operator);
  const here = incarnation === undefined ? undefined : field(incarnation, "incarnation");
  if (here === undefined) return [];
  const out: Cut[] = [];
  for (const d of held(reactor, operator, CTX_CUT)) {
    const [store, recovery, key, index] = ["store", "recovery", "key", "position"].map((r) =>
      field(d, r),
    );
    const n = index === undefined ? NaN : Number(index);
    if (store !== here || recovery === undefined || key === undefined || !Number.isInteger(n)) {
      continue;
    }
    out.push({ delta: d, recovery, key, index: n, state: cutState(reactor, operator, d) });
  }
  return out;
}

/** The keys a PREPARED cut pauses here: the door refuses what they sign until an outcome lands. */
export function pausedKeys(reactor: Reactor, operator: string | undefined): ReadonlySet<string> {
  return new Set(
    cutsHere(reactor, operator)
      .filter((c) => c.state === "prepared")
      .map((c) => c.key),
  );
}

/**
 * The deltas `key` signed in this store before `recovery` retired it: arrival index below the
 * committed cut's index. Empty when no committed cut for that recovery and key counts here.
 */
export function historyBefore(
  reactor: Reactor,
  operator: string | undefined,
  recovery: string,
  key: string,
): string[] {
  const cut = cutsHere(reactor, operator).find(
    (c) => c.recovery === recovery && c.key === key && c.state === "committed",
  );
  if (cut === undefined) return [];
  const log = reactor.arrivalLog();
  const out: string[] = [];
  for (let i = 0; i < Math.min(cut.index, log.length); i += 1) {
    if (log[i]!.claims.author === key) out.push(log[i]!.id);
  }
  return out;
}

/**
 * Why erasing `target` is refused, or undefined. The active incarnation marker, a PREPARED cut, and a
 * cut or outcome whose partner stands (unless the partner is erased in the same batch) are kept: each
 * is a durable fact the history reader or the pause depends on.
 */
export function cutErasureDefect(
  reactor: Reactor,
  operator: string | undefined,
  target: Delta,
  erasedInBatch: ReadonlySet<string> = new Set(),
): string | undefined {
  if (operator === undefined || target.claims.author !== operator) return undefined;
  if (inContext(target, CTX_INCARNATION)) {
    return activeIncarnation(reactor, operator)?.id === target.id
      ? "this store's active incarnation marker cannot be erased"
      : undefined;
  }
  if (inContext(target, CTX_CUT)) {
    if (cutState(reactor, operator, target) === "prepared") {
      return "a prepared recovery cut cannot be erased while the host may still commit";
    }
    const outcome = held(reactor, operator, CTX_CUT_OUTCOME).find(
      (o) => field(o, "cut") === target.id && !erasedInBatch.has(o.id),
    );
    return outcome === undefined
      ? undefined
      : "a recovery cut and its outcome are erased together, not one alone";
  }
  if (inContext(target, CTX_CUT_OUTCOME)) {
    const cut = field(target, "cut");
    return cut !== undefined && reactor.get(cut) !== undefined && !erasedInBatch.has(cut)
      ? "a recovery cut and its outcome are erased together, not one alone"
      : undefined;
  }
  return undefined;
}
