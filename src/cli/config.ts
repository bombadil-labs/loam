// The loam home: a directory holding the operator identity and config. The seed lives in its
// own file (`operator.seed`), never in `config.json` and never on any output stream — the
// public author string is the identity you can show around; the seed is the one you cannot.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorForSeed } from "@bombadil/rhizomatic";
import { randomBytes } from "node:crypto";

export interface LoamConfig {
  readonly operator: string; // the operator's public author — safe to display
  readonly store: string; // default store path, relative to the home
}

const configPath = (home: string): string => join(home, "config.json");
const seedPath = (home: string): string => join(home, "operator.seed");

export interface InitResult {
  readonly created: boolean; // false if the home already had an identity
  readonly operator: string;
}

// Create (or adopt) a loam home. Mints an operator seed unless one is supplied or already
// present. Idempotent: a second init over an existing home keeps its identity.
export function initHome(home: string, suppliedSeed?: string): InitResult {
  mkdirSync(home, { recursive: true });
  if (existsSync(seedPath(home))) {
    return { created: false, operator: authorForSeed(readSeed(home)) };
  }
  const seed = suppliedSeed ?? randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{64}$/.test(seed)) {
    throw new Error("a seed must be 64 hex characters (32 bytes)");
  }
  const operator = authorForSeed(seed);
  writeFileSync(seedPath(home), `${seed}\n`, { mode: 0o600 });
  const config: LoamConfig = { operator, store: "store.sqlite" };
  writeFileSync(configPath(home), `${JSON.stringify(config, null, 2)}\n`);
  return { created: true, operator };
}

export function readSeed(home: string): string {
  return readFileSync(seedPath(home), "utf8").trim();
}

export function readConfig(home: string): LoamConfig {
  return JSON.parse(readFileSync(configPath(home), "utf8")) as LoamConfig;
}

export function storePath(home: string, override?: string): string {
  return override ?? join(home, readConfig(home).store);
}
