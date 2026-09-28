// A recovered user's history, cut per store (refactor/audit/recovery-history.md; ruling 8, M1).
//
// K1 may be stolen, and a thief can sign any timestamp, so "before the recovery" is each store's own
// fact: where in ITS arrival order the recovery happened. Three kinds of operator-signed record carry
// that fact, all filed at `loam:recoveries`:
//   - an INCARNATION marker: which incarnation of this store it is. A store writes its own before it
//     admits anything else; the active one is the lowest-arrival marker held, so a replayed older
//     marker never displaces it.
//   - a CUT: where in this store's arrival order a recovery begins, naming the incarnation, the
//     recovery record and the retired key. Its own arrival is the line: what the key signed and this
//     store admitted before the cut is history. It counts only in the incarnation it names.
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
}
export const cutClaims = (spec: CutSpec, operator: string, t: number): Claims =>
  claims(
    CTX_CUT,
    [
      prim("store", spec.store),
      prim("attempt", spec.attempt),
      prim("recovery", spec.recovery),
      prim("key", spec.key),
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

// Every verified operator record of `context` held here and not erased. Negations and validity are
// not asked: these are durable facts about this store, and the erase door keeps them. An erased
// record is gone to every reader at once, though its bytes wait for the purge. `erased` is this
// store's refused set (erase.ts `refusedIds`), passed in because erase.ts imports this module.
function held(
  reactor: Reactor,
  operator: string,
  context: string,
  erased: ReadonlySet<string>,
): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(RECOVERIES)) {
    const d = reactor.get(id);
    if (d === undefined || erased.has(id) || d.claims.author !== operator || !verified(d)) continue;
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
  erased: ReadonlySet<string>,
): Delta | undefined {
  if (operator === undefined) return undefined;
  let best: { d: Delta; at: number } | undefined;
  for (const d of held(reactor, operator, CTX_INCARNATION, erased)) {
    const at = arrivalIndex(reactor, d.id);
    if (field(d, "incarnation") === undefined || at === undefined) continue;
    if (best === undefined || at < best.at) best = { d, at };
  }
  return best?.d;
}

/** This store's incarnation id: what a cut written here names as its `store`. */
export function incarnationId(
  reactor: Reactor,
  operator: string | undefined,
  erased: ReadonlySet<string>,
): string | undefined {
  const d = activeIncarnation(reactor, operator, erased);
  return d === undefined ? undefined : field(d, "incarnation");
}

/** The outcomes held here for `cut`, as written (none, one, or contradictory). */
export function outcomesOf(
  reactor: Reactor,
  operator: string,
  cut: string,
  erased: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    held(reactor, operator, CTX_CUT_OUTCOME, erased)
      .filter((o) => field(o, "cut") === cut)
      .map((o) => field(o, "outcome") ?? ""),
  );
}

/**
 * Does this store hold a live cut for `recovery` retiring `key`: one naming this incarnation,
 * and not aborted? What a retiring recovery needs in every store before it
 * commits.
 */
export function holdsLiveCut(
  reactor: Reactor,
  operator: string,
  recovery: string,
  key: string,
  erased: ReadonlySet<string>,
): boolean {
  return cutsHere(reactor, operator, erased).some(
    (c) => c.recovery === recovery && c.key === key && c.state !== "aborted",
  );
}

export type CutState = "prepared" | "committed" | "aborted";

/** The state of `cut` in its store: its outcome if one stands, else whether the host committed. */
export function cutState(
  reactor: Reactor,
  operator: string,
  cut: Delta,
  erased: ReadonlySet<string>,
): CutState {
  const outcomes = new Set<string>();
  for (const o of held(reactor, operator, CTX_CUT_OUTCOME, erased)) {
    if (field(o, "cut") === cut.id) outcomes.add(field(o, "outcome") ?? "");
  }
  if (outcomes.size > 1) return "prepared"; // contradictory outcomes: fail closed
  const [only] = outcomes;
  if (only === "aborted") return only;
  // A cut that arrived after its record, in the store that holds both, came too late to draw the
  // line: whatever the key wrote between them would count. It never commits, whatever an outcome says.
  const recovery = field(cut, "recovery");
  const users = userGroundOf(reactor);
  const record = recovery === undefined ? undefined : users.reactor.get(recovery);
  if (record !== undefined && users.reactor === reactor) {
    const [r, c] = [arrivalIndex(reactor, record.id), arrivalIndex(reactor, cut.id)];
    if (r !== undefined && c !== undefined && r < c) return "prepared";
  }
  if (only === "committed") return only;
  if (only !== undefined) return "prepared";
  // No outcome yet: committed only if the host holds the recovery record, verified and unerased.
  return record !== undefined && verified(record) && !users.erased().has(record.id)
    ? "committed"
    : "prepared";
}

export interface Cut {
  readonly delta: Delta;
  readonly recovery: string;
  readonly key: string;
  /** Its own place in this store's arrival log: the line history stops at. */
  readonly index: number;
  readonly state: CutState;
}

/** The cuts that count in THIS store: those naming its active incarnation, with their state. */
export function cutsHere(
  reactor: Reactor,
  operator: string | undefined,
  erased: ReadonlySet<string>,
): Cut[] {
  if (operator === undefined) return [];
  const incarnation = activeIncarnation(reactor, operator, erased);
  const here = incarnation === undefined ? undefined : field(incarnation, "incarnation");
  if (here === undefined) return [];
  const out: Cut[] = [];
  for (const d of held(reactor, operator, CTX_CUT, erased)) {
    const [store, recovery, key] = ["store", "recovery", "key"].map((r) => field(d, r));
    if (store !== here || recovery === undefined || key === undefined) continue;
    out.push({
      delta: d,
      recovery,
      key,
      index: arrivalIndex(reactor, d.id)!,
      state: cutState(reactor, operator, d, erased),
    });
  }
  return out;
}

/** The keys a PREPARED cut pauses here: the door refuses what they sign until an outcome lands. */
export function pausedKeys(
  reactor: Reactor,
  operator: string | undefined,
  erased: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    cutsHere(reactor, operator, erased)
      .filter((c) => c.state === "prepared")
      .map((c) => c.key),
  );
}

/**
 * The deltas `key` signed in this store before `recovery` retired it: those that arrived before the
 * committed cut. Empty when no committed cut for that recovery and key counts here, and when any
 * cut for them is still prepared. Several committed cuts give the earliest.
 */
export function historyBefore(
  reactor: Reactor,
  operator: string | undefined,
  recovery: string,
  key: string,
  erased: ReadonlySet<string>,
): string[] {
  const cuts = cutsHere(reactor, operator, erased).filter(
    (c) => c.recovery === recovery && c.key === key && c.state !== "aborted",
  );
  if (cuts.length === 0 || cuts.some((c) => c.state !== "committed")) return [];
  const end = Math.min(...cuts.map((c) => c.index));
  const log = reactor.arrivalLog();
  const out: string[] = [];
  for (let i = 0; i < end; i += 1) {
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
  erased: ReadonlySet<string>,
  erasedInBatch: ReadonlySet<string>,
): string | undefined {
  if (operator === undefined || target.claims.author !== operator) return undefined;
  if (inContext(target, CTX_INCARNATION)) {
    return activeIncarnation(reactor, operator, erased)?.id === target.id
      ? "this store's active incarnation marker cannot be erased"
      : undefined;
  }
  if (inContext(target, CTX_CUT)) {
    // A cut naming another incarnation counts for nothing here, so nothing here depends on it.
    const here = activeIncarnation(reactor, operator, erased);
    if (here === undefined || field(target, "store") !== field(here, "incarnation"))
      return undefined;
    if (cutState(reactor, operator, target, erased) === "prepared") {
      return "a prepared recovery cut cannot be erased while the host may still commit";
    }
    const outcome = held(reactor, operator, CTX_CUT_OUTCOME, erased).find(
      (o) => field(o, "cut") === target.id && !erasedInBatch.has(o.id),
    );
    return outcome === undefined
      ? undefined
      : "a recovery cut and its outcome are erased together, not one alone";
  }
  if (inContext(target, CTX_CUT_OUTCOME)) {
    const cut = field(target, "cut");
    return cut !== undefined &&
      reactor.get(cut) !== undefined &&
      !erased.has(cut) &&
      !erasedInBatch.has(cut)
      ? "a recovery cut and its outcome are erased together, not one alone"
      : undefined;
  }
  return undefined;
}

/**
 * Does this store cover `recovery` retiring `key`: a live cut held here, or a FRESH one in `batch`
 * naming this incarnation? A cut in the batch that is already held is judged as held.
 */
export function coversRecovery(
  reactor: Reactor,
  operator: string,
  batch: readonly Delta[],
  recovery: string,
  key: string,
  erased: ReadonlySet<string>,
): boolean {
  if (holdsLiveCut(reactor, operator, recovery, key, erased)) return true;
  const here = incarnationId(reactor, operator, erased);
  return batch.some(
    (d) =>
      reactor.get(d.id) === undefined &&
      d.claims.author === operator &&
      inContext(d, CTX_CUT) &&
      field(d, "store") === here &&
      field(d, "recovery") === recovery &&
      field(d, "key") === key,
  );
}

/**
 * Why `batch` is refused for a cut in it, or undefined. A cut for this store must arrive before its
 * recovery record: a cut written once the record is held here, or in the ground this store reads
 * users from, would count what the retired key wrote in between.
 */
export function lateCutDefect(
  reactor: Reactor,
  operator: string | undefined,
  batch: readonly Delta[],
  erased: ReadonlySet<string>,
): string | undefined {
  if (operator === undefined) return undefined;
  const here = incarnationId(reactor, operator, erased);
  const users = userGroundOf(reactor).reactor;
  for (const d of batch) {
    if (reactor.get(d.id) !== undefined || d.claims.author !== operator) continue;
    if (!inContext(d, CTX_CUT) || field(d, "store") !== here) continue;
    const recovery = field(d, "recovery");
    if (recovery !== undefined && users.get(recovery) !== undefined) {
      return `a recovery cut must arrive before its record, and ${recovery} is already held here`;
    }
  }
  return undefined;
}

/** Is `d` a cut naming this store's incarnation? Only this store's own append may write one. */
export function cutForHere(
  reactor: Reactor,
  operator: string | undefined,
  d: Delta,
  erased: ReadonlySet<string>,
): boolean {
  return (
    operator !== undefined &&
    inContext(d, CTX_CUT) &&
    field(d, "store") === incarnationId(reactor, operator, erased)
  );
}
