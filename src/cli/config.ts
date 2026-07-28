// The loam home: a directory holding the operator identity and config. The seed lives in its
// own file (`operator.seed`), never in `config.json` and never on any output stream — the
// public author string is the identity you can show around; the seed is the one you cannot.
//
// Caveat, stated plainly: the seed file is written mode 0600, which POSIX honors but Windows
// does not — on Windows the file inherits the directory's ACLs. Deployments that must protect
// the seed on Windows should place the home on an access-restricted directory (or supply the
// seed via the environment and keep the home ephemeral).

import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { authorForSeed } from "@bombadil/rhizomatic";
import { randomBytes } from "node:crypto";

export interface LoamConfig {
  readonly operator: string; // the operator's public author — safe to display
  readonly store: string; // default store path, relative to the home
  readonly archive?: string; // optional cold store: a directory of delta files, relative to the home, mirrored on serve
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

/**
 * Is `home` a directory this process can actually work in? Names the fault, distinctly, rather
 * than one message for every shape of "no" (§36 phase 3, T124): a plain `lstat` sees a symlink but
 * not whether its target exists, and `lstat` + `isDirectory` would wrongly condemn a HEALTHY
 * symlinked home (a symlink itself is never `isDirectory`). So `lstat` names the path itself first,
 * `stat` (which follows a symlink) judges usability, and a working directory needs to be traversable
 * as well as present — `access` with all three of R/W/X asks that. `allowMissing` lets a bootstrap
 * caller (`create`, matching `serve`/`register`) treat "nothing here yet" as fine to build; a
 * caller that must not create a home as a side effect of failing to find one (`assign-role`,
 * `remove-role`) passes `false`.
 */
export function homeDefect(
  home: string,
  opts: { readonly allowMissing: boolean },
): string | undefined {
  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  let link;
  try {
    link = lstatSync(home);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return opts.allowMissing
        ? undefined
        : `${home} does not exist — \`loam init --home ${home}\` or \`loam user create\` makes one`;
    }
    return `${home} could not be checked: ${message(err)}`;
  }
  let target;
  try {
    target = statSync(home); // follows a symlink; a plain file or directory stats identically to lstat
  } catch (err) {
    if (link.isSymbolicLink() && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return `${home} is a symlink to a path that does not exist — point it at a real directory, or remove it`;
    }
    return `${home} could not be checked: ${message(err)}`;
  }
  if (!target.isDirectory()) {
    return `${home} is not a directory — pass --home a directory, or remove the file at that path`;
  }
  try {
    accessSync(home, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    return `${home} is sealed against this process — fix its permissions, or choose a home you own`;
  }
  return undefined;
}

export function readSeed(home: string): string {
  return readFileSync(seedPath(home), "utf8").trim();
}

// A per-operator signing key (§36 phase 3, T124): one file per user who has ever held the
// `operator` role, beside `operator.seed`, at the same 0600 mode. It never enters the ground — the
// ground replicates under federation, and a local secret must not.
export const userSeedPath = (home: string, name: string): string => join(home, `user.${name}.seed`);

/** Write (or overwrite) a user's seed. Always unconditional — see the working spec's §36.3.1.3: the
 * file is not itself a source of truth, the ground's grant is, so nothing worth keeping is ever
 * destroyed by replacing it. */
export function writeUserSeed(home: string, name: string, seed: string): void {
  writeFileSync(userSeedPath(home, name), `${seed}\n`, { mode: 0o600 });
}

/**
 * `remove-role` must tell "no file" from "a file I could not read" apart (§36.3.1.7): only the
 * first authorizes striking the role without its grant — the second may be hiding a key someone
 * else can still use, and "cannot determine" must never read as "safe to proceed" (H9).
 */
export type UserSeedRead =
  | { readonly kind: "present"; readonly seed: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly detail: string };

export function readUserSeed(home: string, name: string): UserSeedRead {
  try {
    return { kind: "present", seed: readFileSync(userSeedPath(home, name), "utf8").trim() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", detail: err instanceof Error ? err.message : String(err) };
  }
}

export function readConfig(home: string): LoamConfig {
  return JSON.parse(readFileSync(configPath(home), "utf8")) as LoamConfig;
}

export function storePath(home: string, override?: string): string {
  return override ?? join(home, readConfig(home).store);
}

// The archive is opt-in: undefined means "no cold store" — serve runs the bare sqlite driver.
export function archivePath(home: string, override?: string): string | undefined {
  if (override !== undefined) return override;
  const archive = readConfig(home).archive;
  return archive === undefined ? undefined : join(home, archive);
}
