import {
  computeId,
  verifyDelta,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { declarationsOf } from "./ground-declarations.js";
import type { Ground } from "./ground.js";

export const CTX_USER = "loam.user";
export const CTX_ROLE = "loam.role";
export const CTX_ROOT = "loam.root";

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function userNameDefect(name: string): string | undefined {
  if (!NAME.test(name)) {
    return (
      `"${name}" is not a user name: use 1–64 characters of a–z, 0–9, dot, dash or underscore, ` +
      `starting with a letter or digit`
    );
  }
  return undefined;
}

export const USER_PREFIX = "user:";
export const userEntity = (name: string): string => `${USER_PREFIX}${name}`;

const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

const NONE: ReadonlySet<string> = new Set();

const verifiedCache = new WeakMap<Delta, { readonly id: string; readonly sig: string }>();
export function verified(d: Delta): boolean {
  const hit = verifiedCache.get(d);
  if (hit !== undefined && hit.id === d.id && hit.sig === d.sig && computeId(d.claims) === d.id) {
    return true;
  }
  if (verifyDelta(d) !== "verified") return false;
  verifiedCache.set(d, { id: d.id, sig: d.sig! });
  return true;
}

export const CTX_RECOVERY = "loam.recovery";
export const CTX_LINEAGE = "loam.lineage";
export const RECOVERIES = "loam:recoveries";

export interface RecoverySpec {
  readonly name: string;
  readonly previous?: string;
  readonly root: string;
  readonly attempt: string;
  readonly supersedes?: string;
  readonly retired: readonly string[];
}

const prim = (role: string, value: string) =>
  ({ role, target: { kind: "primitive", value } }) as const;
const filed = (name: string, context: string) => [
  { role: "user", target: { kind: "entity", entity: { id: userEntity(name), context } } } as const,
  { role: "index", target: { kind: "entity", entity: { id: RECOVERIES, context } } } as const,
];

export function recoveryClaims(spec: RecoverySpec, operator: string, t: number): Claims {
  return {
    timestamp: t,
    validFrom: t,
    author: operator,
    pointers: [
      ...filed(spec.name, CTX_RECOVERY),
      ...(spec.previous === undefined ? [] : [prim("previous", spec.previous)]),
      prim("root", spec.root),
      prim("attempt", spec.attempt),
      ...(spec.supersedes === undefined ? [] : [prim("supersedes", spec.supersedes)]),
      ...[...new Set(spec.retired)].sort().map((k) => prim("retired", k)),
    ],
  };
}

export function recordPrevious(d: Delta): string | undefined {
  return filedFor(d, CTX_RECOVERY) === undefined ? undefined : parse(d, "record")?.previous;
}

export function lineageClaims(
  spec: {
    readonly name: string;
    readonly recovery: string;
    readonly root: string;
    readonly retired: readonly string[];
  },
  operator: string,
  t: number,
): Claims {
  return {
    timestamp: t,
    validFrom: t,
    author: operator,
    pointers: [
      ...filed(spec.name, CTX_LINEAGE),
      prim("recovery", spec.recovery),
      prim("root", spec.root),
      ...[...new Set(spec.retired)].sort().map((k) => prim("retired", k)),
    ],
  };
}

interface Parsed {
  readonly id: string;
  readonly previous?: string;
  readonly root: string;
  readonly supersedes?: string;
  readonly recovery?: string;
  readonly retired: readonly string[];
}

function filedFor(d: Delta, context: string): string | undefined {
  let user: string | undefined;
  let users = 0;
  let index = 0;
  for (const p of d.claims.pointers) {
    if (p.target.kind !== "entity") continue;
    const { id, context: c } = p.target.entity;
    if (id === RECOVERIES && c === context) index += 1;
    else if (id.startsWith(USER_PREFIX) && c === context) {
      users += 1;
      user = id.slice(USER_PREFIX.length);
    }
  }
  return users === 1 && index === 1 ? user : undefined;
}

function heldAt(
  reactor: Ground,
  operator: string,
  name: string,
  context: string,
  erased: ReadonlySet<string>,
  cut: number,
): Delta[] {
  const out: Delta[] = [];
  for (const id of reactor.byTarget(userEntity(name))) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || d.claims.timestamp > cut) continue;
    if (filedFor(d, context) === name && verified(d)) out.push(d);
  }
  return out;
}

function namedKeys(d: Delta): string[] {
  return d.claims.pointers.flatMap((p) =>
    p.target.kind === "primitive" &&
    typeof p.target.value === "string" &&
    AUTHOR.test(p.target.value)
      ? [p.target.value]
      : [],
  );
}

function parse(d: Delta, kind: "record" | "lineage"): Parsed | undefined {
  const one = new Map<string, string>();
  const retired: string[] = [];
  const allowed =
    kind === "record" ? ["previous", "root", "attempt", "supersedes"] : ["recovery", "root"];
  for (const p of d.claims.pointers) {
    if (p.target.kind === "entity") continue;
    if (p.target.kind !== "primitive" || typeof p.target.value !== "string") return undefined;
    if (p.role === "retired") {
      if (!AUTHOR.test(p.target.value) || retired.includes(p.target.value)) return undefined;
      retired.push(p.target.value);
      continue;
    }
    if (!allowed.includes(p.role) || one.has(p.role)) return undefined;
    one.set(p.role, p.target.value);
  }
  const root = one.get("root");
  if (root === undefined || !AUTHOR.test(root)) return undefined;
  const previous = one.get("previous");
  if (previous !== undefined && !AUTHOR.test(previous)) return undefined;
  if (kind === "record" && one.get("attempt") === undefined) return undefined;
  if (kind === "lineage" && one.get("recovery") === undefined) return undefined;
  return {
    id: d.id,
    ...(previous === undefined ? {} : { previous }),
    root,
    ...(one.has("supersedes") ? { supersedes: one.get("supersedes")! } : {}),
    ...(one.has("recovery") ? { recovery: one.get("recovery")! } : {}),
    retired: [...retired].sort(),
  };
}

const sameSet = (a: readonly string[], b: Iterable<string>): boolean => {
  const bs = [...new Set(b)].sort();
  return a.length === bs.length && a.every((k, i) => k === bs[i]);
};

function expectedRetired(record: Parsed, predecessor: Parsed | undefined): Set<string> {
  const out = new Set(predecessor?.retired ?? []);
  if (record.previous !== undefined) out.add(record.previous);
  out.delete(record.root);
  return out;
}

export type RecoveryChain =
  | { readonly kind: "none" }
  | {
      readonly kind: "chain";
      readonly head: string;
      readonly root: string;
      readonly retired: ReadonlySet<string>;
    }
  | { readonly kind: "broken"; readonly implicated: ReadonlySet<string> };

export function recoveryChain(
  reactor: Ground,
  operator: string | undefined,
  name: string,
  erased: ReadonlySet<string> = NONE,
  cut = Infinity,
): RecoveryChain {
  if (operator === undefined) return { kind: "none" };
  const recordDeltas = heldAt(reactor, operator, name, CTX_RECOVERY, erased, cut);
  const lineageDeltas = heldAt(reactor, operator, name, CTX_LINEAGE, erased, cut);
  if (recordDeltas.length === 0 && lineageDeltas.length === 0) return { kind: "none" };
  const implicated = new Set<string>();
  for (const d of [...recordDeltas, ...lineageDeltas])
    for (const k of namedKeys(d)) implicated.add(k);
  const broken = { kind: "broken", implicated } as const;
  const records = recordDeltas.map((d) => parse(d, "record"));
  const lineages = lineageDeltas.map((d) => parse(d, "lineage"));
  if (records.some((r) => r === undefined) || lineages.some((l) => l === undefined)) return broken;
  const byId = new Map((records as Parsed[]).map((r) => [r.id, r]));
  const firsts = [...byId.values()].filter((r) => r.supersedes === undefined);
  const next = new Map<string, Parsed>();
  for (const r of byId.values()) {
    if (r.supersedes === undefined) continue;
    if (!byId.has(r.supersedes) || next.has(r.supersedes)) return broken;
    next.set(r.supersedes, r);
  }
  if (firsts.length !== 1) return broken;
  for (const r of byId.values()) {
    const pred = r.supersedes === undefined ? undefined : byId.get(r.supersedes);
    if (!sameSet(r.retired, expectedRetired(r, pred))) return broken;
  }
  for (const l of lineages as Parsed[]) {
    const r = byId.get(l.recovery!);
    if (r === undefined || r.root !== l.root || !sameSet(l.retired, r.retired)) return broken;
  }
  let head: Parsed = firsts[0]!;
  for (let after = next.get(head.id); after !== undefined; after = next.get(head.id)) head = after;
  return { kind: "chain", head: head.id, root: head.root, retired: new Set(head.retired) };
}

export function recoveryDefect(
  delta: Delta,
  reactor: Ground,
  operator: string | undefined,
  batch: readonly Delta[] = [],
  gone: () => ReadonlySet<string> = () => NONE,
): string | undefined {
  const touches = delta.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      (p.target.entity.context === CTX_RECOVERY || p.target.entity.context === CTX_LINEAGE),
  );
  if (!touches || operator === undefined || delta.claims.author !== operator) return undefined;
  const context = filedFor(delta, CTX_RECOVERY) !== undefined ? CTX_RECOVERY : CTX_LINEAGE;
  const name = filedFor(delta, context);
  if (name === undefined) {
    return "a recovery record or lineage claim is filed exactly once at its user and once at loam:recoveries, in one context";
  }
  const kind = context === CTX_RECOVERY ? "record" : "lineage";
  const parsed = parse(delta, kind);
  if (parsed === undefined) return `a malformed recovery ${kind}`;
  const heldRecord = (id: string): Parsed | undefined => {
    if (gone().has(id)) return undefined;
    const held = reactor.get(id);
    const d = held !== undefined && verified(held) ? held : batch.find((b) => b.id === id);
    return d !== undefined && d.claims.author === operator && filedFor(d, CTX_RECOVERY) === name
      ? parse(d, "record")
      : undefined;
  };
  if (kind === "record") {
    const pred = parsed.supersedes === undefined ? undefined : heldRecord(parsed.supersedes);
    if (parsed.supersedes !== undefined && pred === undefined) {
      return "a recovery record supersedes a record this store does not hold for that user";
    }
    if (!sameSet(parsed.retired, expectedRetired(parsed, pred))) {
      return "a recovery record's retired set must be its predecessor's, plus its previous root, minus its root";
    }
    return undefined;
  }
  const record = heldRecord(parsed.recovery!);
  if (record === undefined)
    return "a lineage claim names a recovery record this store does not hold";
  if (record.root !== parsed.root || !sameSet(parsed.retired, record.retired)) {
    return "a lineage claim must repeat its record's root and retired set";
  }
  return undefined;
}

export function retiredKeysOf(
  reactor: Ground,
  operator: string | undefined,
  erased: ReadonlySet<string> = NONE,
  cut = Infinity,
): ReadonlySet<string> {
  if (operator === undefined) return NONE;
  const names = new Set<string>();
  for (const id of reactor.byTarget(RECOVERIES)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || d.claims.timestamp > cut) continue;
    if (!verified(d)) continue;
    const name = filedFor(d, CTX_RECOVERY) ?? filedFor(d, CTX_LINEAGE);
    if (name !== undefined) names.add(name);
  }
  const out = new Set<string>();
  for (const name of names) {
    const chain = recoveryChain(reactor, operator, name, erased, cut);
    const keys =
      chain.kind === "chain" ? chain.retired : chain.kind === "broken" ? chain.implicated : NONE;
    for (const k of keys) out.add(k);
  }
  return out;
}

export function recoveredFrom(
  reactor: Ground,
  operator: string | undefined,
  root: string,
  erased: ReadonlySet<string> = NONE,
): string[] {
  if (operator === undefined) return [];
  const out = new Set<string>();
  for (const id of reactor.byTarget(RECOVERIES)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator) continue;
    const name = verified(d) ? filedFor(d, CTX_RECOVERY) : undefined;
    const r = name === undefined ? undefined : parse(d, "record");
    if (name === undefined || r === undefined || r.root !== root || r.previous === undefined)
      continue;
    if (recoveryChain(reactor, operator, name, erased).kind === "chain") out.add(r.previous);
  }
  return [...out];
}

export function recoveriesOf(
  reactor: Ground,
  operator: string | undefined,
  user: string,
  root: string,
  erased: ReadonlySet<string> = NONE,
): { readonly record: string; readonly previous: string }[] {
  if (operator === undefined) return [];
  const out: { record: string; previous: string }[] = [];
  for (const id of reactor.byTarget(RECOVERIES)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || !verified(d)) continue;
    const name = filedFor(d, CTX_RECOVERY);
    const r = name === undefined ? undefined : parse(d, "record");
    if (name !== user || r === undefined || r.root !== root || r.previous === undefined) {
      continue;
    }
    if (recoveryChain(reactor, operator, name, erased).kind === "chain") {
      out.push({ record: d.id, previous: r.previous });
    }
  }
  return out;
}

function standingRootClaim(
  reactor: Ground,
  now: number,
  operator: string,
  name: string,
  key: string,
  erased: ReadonlySet<string>,
  cut: number,
): boolean {
  const entity = userEntity(name);
  const negated = reactor.negationPredicate(
    now,
    (n) =>
      n.claims.author === operator && n.claims.timestamp <= cut && !erased.has(n.id) && verified(n),
  );
  for (const id of reactor.byTarget(entity)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || d.claims.timestamp > cut) continue;
    if (!verified(d)) continue;
    const { validFrom, validUntil } = d.claims;
    if (now < validFrom || (validUntil !== undefined && now >= validUntil)) continue;
    const filing = d.claims.pointers.filter(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === CTX_ROOT,
    );
    if (filing.length === 0) continue;
    const rest = d.claims.pointers.filter((p) => !filing.includes(p));
    if (
      rest.length !== 1 ||
      rest[0]!.target.kind !== "primitive" ||
      rest[0]!.target.value !== key
    ) {
      continue;
    }
    if (!negated(id)) return true;
  }
  return false;
}

export function chainRoot(
  reactor: Ground,
  now: number,
  operator: string | undefined,
  name: string,
  erased: ReadonlySet<string> = NONE,
  cut = Infinity,
): string | null | undefined {
  if (operator === undefined) return undefined;
  const chain = recoveryChain(reactor, operator, name, erased, cut);
  if (chain.kind === "none") return undefined;
  if (chain.kind === "broken") return null;
  return standingRootClaim(reactor, now, operator, name, chain.root, erased, cut)
    ? chain.root
    : null;
}

function latestValues(
  reactor: Ground,
  now: number,
  operator: string,
  name: string,
  erased: ReadonlySet<string>,
  cut: number,
): Map<string, unknown> {
  const entity = userEntity(name);
  const negated = reactor.negationPredicate(
    now,
    (n) =>
      n.claims.author === operator && n.claims.timestamp <= cut && !erased.has(n.id) && verified(n),
  );
  const best = new Map<string, { timestamp: number; id: string; value: unknown }>();
  for (const id of reactor.byTarget(entity)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || d.claims.timestamp > cut) continue;
    if (!verified(d)) continue;
    const { validFrom, validUntil } = d.claims;
    if (now < validFrom || (validUntil !== undefined && now >= validUntil)) continue;
    const filing = d.claims.pointers.filter(
      (p) => p.target.kind === "entity" && p.target.entity.id === entity,
    );
    const rest = d.claims.pointers.filter((p) => !filing.includes(p));
    const target = rest.length === 1 ? rest[0]!.target : undefined;
    const rendered =
      target?.kind === "primitive"
        ? target.value
        : target?.kind === "entity"
          ? target.entity.id
          : target?.kind === "delta"
            ? target.deltaRef.delta
            : undefined;
    for (const p of filing) {
      if (p.target.kind !== "entity") continue;
      const context = p.target.entity.context;
      if (context === undefined) continue;
      if (negated(id)) break;
      const t = d.claims.timestamp;
      const prior = best.get(context);
      if (
        prior !== undefined &&
        (t < prior.timestamp || (t === prior.timestamp && id > prior.id))
      ) {
        continue;
      }
      best.set(context, { timestamp: t, id, value: rendered });
    }
  }
  return new Map([...best].map(([context, b]) => [context, b.value]));
}

export function userRootAt(
  reactor: Ground,
  now: number,
  operator: string | undefined,
  name: string,
  erased: ReadonlySet<string> = NONE,
  cut = Infinity,
): string | undefined {
  if (operator === undefined) return undefined;
  const values = latestValues(reactor, now, operator, name, erased, cut);
  if (values.get(CTX_USER) !== name) return undefined;
  const fenced = chainRoot(reactor, now, operator, name, erased, cut);
  if (fenced !== undefined) return fenced ?? undefined;
  const root = values.get(CTX_ROOT);
  return typeof root === "string" && AUTHOR.test(root) ? root : undefined;
}

export interface UserGround {
  readonly reactor: Reactor;

  readonly governor?: string;
  readonly erased: () => ReadonlySet<string>;
  readonly cut?: number;
}
export function declareUserGround(reactor: Reactor, ground: () => UserGround): void {
  declarationsOf(reactor).users = ground;
}

export const usersGovernor = (ground: UserGround, operator: string | undefined) =>
  ground.governor ?? operator;

export function userGroundOf(reactor: Reactor): UserGround {
  return declarationsOf(reactor).users?.() ?? { reactor, erased: () => NONE };
}

export function userRootsRaw(
  ground: UserGround,
  operator: string | undefined,
  name: string,
): string[] {
  operator = usersGovernor(ground, operator);
  if (operator === undefined) return [];
  const { reactor } = ground;
  const erased = ground.erased();
  const cut = ground.cut ?? Infinity;
  const chain = recoveryChain(reactor, operator, name, erased, cut);
  if (chain.kind === "broken") return [];
  const entity = userEntity(name);
  const memo = new Map<string, boolean>();
  const struck = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false);
    const verdict = reactor.negationsOf(id).some((n) => {
      const neg = reactor.get(n);
      return (
        neg !== undefined &&
        !erased.has(n) &&
        neg.claims.author === operator &&
        neg.claims.timestamp <= cut &&
        verified(neg) &&
        !struck(n)
      );
    });
    memo.set(id, verdict);
    return verdict;
  };
  let named = false;
  const roots = new Set<string>();
  for (const id of reactor.byTarget(entity)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || d.claims.timestamp > cut) continue;
    if (!verified(d) || struck(id)) continue;
    const at = (context: string): boolean =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === entity &&
          p.target.entity.context === context,
      );
    const values = d.claims.pointers.flatMap((p) =>
      p.target.kind === "primitive" && typeof p.target.value === "string" ? [p.target.value] : [],
    );
    if (at(CTX_USER) && values.includes(name)) named = true;
    if (at(CTX_ROOT)) for (const v of values) if (AUTHOR.test(v)) roots.add(v);
  }
  if (!named) return [];
  if (chain.kind === "chain") return roots.has(chain.root) ? [chain.root] : [];
  return [...roots].sort();
}

export function subjectKeyAt(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  subject: string,
): string | undefined {
  if (!subject.startsWith(USER_PREFIX)) return subject;
  const ground = userGroundOf(reactor);
  return userRootAt(
    ground.reactor,
    now,
    usersGovernor(ground, operator),
    subject.slice(USER_PREFIX.length),
    ground.erased(),
    ground.cut,
  );
}

export function subjectCouldName(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  subject: string,
  key: string,
): boolean {
  if (subject === key) return true;
  operator = usersGovernor(userGroundOf(reactor), operator);
  if (operator === undefined || !subject.startsWith(USER_PREFIX)) return false;
  const ground = userGroundOf(reactor).reactor;
  const entity = userEntity(subject.slice(USER_PREFIX.length));
  for (const id of ground.byTarget(entity)) {
    const d = ground.get(id);
    if (d === undefined || d.claims.author !== operator || !verified(d)) continue;
    const atRoot = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === CTX_ROOT,
    );
    const names = d.claims.pointers.some(
      (p) => p.target.kind === "primitive" && p.target.value === key,
    );
    if (!atRoot || !names) continue;
    const dead = ground.negationsOf(id).some((n) => {
      const neg = ground.get(n);
      return (
        neg?.claims.author === operator &&
        verified(neg) &&
        neg.claims.validFrom <= now &&
        neg.claims.validUntil === undefined &&
        ground.negationsOf(n).length === 0
      );
    });
    if (!dead) return true;
  }
  return false;
}

export function keysSubjectCouldName(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  subject: string,
): string[] {
  if (!subject.startsWith(USER_PREFIX)) return [subject];
  operator = usersGovernor(userGroundOf(reactor), operator);
  if (operator === undefined) return [];
  const ground = userGroundOf(reactor).reactor;
  const entity = userEntity(subject.slice(USER_PREFIX.length));
  const out = new Set<string>();
  for (const id of ground.byTarget(entity)) {
    const d = ground.get(id);
    if (d === undefined || d.claims.author !== operator || !verified(d)) continue;
    const atRoot = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === CTX_ROOT,
    );
    if (!atRoot) continue;
    const dead = ground.negationsOf(id).some((n) => {
      const neg = ground.get(n);
      return (
        neg?.claims.author === operator &&
        verified(neg) &&
        neg.claims.validFrom <= now &&
        neg.claims.validUntil === undefined &&
        ground.negationsOf(n).length === 0
      );
    });
    if (dead) continue;
    for (const p of d.claims.pointers) {
      if (
        p.target.kind === "primitive" &&
        typeof p.target.value === "string" &&
        AUTHOR.test(p.target.value)
      ) {
        out.add(p.target.value);
      }
    }
  }
  return [...out];
}
