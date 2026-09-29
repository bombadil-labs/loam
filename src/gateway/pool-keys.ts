// Each new pool under its own key (refactor/audit/step6-pool-keys.md). The host records the pool's
// key id BEFORE the key is used: a pool the host names with a key must have that key. A pool it
// never named, over a store that holds rows, is an older pool and is refused (ruling 10). A missing
// key file or a missing journal is never read as "older pool".
//
// Browser-safe: no node imports. A file-backed store keeps its pools' keys itself (`poolKeys()`).

import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";

export const POOL_KEYS_ENTITY = "loam:poolkeys";
export const CTX_POOL_KEY = "loam.poolkey";

import type { PoolKeySource } from "../store/peer-image.js";
export type { PoolKeySource } from "../store/peer-image.js";

/** A key source that lives only as long as the process (a memory store, and tests). */
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

/** The key the host recorded for `pool`: its operator's earliest record, or undefined. */
export function recordedPoolKey(
  reactor: Reactor,
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

// One in-memory source per store object, so a reboot over the same store finds its pools' keys.
const memoryByStore = new WeakMap<object, PoolKeySource>();
export function memoryPoolKeysFor(store: object): PoolKeySource {
  let keys = memoryByStore.get(store);
  if (keys === undefined) memoryByStore.set(store, (keys = memoryPoolKeys()));
  return keys;
}
