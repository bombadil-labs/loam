// Shared pieces for recordings: fixed keys, fixed timestamps, a reactor built from a delta list in
// a chosen order, and canonical JSON. Nothing here reads the clock, randomness or the environment.

import { expect } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  Reactor,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";

const seed = (byte: string): string => byte.repeat(32);

export const SEEDS = {
  operator: seed("a1"),
  admin: seed("b2"),
  subadmin: seed("c3"),
  writer: seed("d4"),
  stranger: seed("e5"),
  peer: seed("f6"),
  cycleA: seed("17"),
  cycleB: seed("28"),
} as const;

export type Who = keyof typeof SEEDS;

export const KEY: Record<Who, string> = Object.fromEntries(
  Object.entries(SEEDS).map(([who, s]) => [who, authorForSeed(s)]),
) as Record<Who, string>;

export const WHO: readonly Who[] = Object.keys(SEEDS) as Who[];

const LABELS = new Map<string, string>();

/** Rewrites every known key and labelled delta id inside `s` to its printed name, so outputs diff
 * by meaning rather than by hash. Unlabelled ids print as they are. */
export function nameOf(s: string): string {
  return s
    .replace(/ed25519:[0-9a-f]{64}/g, (k) => {
      const who = WHO.find((w) => KEY[w] === k);
      return who === undefined ? k : `@${who}`;
    })
    .replace(/1e20[0-9a-f]{64}/g, (id) => (LABELS.has(id) ? `#${LABELS.get(id)}` : id));
}

/** A string a recording keeps byte for byte, without renaming. */
export class Raw {
  constructor(readonly value: string) {}
}

/** Signs `claims` as `by`, and records `label` as the delta's printed name. */
export function signed(claims: Claims, by: Who, label?: string): Delta {
  const d = signClaims(claims, SEEDS[by]);
  if (label !== undefined) LABELS.set(d.id, label);
  return d;
}

/** Every labelled delta's id, keyed by label: the content-address golden for a corpus. */
export function idsOf(deltas: readonly Delta[]): Record<string, Raw> {
  return Object.fromEntries(
    deltas.filter((d) => LABELS.has(d.id)).map((d) => [LABELS.get(d.id)!, new Raw(d.id)]),
  );
}

export function strike(target: Delta, by: Who, timestamp: number): Delta {
  return signed(makeNegationClaims(KEY[by], timestamp, target.id), by);
}

/** A reactor holding `deltas`, ingested in list order. */
export function reactorOf(deltas: readonly Delta[]): Reactor {
  const reactor = new Reactor();
  for (const d of deltas) reactor.ingest(d);
  return reactor;
}

/** Runs `read` over the corpus in forward and in reverse ingest order. A decision that depends on
 * arrival order records both answers; one that does not records one. */
export function bothOrders<T>(
  deltas: readonly Delta[],
  read: (r: Reactor) => T,
): T | { forward: T; reverse: T } {
  const forward = read(reactorOf(deltas));
  const reverse = read(reactorOf([...deltas].reverse()));
  return canon(forward) === canon(reverse) ? forward : { forward, reverse };
}

/** Canonical JSON: sorted object keys, sets and maps as sorted arrays, keys replaced by names. */
export function canon(value: unknown): string {
  return JSON.stringify(normalize(value), null, 2) + "\n";
}

function normalize(value: unknown): unknown {
  if (value instanceof Raw) return value.value;
  if (value instanceof Set) return [...value].map(normalize).sort(byCanon);
  if (value instanceof Map) {
    return [...value.entries()].map(([k, v]) => [normalize(k), normalize(v)]).sort(byCanon);
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "string") return nameOf(value);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .map((k) => [nameOf(k), normalize((value as Record<string, unknown>)[k])] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return value === undefined ? null : value;
}

function byCanon(a: unknown, b: unknown): number {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Compares `value` with the stored recording `out/<name>.json`. Write it with `vitest -u`. */
export async function record(name: string, value: unknown): Promise<void> {
  await expect(canon(value)).toMatchFileSnapshot(`./out/${name}.json`);
}
