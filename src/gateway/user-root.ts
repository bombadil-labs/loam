// Which key a Loam USER acts from right now, read at the door. A grant may name a user
// (`user:<name>`) rather than a key; the door resolves it to the user's current root at read time,
// so re-pointing a user's root (recovery) moves every grant that names them at once.
//
// This is the indexed twin of `rootOf` in src/server/users.ts, which resolves through the user's
// operator-only View. The door cannot afford a View per grant per write, so this reads the user
// entity's own index with the same rules: operator-signed claims only, valid at `now`, not negated
// by the operator, the latest by timestamp winning with a tie going to the smaller id. The two must
// agree; test/gateway/user-grants.test.ts holds them to it.

import {
  computeId,
  verifyDelta,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";

export const CTX_USER = "loam.user";
export const CTX_ROLE = "loam.role";
/** The user's current ROOT key (README ruling 5): the principal every key of theirs acts for. */
export const CTX_ROOT = "loam.root";

// A user name reaches an entity id, a JSON object key, and an HTML page. Keep it to the characters
// that are safe in all three, and short enough to read in a provenance trail.
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

// Every operator claim at a user entity decides authority (the user's record, roles, root and
// recovery history), and a reactor can hold raw-ingested rows no door verified. So every reader of
// those claims signature-checks one before use, as the substrate checks principal evidence; a
// verdict is cached per object, id and signature. The same holds for an operator negation of such a
// claim, and for a counter-negation of that: an unsigned one strikes nothing. `resolveUserView`
// hides the same rows from the View, so the indexed readers and the View reader agree.
const verifiedCache = new WeakMap<Delta, { readonly id: string; readonly sig: string }>();
/** Does `d` carry its author's valid signature over its own content address? */
export function verified(d: Delta): boolean {
  const hit = verifiedCache.get(d);
  if (hit !== undefined && hit.id === d.id && hit.sig === d.sig && computeId(d.claims) === d.id) {
    return true;
  }
  if (verifyDelta(d) !== "verified") return false;
  verifiedCache.set(d, { id: d.id, sig: d.sig! });
  return true;
}

// --- recovery (step 5, PR 3e; refactor/audit/user-recovery.md) ---------------------------------
//
// A recovery is operator-signed history at the user entity: a RECORD in `loam.recovery` naming the
// key it replaces (`previous`), the new `root`, the record it `supersedes`, and every key the chain
// has `retired` so far; and a LINEAGE claim in `loam.lineage` carrying the same root and retired set
// with a pointer to its record, so the lineage survives the record's erasure. Both are also filed at
// one store-wide index entity, so every recovery is found without a scan.
//
// Recovery is DURABLE: a record or lineage claim counts from the moment it is held, whatever its
// validity or negations. Only erasure removes one. Timestamps never order recoveries; `supersedes`
// does. A history that is not one chain (two first records, two records superseding one, a
// `supersedes` or a lineage pointing at a record not held, a malformed claim) is BROKEN, and fails
// closed: the user has no root, and every key the history names holds no standing.

export const CTX_RECOVERY = "loam.recovery";
export const CTX_LINEAGE = "loam.lineage";
/** The index entity every recovery record and lineage claim is also filed at. */
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

/** The operator's recovery record. */
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

/** The lineage claim written beside a recovery record: its root and retired set, and the record. */
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

// The user a claim is filed for in `context`, when it carries BOTH filings the record shape
// requires: exactly one at `user:<name>` and exactly one at the index entity, in that same context.
// A claim missing either is not recovery evidence for any reader, so the per-user reader and the
// store-wide one always see the same claims.
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

// Every held operator claim that is recovery evidence for `name` in `context`, signed by the cut and
// not erased. Validity and negations are not asked: recovery is durable history.
function heldAt(
  reactor: Reactor,
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

// Every key a claim names, well-formed or not: what a broken history quarantines.
function namedKeys(d: Delta): string[] {
  return d.claims.pointers.flatMap((p) =>
    p.target.kind === "primitive" &&
    typeof p.target.value === "string" &&
    AUTHOR.test(p.target.value)
      ? [p.target.value]
      : [],
  );
}

// A record or lineage claim's fields, or undefined when it is malformed.
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

// The retired set a record must carry: its predecessor's, plus its own previous, minus its root.
function expectedRetired(record: Parsed, predecessor: Parsed | undefined): Set<string> {
  const out = new Set(predecessor?.retired ?? []);
  if (record.previous !== undefined) out.add(record.previous);
  out.delete(record.root);
  return out;
}

/** A user's recovery history: none, one chain (its head's root and the keys it retired), or broken. */
export type RecoveryChain =
  | { readonly kind: "none" }
  | {
      readonly kind: "chain";
      /** The head record's id: what the next recovery supersedes. */
      readonly head: string;
      readonly root: string;
      readonly retired: ReadonlySet<string>;
    }
  | { readonly kind: "broken"; readonly implicated: ReadonlySet<string> };

/** Read `name`'s recovery history as it stood at `cut`, with `erased` counted as gone. */
export function recoveryChain(
  reactor: Reactor,
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
  // Each record's cumulative retired set must follow from its held predecessor, and each lineage
  // claim must repeat its record: the evidence a later erasure leaves behind has to be true.
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

/**
 * Why `delta` is not admissible as recovery evidence, or undefined. The door refuses a malformed
 * operator recovery record or lineage claim, and one whose cumulative retired set does not follow
 * from the record it names: once that record is erased, the successor is all the evidence left, so
 * it must have been true when it arrived.
 */
export function recoveryDefect(
  delta: Delta,
  reactor: Reactor,
  operator: string | undefined,
  batch: readonly Delta[] = [],
  gone: () => ReadonlySet<string> = () => NONE,
): string | undefined {
  const touches = delta.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      // Only this door's two contexts: other records share the index entity (cuts, outcomes and
      // incarnation markers, recovery-cut.ts) and are judged there.
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
  // A record arriving in the same atomic batch counts as held: a recovery lands whole. A record the
  // store has erased, or that an erasure in this batch erases, does not, even while its bytes are
  // still held: the readers already count it as gone, so a successor naming it would be an orphan.
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

/**
 * Every key that holds no standing in this ground because a recovery retired it: the retired keys
 * of each user's chain, and every key a broken history implicates.
 */
export function retiredKeysOf(
  reactor: Reactor,
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

/**
 * The previous root each unbroken recovery chain in this ground names for a record whose root is
 * `root`: the keys `root` recovered from. The history `keysEverOf` follows.
 */
export function recoveredFrom(
  reactor: Reactor,
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
    // Only an unbroken chain carries lineage: a broken history names no one's past.
    if (recoveryChain(reactor, operator, name, erased).kind === "chain") out.add(r.previous);
  }
  return [...out];
}

/**
 * The recoveries in unbroken chains whose ROOT is `root`: each record's id and the key it retired.
 * What the history reader pairs a cut with.
 */
export function recoveriesOf(
  reactor: Reactor,
  operator: string | undefined,
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
    if (name === undefined || r === undefined || r.root !== root || r.previous === undefined) {
      continue;
    }
    if (recoveryChain(reactor, operator, name, erased).kind === "chain") {
      out.push({ record: d.id, previous: r.previous });
    }
  }
  return out;
}

// Is there a standing operator root claim for `name` naming `key` at `now`: valid, not negated by
// the operator (as of `cut`), not erased, signed by the cut? The chain decides WHICH key may be the
// root; this decides whether the operator's own root claim for it stands.
function standingRootClaim(
  reactor: Reactor,
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

/**
 * The root `name` reads as under a recovery chain, or `undefined` when there is none; `null` when the
 * chain gives the user no root (broken, or the head's root has no standing operator claim). Shared by
 * the indexed reader here and the View reader (`rootOf`), so the two cannot differ.
 */
export function chainRoot(
  reactor: Reactor,
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

/**
 * The value each context's latest standing operator claim at `user:<name>` holds. Standing:
 * operator-signed, filed at that entity in that context, valid at `now`, not negated by the
 * operator, not erased. The latest by timestamp wins, a tie going to the smaller id, BEFORE its
 * value is read, as the View's pick does: a latest claim with no single value resolves to nothing
 * rather than letting an older one through.
 */
function latestValues(
  reactor: Reactor,
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
    // The View's value for a claim: its single non-filing pointer, whatever its role, rendered as
    // the resolver renders it (a primitive's value, an entity's or delta's id). Anything else is
    // not a single value, and resolves to nothing.
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

/**
 * The root key `name` acts from at `now` in this ground, or undefined: no operator, no standing
 * user record naming them, or no root that is a well-formed key. Absence is absence; a caller
 * holding a grant that names this user gets no standing from it. `erased` holds ids erased but
 * not yet purged, which count as gone, as they do for the View reader. `cut` reads the ground as
 * it stood at an as-of instant: only deltas signed by then, claims and strikes alike.
 */
export function userRootAt(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  name: string,
  erased: ReadonlySet<string> = NONE,
  cut = Infinity,
): string | undefined {
  if (operator === undefined) return undefined;
  const values = latestValues(reactor, now, operator, name, erased, cut);
  if (values.get(CTX_USER) !== name) return undefined;
  // Once a user has a recovery chain, only its head's root is eligible (the fence).
  const fenced = chainRoot(reactor, now, operator, name, erased, cut);
  if (fenced !== undefined) return fenced ?? undefined;
  const root = values.get(CTX_ROOT);
  return typeof root === "string" && AUTHOR.test(root) ? root : undefined;
}

// Where a ground reads its users, and which of their claims are erased but still held. A pool
// holds no user records; it reads its host's. The Gateway declares this for every reactor it sets,
// because the erasure reader lives above this module.
export interface UserGround {
  readonly reactor: Reactor;
  readonly erased: () => ReadonlySet<string>;
  /** An as-of read's instant: the ground holds only what was signed by then. */
  readonly cut?: number;
}
const userGrounds = new WeakMap<Reactor, () => UserGround>();

/** Declare where `reactor`'s grants naming users read those users. */
export function declareUserGround(reactor: Reactor, ground: () => UserGround): void {
  userGrounds.set(reactor, ground);
}

/** Where `reactor` reads its users: the declared ground, else itself. */
export function userGroundOf(reactor: Reactor): UserGround {
  return userGrounds.get(reactor)?.() ?? { reactor, erased: () => NONE };
}

/**
 * Every root key `name` could be read as under RAW evaluation, which ignores validity: the keys
 * named by the operator's root claims for that user, less any the operator struck (a strike
 * counts while it survives its own strikes, whatever its window). Empty unless some such operator
 * claim still names the user. This is the raw posture the grants themselves get: validity ignored,
 * every surviving operator strike binding. It is NOT a superset of the present root — a strike that
 * has lapsed counts here and not at `now`.
 */
export function userRootsRaw(
  ground: UserGround,
  operator: string | undefined,
  name: string,
): string[] {
  if (operator === undefined) return [];
  const { reactor } = ground;
  const erased = ground.erased();
  const cut = ground.cut ?? Infinity;
  // Once a user has a recovery chain, raw machinery trusts the head's root alone, and only while an
  // operator root claim names it; a broken history trusts no one.
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

/**
 * The key a grant's `subject` names at `now`: the subject itself when it is not a user reference,
 * else that user's current root, read from this ground's declared user ground (or itself).
 */
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
    operator,
    subject.slice(USER_PREFIX.length),
    ground.erased(),
    ground.cut,
  );
}

/**
 * Could `subject` EVER name `key` here: it is that key, or it names a user for whom this ground
 * (or its host) holds an operator-signed root claim naming `key` — valid or not yet, struck or not,
 * since a strike can lapse and a window can open — unless the operator struck it for good (a strike already in force, with no end, nothing held
 * against it). A revoke that must stop `key` for good asks
 * this, not what the subject names right now.
 */
export function subjectCouldName(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  subject: string,
  key: string,
): boolean {
  if (subject === key) return true;
  if (operator === undefined || !subject.startsWith(USER_PREFIX)) return false;
  const ground = userGrounds.get(reactor)?.().reactor ?? reactor;
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
    // Struck for good by the operator — in force, no end, nothing held against the strike — and
    // this claim can never name the key again.
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

/**
 * Every key `subject` could EVER name here: the subject itself when it is a key, else every key an
 * operator-signed root claim for that user names — valid or not yet, struck or not — unless the
 * operator struck that claim for good. What a revoke must account for before it reports success.
 */
export function keysSubjectCouldName(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  subject: string,
): string[] {
  if (!subject.startsWith(USER_PREFIX)) return [subject];
  if (operator === undefined) return [];
  const ground = userGrounds.get(reactor)?.().reactor ?? reactor;
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
