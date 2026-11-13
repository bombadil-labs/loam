import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import { RECOVERIES, userGroundOf, usersGovernor, verified } from "./user-root.js";
import type { Ground } from "./ground.js";

export const CTX_INCARNATION = "loam.incarnation";
export const CTX_CUT = "loam.cut";
export const CTX_CUT_OUTCOME = "loam.cutoutcome";
export const CTX_CUT_MANIFEST = "loam.cutmanifest";

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

export const manifestClaims = (
  recovery: string,
  cuts: readonly string[],
  operator: string,
  t: number,
): Claims =>
  claims(
    CTX_CUT_MANIFEST,
    [prim("recovery", recovery), ...[...new Set(cuts)].sort().map((c) => prim("cut", c))],
    operator,
    t,
  );

export type Outcome = "committed" | "aborted";
export const outcomeClaims = (cut: string, outcome: Outcome, operator: string, t: number): Claims =>
  claims(CTX_CUT_OUTCOME, [prim("cut", cut), prim("outcome", outcome)], operator, t);

export function isStoreLocal(d: Delta): boolean {
  return [CTX_INCARNATION, CTX_CUT, CTX_CUT_OUTCOME, CTX_CUT_MANIFEST].some((c) => inContext(d, c));
}

function field(d: Delta, role: string): string | undefined {
  const ps = d.claims.pointers.filter((p) => p.role === role);
  if (ps.length !== 1) return undefined;
  const t = ps[0]!.target;
  return t.kind === "primitive" && typeof t.value === "string" ? t.value : undefined;
}
const fields = (d: Delta, role: string): string[] =>
  d.claims.pointers.flatMap((p) =>
    p.role === role && p.target.kind === "primitive" && typeof p.target.value === "string"
      ? [p.target.value]
      : [],
  );
const inContext = (d: Delta, context: string): boolean =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === RECOVERIES &&
      p.target.entity.context === context,
  );

function held(
  reactor: Ground,
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

export function incarnationId(
  reactor: Reactor,
  operator: string | undefined,
  erased: ReadonlySet<string>,
): string | undefined {
  const d = activeIncarnation(reactor, operator, erased);
  return d === undefined ? undefined : field(d, "incarnation");
}

export function outcomesOf(
  reactor: Ground,
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
  if (outcomes.size > 1) return "prepared";
  const [only] = outcomes;
  if (only === "aborted") return only;
  const recovery = field(cut, "recovery");
  const users = userGroundOf(reactor);
  const record = recovery === undefined ? undefined : users.reactor.get(recovery);
  if (record !== undefined && users.reactor === reactor) {
    const [r, c] = [arrivalIndex(reactor, record.id), arrivalIndex(reactor, cut.id)];
    if (r !== undefined && c !== undefined && r < c) return "prepared";
  }
  if (recovery === undefined || !manifested(reactor, operator, cut.id, recovery)) return "prepared";
  if (only === "committed") return only;
  if (only !== undefined) return "prepared";
  return record !== undefined && verified(record) && !users.erased().has(record.id)
    ? "committed"
    : "prepared";
}

function manifested(reactor: Reactor, operator: string, cut: string, recovery: string): boolean {
  const users = userGroundOf(reactor);
  const erased = users.erased();
  const record = users.reactor.get(recovery);
  const recordAt =
    record === undefined || erased.has(recovery)
      ? undefined
      : arrivalIndex(users.reactor, recovery);
  for (const id of users.reactor.byTarget(RECOVERIES)) {
    if (erased.has(id)) continue;
    const m = users.reactor.get(id);
    if (m === undefined || m.claims.author !== usersGovernor(users, operator) || !verified(m)) {
      continue;
    }
    if (!inContext(m, CTX_CUT_MANIFEST) || field(m, "recovery") !== recovery) continue;
    if (!fields(m, "cut").includes(cut)) continue;
    const at = arrivalIndex(users.reactor, id);
    if (recordAt !== undefined && (at === undefined || at > recordAt)) continue;
    return true;
  }
  return false;
}

export interface Cut {
  readonly delta: Delta;
  readonly recovery: string;
  readonly key: string;
  readonly index: number;
  readonly state: CutState;
}

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
  if (inContext(target, CTX_CUT_MANIFEST)) {
    const standing = fields(target, "cut").filter(
      (id) => reactor.get(id) !== undefined && !erased.has(id) && !erasedInBatch.has(id),
    );
    return standing.length > 0
      ? "a cut manifest is kept while a cut it names stands here: erase the cut and its outcome first"
      : undefined;
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

export function liveCutIds(
  reactor: Reactor,
  operator: string,
  batch: readonly Delta[],
  recovery: string,
  key: string,
  erased: ReadonlySet<string>,
): Set<string> {
  const here = incarnationId(reactor, operator, erased);
  const ours = (d: Delta): boolean =>
    d.claims.author === operator &&
    inContext(d, CTX_CUT) &&
    field(d, "store") === here &&
    field(d, "recovery") === recovery &&
    field(d, "key") === key;
  return new Set([
    ...held(reactor, operator, CTX_CUT, erased)
      .filter((d) => ours(d) && cutState(reactor, operator, d, erased) !== "aborted")
      .map((d) => d.id),
    ...batch.filter((d) => reactor.get(d.id) === undefined && ours(d)).map((d) => d.id),
  ]);
}

export const isCutManifest = (d: Delta): boolean => inContext(d, CTX_CUT_MANIFEST);

export function manifestsFor(
  reactor: Ground,
  operator: string,
  record: Delta,
  erased: ReadonlySet<string>,
): ReadonlySet<string>[] {
  return held(reactor, operator, CTX_CUT_MANIFEST, erased)
    .filter((d) => field(d, "recovery") === record.id)
    .map((m) => new Set(fields(m, "cut")));
}

export function manifestDefect(
  reactor: Ground,
  operator: string | undefined,
  batch: readonly Delta[],
  heldElsewhere: (id: string) => boolean,
): string | undefined {
  if (operator === undefined) return undefined;
  const here = new Set(batch.map((d) => d.id));
  for (const d of batch) {
    if (reactor.get(d.id) !== undefined || d.claims.author !== operator) continue;
    if (!inContext(d, CTX_CUT_MANIFEST)) continue;
    const later = fields(d, "cut").filter(
      (id) => reactor.get(id) === undefined && !here.has(id) && !heldElsewhere(id),
    );
    if (later.length > 0) {
      return `a cut manifest names ${later.join(", ")}, which is neither held nor in its append`;
    }
    if (here.has(field(d, "recovery") ?? "")) {
      return `a cut manifest and its recovery record are written in separate appends, the manifest first`;
    }
  }
  return undefined;
}

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
