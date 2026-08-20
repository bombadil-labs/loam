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
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
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
    // NAMED GAP: an `lstat` fault that is not `ENOENT` (a permission error on a PARENT directory,
    // an I/O error) reaches this line and nothing here rails it — reproducing one portably needs
    // a filesystem this process cannot traverse, not merely a target it cannot write. Named rather
    // than faked with a mock, which would only prove the mock does what the mock says.
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

// A renderer pen's signing key (SPEC §23.3, T102): one file per provisioned pen, beside
// `operator.seed` and the `user.<name>.seed` files, at the same 0600 mode and under the same
// law — the seed never enters the ground, and the filesystem is the trust root. The file name
// IS the provisioning: `loam serve` reads every `pen.<name>.seed` at boot and hands the map to
// `GatewayOptions.pens`, keyed by the `<name>` a renderer binding cites.
export const penSeedPath = (home: string, name: string): string => join(home, `pen.${name}.seed`);

// A FEDERATION CHANNEL'S TOKEN (T196), under the same law as a pen seed: 0600, in the home, never
// in the ground. The split is the design — a channel's ADDRESS is ordinary data and rides its record
// as a delta, and the credential it presents is a secret and stays here. Federation is the last
// subsystem that should break the rule that a secret never enters the ground, since it is the one
// that hands data to other people.
//
// The filename carries a digest of the channel name rather than the name itself: a channel is
// `channel:<into>:<prefix>`, and folding its unsafe characters would be many-to-one — the same
// collision that would have let one channel's drop purge another's bytes.
export const channelTokenPath = (home: string, channel: string): string =>
  join(
    home,
    `channel.${channel.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48)}--` +
      `${createHash("sha256").update(channel, "utf8").digest("hex").slice(0, 16)}.token`,
  );

export function writeChannelToken(home: string, channel: string, token: string): void {
  writeFileSync(channelTokenPath(home, channel), `${token}\n`, { mode: 0o600 });
}

/** The same three-way read a pen seed has (H9): "no file" and "a file I could not read" must never
 * collapse — only the first means this channel was never given a credential. */
export function readChannelToken(home: string, channel: string): UserSeedRead {
  try {
    return { kind: "present", seed: readFileSync(channelTokenPath(home, channel), "utf8").trim() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", detail: err instanceof Error ? err.message : String(err) };
  }
}

export function writePenSeed(home: string, name: string, seed: string): void {
  writeFileSync(penSeedPath(home, name), `${seed}\n`, { mode: 0o600 });
}

/** The same three-way read as a user seed (H9): "no file" and "a file I could not read" must
 * never collapse — only the first means the pen is unprovisioned. */
export function readPenSeed(home: string, name: string): UserSeedRead {
  try {
    return { kind: "present", seed: readFileSync(penSeedPath(home, name), "utf8").trim() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * What a PROVISIONED seed is, in one place, so `loam serve` and `loam pen create` cannot disagree
 * about it: a create that accepted what a boot rejects would mint a pen dead on arrival. A refusal
 * built on this test must never quote the file — a string that fails it may still be a key.
 */
export const isSeedHex = (seed: string): boolean => /^[0-9a-f]{64}$/.test(seed);

export interface PenSeeds {
  readonly pens: Readonly<Record<string, string>>; // name → seed, the GatewayOptions.pens shape
  readonly faults: readonly string[]; // one line per file that exists and could not provision
}

/**
 * Every `pen.<name>.seed` in the home, as the map `loam serve` feeds `GatewayOptions.pens`. A file
 * that exists but cannot provision — unreadable, or not a 64-hex seed — is a FAULT, never a silent
 * skip: a skipped pen would surface only as a 403 on the first form POST, which is exactly the
 * twenty-minute puzzle this convention exists to end.
 */
export function readPenSeeds(home: string): PenSeeds {
  const pens: Record<string, string> = {};
  const faults: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(home);
  } catch (err) {
    // ONLY "there is no home yet" means "nothing is provisioned" (H9). Every other refusal — a
    // directory this process may not list, a bad device, a path that is not a directory — leaves
    // the pens UNKNOWN, and an unknown set reported as an empty one boots a server whose every
    // form POST answers 403 with nothing on the log to explain it.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { pens, faults };
    return {
      pens,
      faults: [
        `no pen could be provisioned — ${home} could not be listed ` +
          `(${err instanceof Error ? err.message : String(err)}), so every pen.<name>.seed it ` +
          `holds is invisible to this serve`,
      ],
    };
  }
  for (const entry of entries) {
    const match = /^pen\.(.+)\.seed$/.exec(entry);
    if (match === null) continue;
    const name = match[1] as string;
    const read = readPenSeed(home, name);
    if (read.kind === "unreadable") {
      faults.push(
        `pen "${name}" is not provisioned — ${penSeedPath(home, name)} is unreadable: ${read.detail}`,
      );
      continue;
    }
    if (read.kind === "absent") continue; // raced away between readdir and read; absent is absent
    if (!isSeedHex(read.seed)) {
      faults.push(
        `pen "${name}" is not provisioned — ${penSeedPath(home, name)} does not hold a 64-hex seed`,
      );
      continue;
    }
    pens[name] = read.seed;
  }
  return { pens, faults };
}

export function readConfig(home: string): LoamConfig {
  return JSON.parse(readFileSync(configPath(home), "utf8")) as LoamConfig;
}

// One rule for every path flag: a relative value names a place INSIDE THE HOME, an absolute value
// is used as-is. The config values have always been home-relative; a flag override used to bypass
// this rule and resolve against the process's working directory instead, so for --archive a serve
// could mint an erasure-bearing vault wherever it happened to run while the vault the help text
// promised was never opened. `--store` and `--archive` take the same rule, or the two ways of
// naming the same file disagree about what it is relative to.
const resolveInHome = (home: string, path: string): string =>
  isAbsolute(path) ? path : join(home, path);

export function storePath(home: string, override?: string): string {
  if (override !== undefined) return resolveInHome(home, override);
  return join(home, readConfig(home).store);
}

// The archive is opt-in: undefined means "no cold store" — serve runs the bare sqlite driver.
export function archivePath(home: string, override?: string): string | undefined {
  if (override !== undefined) return resolveInHome(home, override);
  const archive = readConfig(home).archive;
  return archive === undefined ? undefined : join(home, archive);
}
