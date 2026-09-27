// Which key a Loam USER acts from right now, read at the door. A grant may name a user
// (`user:<name>`) rather than a key; the door resolves it to the user's current root at read time,
// so re-pointing a user's root (recovery) moves every grant that names them at once.
//
// This is the indexed twin of `rootOf` in src/server/users.ts, which resolves through the user's
// operator-only View. The door cannot afford a View per grant per write, so this reads the user
// entity's own index with the same rules: operator-signed claims only, valid at `now`, not negated
// by the operator, the latest by timestamp winning with a tie going to the smaller id. The two must
// agree; test/gateway/user-root-index.test.ts holds them to it.

import type { Reactor } from "@bombadil/rhizomatic";
import { negatedAt } from "./negation.js";

export const CTX_USER = "loam.user";
export const CTX_ROLE = "loam.role";
/** The user's current ROOT key (README ruling 5): the principal every key of theirs acts for. */
export const CTX_ROOT = "loam.root";

export const USER_PREFIX = "user:";
export const userEntity = (name: string): string => `${USER_PREFIX}${name}`;

const AUTHOR = /^ed25519:[0-9a-f]{64}$/;

/**
 * The value the operator's latest standing claim at `user:<name>` in `context` holds, or undefined.
 * Standing: operator-signed, filed at that entity in that context, valid at `now`, not negated.
 */
function latestValue(
  reactor: Reactor,
  now: number,
  operator: string,
  name: string,
  context: string,
  role: string,
): unknown {
  const entity = userEntity(name);
  const negated = negatedAt(reactor, now, operator);
  let best: { timestamp: number; id: string; value: unknown } | undefined;
  for (const id of reactor.byTarget(entity)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator) continue;
    const { validFrom, validUntil } = d.claims;
    if (now < validFrom || (validUntil !== undefined && now >= validUntil)) continue;
    const filed = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === context,
    );
    if (!filed || negated(id)) continue;
    const held = d.claims.pointers.find((p) => p.role === role)?.target;
    if (held?.kind !== "primitive") continue;
    const t = d.claims.timestamp;
    if (best === undefined || t > best.timestamp || (t === best.timestamp && id < best.id)) {
      best = { timestamp: t, id, value: held.value };
    }
  }
  return best?.value;
}

/**
 * The root key `name` acts from at `now` in this ground, or undefined: no operator, no standing
 * user record naming them, or no root that is a well-formed key. Absence is absence; a caller
 * holding a grant that names this user gets no standing from it.
 */
export function userRootAt(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  name: string,
): string | undefined {
  if (operator === undefined) return undefined;
  if (latestValue(reactor, now, operator, name, CTX_USER, "name") !== name) return undefined;
  const root = latestValue(reactor, now, operator, name, CTX_ROOT, "root");
  return typeof root === "string" && AUTHOR.test(root) ? root : undefined;
}

// Where a ground reads its users. A pool holds no user records; it reads its host's, through the
// host gateway it declares here (re-read at call time, so a host reseat is followed).
const userGrounds = new WeakMap<Reactor, () => Reactor>();

/** Declare that `reactor`'s grants naming users resolve through `host()`'s user records. */
export function declareUserGround(reactor: Reactor, host: () => Reactor): void {
  userGrounds.set(reactor, host);
}

/**
 * The key a grant's `subject` names at `now`: the subject itself when it is not a user reference,
 * else that user's current root, read from this ground's user records (or its host's).
 */
export function subjectKeyAt(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  subject: string,
): string | undefined {
  if (!subject.startsWith(USER_PREFIX)) return subject;
  const ground = userGrounds.get(reactor)?.() ?? reactor;
  return userRootAt(ground, now, operator, subject.slice(USER_PREFIX.length));
}
