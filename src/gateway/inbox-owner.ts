import { effectiveGrantsAt } from "./accounts.js";
import { subjectKeyAt, USER_PREFIX } from "./user-root.js";
import { memberOf } from "./member-of.js";
import { keysActingFor } from "./principal.js";
import type { Gateway } from "./gateway.js";
import type { Peer } from "./peer.js";

export interface PoolOwner {
  readonly key: string;
  readonly user?: string;
}

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
