// An inbox owns the authority filter on the rows it contributes. Kept separate from the
// container opener so serving contributions do not import the tree's runtime machinery.
import { effectiveGrantsAt } from "./accounts.js";
import { subjectKeyAt, USER_PREFIX } from "./user-root.js";
import { memberOf } from "./member-of.js";
import { keysActingFor } from "./principal.js";
import type { Gateway } from "./gateway.js";
import type { Peer } from "./peer.js";

/** The one owner an inbox pool's effective admin grants name: a user, or a key. */
export interface PoolOwner {
  readonly key: string;
  readonly user?: string;
}

/**
 * The owner of the inbox pool `pool`: the one principal its effective admin grants name. Grants are
 * counted by the owner they RESOLVE to, so two grants for one owner name one owner. None, several,
 * or a user subject that resolves to no key is a refusal: a pool must never compose as if its owner
 * were someone.
 */
export function poolOwner(
  pool: Peer,
  now: number = pool.validityNow(),
): PoolOwner | { readonly refusal: string } {
  const operator = pool.operatorAuthor;
  const owners = new Map<string, PoolOwner>();
  for (const g of effectiveGrantsAt(pool.reactor, now, operator)) {
    if (g.verb !== "admin") continue;
    const key = subjectKeyAt(pool.reactor, now, operator, g.subject);
    if (key === undefined) {
      return { refusal: `names its owner ${g.subject}, who resolves to no current key` };
    }
    const user = g.subject.startsWith(USER_PREFIX)
      ? g.subject.slice(USER_PREFIX.length)
      : undefined;
    const known = owners.get(key);
    if (known?.user !== undefined && user !== undefined && known.user !== user) {
      return { refusal: `names two users, ${known.user} and ${user}, for one key` };
    }
    const named = known?.user ?? user;
    owners.set(key, named === undefined ? { key } : { key, user: named });
  }
  if (owners.size !== 1) {
    return {
      refusal:
        owners.size === 0
          ? "has no owner: no effective admin grant stands in it"
          : `names ${owners.size} owners in its admin grants`,
    };
  }
  return [...owners.values()][0]!;
}

// What an inbox pool contributes for `owner`: a user's present authority and history in this pool
// (`loam.memberOf`, lowered by the pool's select), or a key and the keys acting for it here. The
// pool operator's own claims compose too: they are its law (erasures, strikes, grants), never data
// written for the owner, and a parent read must keep binding them (H1).
export function ownerTerm(
  pool: Gateway,
  owner: PoolOwner,
  name: string,
  now: number = pool.validityNow(),
): unknown {
  const byOwner =
    owner.user !== undefined
      ? memberOf(owner.user, name)
      : {
          match: {
            field: "author",
            cmp: "inSet",
            const: [
              ...keysActingFor(pool.reactor, now, { root: owner.key }, name, pool.operatorAuthor),
            ].sort(),
          },
        };
  const pred =
    pool.operatorAuthor === undefined
      ? byOwner
      : { or: [byOwner, { match: { field: "author", cmp: "eq", const: pool.operatorAuthor } }] };
  return { op: "select", pred, in: "input" };
}
