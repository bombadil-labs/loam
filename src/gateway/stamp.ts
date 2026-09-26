// A delta's signed times when its author says nothing more: valid from the moment it is made.
// One call, spread into a claims literal, so a clock-like expression is evaluated once.
export const stamped = (t: number): { timestamp: number; validFrom: number } => ({
  timestamp: t,
  validFrom: t,
});

/** The two times a gateway gives a claim it is about to sign: `timestamp` orders it among its
 * author's claims, and `validFrom` says when it holds. They are independent: either may be the
 * later one. */
export interface Stamp {
  readonly timestamp: number;
  readonly validFrom: number;
}

/**
 * The stamp for a claim `author` is about to sign through `ground`. `timestamp` is the ground's
 * ordering time, which can run ahead of the wall clock. `validFrom` is `now`, the wall clock, so
 * the claim is valid on the next read and no signed value moves any reader's time. `Gateway.stamp`
 * is this with the gateway's own clock; call this form only where the ground is gateway-shaped.
 */
export function stampOn(
  ground: { nextTimestamp(author?: string): number },
  author: string | undefined,
  now: number,
): Stamp {
  const timestamp = ground.nextTimestamp(author);
  return { timestamp, validFrom: now };
}

/** Claims from a builder that takes one time, given both times of `s`: the builder sets
 * `timestamp` (and `validFrom`) from `s.timestamp`, then `validFrom` becomes `s.validFrom`. */
export const withStamp = <C extends { validFrom: number }>(
  s: Stamp,
  build: (timestamp: number) => C,
): C => ({ ...build(s.timestamp), validFrom: s.validFrom });
