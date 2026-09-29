// Each new pool under its own key (step 6 host trial; refactor/audit/step6-pool-keys.md, stages 2
// and 3). The host records the pool's key id BEFORE the key is used: a pool the host names with a key
// must have that key, and a pool it never named is an existing pool on the host key. A missing file
// or a missing journal is never read as "existing pool".

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";

export const POOL_KEYS_ENTITY = "loam:poolkeys";
export const CTX_POOL_KEY = "loam.poolkey";

/** Where a pool's key seed lives. The CLI keeps it under the home; an embedder passes its own. */
export interface PoolKeySource {
  load(pool: string): string | undefined;
  create(pool: string): string;
}

/** A key source that lives only as long as the process (the trial, and tests). */
export function memoryPoolKeys(): PoolKeySource {
  const seeds = new Map<string, string>();
  return {
    load: (pool) => seeds.get(pool),
    create: (pool) => {
      const seed = randomBytes(32).toString("hex");
      seeds.set(pool, seed);
      return seed;
    },
  };
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

/**
 * A key source kept in one file beside a store (the trial's durable custody). Written whole to a
 * temporary file and renamed, readable by its owner only. A key is on disk before the host records
 * it, so a crash between the two leaves an unused key, never a record without its key.
 */
export function filePoolKeys(path: string): PoolKeySource {
  const read = (): Record<string, string> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
  return {
    load: (pool) => read()[pool],
    create: (pool) => {
      const all = read();
      const seed = randomBytes(32).toString("hex");
      all[pool] = seed;
      writeFileSync(`${path}.tmp`, JSON.stringify(all), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return seed;
    },
  };
}

// One in-memory source per store object, so a reboot over the same store finds its pools' keys.
const memoryByStore = new WeakMap<object, PoolKeySource>();
export function memoryPoolKeysFor(store: object): PoolKeySource {
  let keys = memoryByStore.get(store);
  if (keys === undefined) memoryByStore.set(store, (keys = memoryPoolKeys()));
  return keys;
}
