// Which key a Loam USER acts from right now, read at the door. A grant may name a user
// (`user:<name>`) rather than a key; the door resolves it to the user's current root at read time,
// so re-pointing a user's root (recovery) moves every grant that names them at once.
//
// This is the indexed twin of `rootOf` in src/server/users.ts, which resolves through the user's
// operator-only View. The door cannot afford a View per grant per write, so this reads the user
// entity's own index with the same rules: operator-signed claims only, valid at `now`, not negated
// by the operator, the latest by timestamp winning with a tie going to the smaller id. The two must
// agree; test/gateway/user-grants.test.ts holds them to it.

import type { Reactor } from "@bombadil/rhizomatic";
import { negatedAt } from "./negation.js";

export const CTX_USER = "loam.user";
export const CTX_ROLE = "loam.role";
/** The user's current ROOT key (README ruling 5): the principal every key of theirs acts for. */
export const CTX_ROOT = "loam.root";

export const USER_PREFIX = "user:";
export const userEntity = (name: string): string => `${USER_PREFIX}${name}`;

const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

const NONE: ReadonlySet<string> = new Set();

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
): Map<string, unknown> {
  const entity = userEntity(name);
  const negated = negatedAt(reactor, now, operator);
  const best = new Map<string, { timestamp: number; id: string; value: unknown }>();
  for (const id of reactor.byTarget(entity)) {
    if (erased.has(id)) continue;
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator) continue;
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
 * not yet purged, which count as gone, as they do for the View reader.
 */
export function userRootAt(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  name: string,
  erased: ReadonlySet<string> = NONE,
): string | undefined {
  if (operator === undefined) return undefined;
  const values = latestValues(reactor, now, operator, name, erased);
  if (values.get(CTX_USER) !== name) return undefined;
  const root = values.get(CTX_ROOT);
  return typeof root === "string" && AUTHOR.test(root) ? root : undefined;
}

// Where a ground reads its users, and which of their claims are erased but still held. A pool
// holds no user records; it reads its host's. The Gateway declares this for every reactor it sets,
// because the erasure reader lives above this module.
export interface UserGround {
  readonly reactor: Reactor;
  readonly erased: () => ReadonlySet<string>;
}
const userGrounds = new WeakMap<Reactor, () => UserGround>();

/** Declare where `reactor`'s grants naming users read those users. */
export function declareUserGround(reactor: Reactor, ground: () => UserGround): void {
  userGrounds.set(reactor, ground);
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
  const ground = userGrounds.get(reactor)?.();
  return userRootAt(
    ground?.reactor ?? reactor,
    now,
    operator,
    subject.slice(USER_PREFIX.length),
    ground?.erased() ?? NONE,
  );
}

/**
 * Could `subject` EVER name `key` here: it is that key, or it names a user for whom this ground
 * (or its host) holds an operator-signed root claim naming `key` — valid or not yet, struck or not,
 * since a strike can lapse and a window can open — unless the operator struck it for good. A revoke that must stop `key` for good asks
 * this, not what the subject names right now.
 */
export function subjectCouldName(
  reactor: Reactor,
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
    if (d === undefined || d.claims.author !== operator) continue;
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
    if (d === undefined || d.claims.author !== operator) continue;
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
