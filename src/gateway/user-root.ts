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
 * shape is read, as the View's pick does: a latest claim of the wrong shape resolves to nothing
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
    const rest = d.claims.pointers.filter((p) => !filing.includes(p));
    const only = rest.length === 1 && rest[0]!.target.kind === "primitive" ? rest[0]! : undefined;
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
      const role = context === CTX_ROOT ? "root" : context === CTX_USER ? "name" : undefined;
      const value =
        only !== undefined && only.role === role && only.target.kind === "primitive"
          ? only.target.value
          : undefined;
      best.set(context, { timestamp: t, id, value });
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
