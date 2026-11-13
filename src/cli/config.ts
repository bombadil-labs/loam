import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { authorForSeed } from "@bombadil/rhizomatic";
import { randomBytes } from "node:crypto";

export interface LoamConfig {
  readonly operator: string;
  readonly store: string;
  readonly archive?: string;
}

const configPath = (home: string): string => join(home, "config.json");
const seedPath = (home: string): string => join(home, "operator.seed");

export interface InitResult {
  readonly created: boolean;
  readonly operator: string;
}

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
    target = statSync(home);
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

export const userSeedPath = (home: string, name: string): string => join(home, `user.${name}.seed`);

export function writeUserSeed(home: string, name: string, seed: string): void {
  const path = userSeedPath(home, name);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    rmSync(temp, { force: true });
    writeFileSync(temp, `${seed}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } catch (err) {
    try {
      rmSync(temp, { force: true });
    } catch {}
    throw err;
  }
}

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

export const penSeedPath = (home: string, name: string): string => join(home, `pen.${name}.seed`);

export const channelTokenPath = (home: string, channel: string): string =>
  join(
    home,
    `channel.${channel.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48)}--` +
      `${createHash("sha256").update(channel, "utf8").digest("hex").slice(0, 16)}.token`,
  );

export function writeChannelToken(home: string, channel: string, token: string): void {
  writeFileSync(channelTokenPath(home, channel), `${token}\n`, { mode: 0o600 });
}

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

export function readPenSeed(home: string, name: string): UserSeedRead {
  try {
    return { kind: "present", seed: readFileSync(penSeedPath(home, name), "utf8").trim() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", detail: err instanceof Error ? err.message : String(err) };
  }
}

export const isSeedHex = (seed: string): boolean => /^[0-9a-f]{64}$/.test(seed);

export interface PenSeeds {
  readonly pens: Readonly<Record<string, string>>;
  readonly faults: readonly string[];
}

export function readPenSeeds(home: string): PenSeeds {
  const pens: Record<string, string> = {};
  const faults: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(home);
  } catch (err) {
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
    if (read.kind === "absent") continue;
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

const resolveInHome = (home: string, path: string): string =>
  isAbsolute(path) ? path : join(home, path);

export function storePath(home: string, override?: string): string {
  if (override !== undefined) return resolveInHome(home, override);
  return join(home, readConfig(home).store);
}

export function archivePath(home: string, override?: string): string | undefined {
  if (override !== undefined) return resolveInHome(home, override);
  const archive = readConfig(home).archive;
  return archive === undefined ? undefined : join(home, archive);
}
