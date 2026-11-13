import type { Claims, Delta } from "@bombadil/rhizomatic";

export const POOL_KEYS_ENTITY = "loam:poolkeys";
export const CTX_POOL_KEY = "loam.poolkey";

import type { PoolKeySource } from "../store/peer-image.js";
import type { Ground } from "./ground.js";
export type { PoolKeySource } from "../store/peer-image.js";

export function memoryPoolKeys(): PoolKeySource {
  const seeds = new Map<string, string>();
  return {
    load: (pool) => seeds.get(pool),
    create: (pool) => {
      const seed = randomSeed();
      seeds.set(pool, seed);
      return seed;
    },
  };
}

function randomSeed(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function poolKeyClaims(pool: string, key: string, operator: string, t: number): Claims {
  return {
    timestamp: t,
    validFrom: t,
    author: operator,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: POOL_KEYS_ENTITY, context: CTX_POOL_KEY } },
      },
      { role: "pool", target: { kind: "primitive", value: pool } },
      { role: "key", target: { kind: "primitive", value: key } },
    ],
  };
}

const field = (d: Delta, role: string): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role === role && x.target.kind === "primitive");
  return p !== undefined && p.target.kind === "primitive" && typeof p.target.value === "string"
    ? p.target.value
    : undefined;
};

export function recordedPoolKey(
  reactor: Ground,
  operator: string | undefined,
  pool: string,
): string | undefined {
  if (operator === undefined) return undefined;
  let first: Delta | undefined;
  for (const id of reactor.byTarget(POOL_KEYS_ENTITY)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator || field(d, "pool") !== pool) continue;
    if (first === undefined || d.claims.timestamp < first.claims.timestamp) first = d;
  }
  return first === undefined ? undefined : field(first, "key");
}

const memoryByStore = new WeakMap<object, PoolKeySource>();
export function memoryPoolKeysFor(store: object): PoolKeySource {
  let keys = memoryByStore.get(store);
  if (keys === undefined) memoryByStore.set(store, (keys = memoryPoolKeys()));
  return keys;
}

export class PoolKeyMissing extends Error {}
