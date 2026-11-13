export const stamped = (t: number): { timestamp: number; validFrom: number } => ({
  timestamp: t,
  validFrom: t,
});

export interface Stamp {
  readonly timestamp: number;
  readonly validFrom: number;
}

export function stampOn(
  ground: { nextTimestamp(author?: string): number },
  author: string | undefined,
  now: number,
): Stamp {
  const timestamp = ground.nextTimestamp(author);
  return { timestamp, validFrom: now };
}

export const withStamp = <C extends { validFrom: number }>(
  s: Stamp,
  build: (timestamp: number) => C,
): C => ({ ...build(s.timestamp), validFrom: s.validFrom });
