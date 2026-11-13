import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keylen: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 16384, r: 8, p: 1, keylen: 64 };

export interface CredentialEntry {
  readonly kind: "scrypt";
  readonly salt: string;
  readonly hash: string;
  readonly params: ScryptParams;
}

export interface CredentialsFile {
  readonly version: 1;
  readonly users: Record<string, CredentialEntry>;
}

export class CredentialsUnreadable extends Error {}

export const credentialsPath = (home: string): string => join(home, "credentials.json");

const HEX = /^[0-9a-f]+$/;
const MIN_SALT_HEX_LEN = 16;

const isPowerOfTwo = (n: number): boolean =>
  Number.isInteger(n) && n >= 2 && n <= 2 ** 30 && (n & (n - 1)) === 0;

const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const DEFAULT_COST = DEFAULT_SCRYPT.N * DEFAULT_SCRYPT.r * DEFAULT_SCRYPT.p;
const MAX_CPU_COST = DEFAULT_COST * 8;

function checkParams(raw: unknown, where: string): ScryptParams {
  if (raw === null || typeof raw !== "object") {
    throw new CredentialsUnreadable(`${where} carries no scrypt parameters`);
  }
  const { N, r, p, keylen } = raw as Record<string, unknown>;
  if (typeof N !== "number" || !isPowerOfTwo(N)) {
    throw new CredentialsUnreadable(`${where} has no power-of-two scrypt N of at least 2`);
  }
  for (const [name, value] of [
    ["r", r],
    ["p", p],
  ] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 16) {
      throw new CredentialsUnreadable(`${where} has a scrypt ${name} outside the 1–16 range`);
    }
  }
  if (typeof keylen !== "number" || !Number.isInteger(keylen) || keylen < 16 || keylen > 128) {
    throw new CredentialsUnreadable(`${where} has a scrypt keylen outside the 16–128 byte range`);
  }
  const params = { N, r: r as number, p: p as number, keylen };
  if (params.N * params.r > MAX_MEMORY_BYTES / 128) {
    throw new CredentialsUnreadable(`${where} has scrypt parameters exceeding the memory bound`);
  }
  if (params.N * params.r * params.p > MAX_CPU_COST) {
    throw new CredentialsUnreadable(`${where} has scrypt parameters exceeding the CPU bound`);
  }
  return params;
}

export function checkEntry(raw: unknown, where: string): CredentialEntry {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CredentialsUnreadable(`${where} is not a credential entry`);
  }
  const entry = raw as Record<string, unknown>;
  if (entry["kind"] !== "scrypt") {
    throw new CredentialsUnreadable(
      `${where} is a "${String(entry["kind"])}" credential, and this door only verifies scrypt`,
    );
  }
  const params = checkParams(entry["params"], where);
  const { salt, hash } = entry;
  if (typeof salt !== "string" || !HEX.test(salt) || salt.length % 2 !== 0) {
    throw new CredentialsUnreadable(`${where} has no hex salt`);
  }
  if (salt.length < MIN_SALT_HEX_LEN) {
    throw new CredentialsUnreadable(`${where} has a salt shorter than the entropy floor`);
  }
  if (typeof hash !== "string" || !HEX.test(hash)) {
    throw new CredentialsUnreadable(`${where} has no hex hash`);
  }
  if (hash.length !== params.keylen * 2) {
    throw new CredentialsUnreadable(
      `${where} has a ${hash.length / 2}-byte hash where its parameters promise ${params.keylen}`,
    );
  }
  return { kind: "scrypt", salt, hash, params };
}

export function readCredentials(home: string): CredentialsFile {
  const path = credentialsPath(home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, users: {} };
    throw new CredentialsUnreadable(
      `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CredentialsUnreadable(
      `${path} is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CredentialsUnreadable(`${path} is not a credential file`);
  }
  const file = parsed as Record<string, unknown>;
  if (file["version"] !== 1) {
    throw new CredentialsUnreadable(
      `${path} is version ${String(file["version"])}, and this door reads version 1`,
    );
  }
  const users = file["users"];
  if (users === null || typeof users !== "object" || Array.isArray(users)) {
    throw new CredentialsUnreadable(`${path} carries no users object`);
  }
  const checked: Record<string, CredentialEntry> = Object.create(null) as Record<
    string,
    CredentialEntry
  >;
  for (const [name, entry] of Object.entries(users as Record<string, unknown>)) {
    checked[name] = checkEntry(entry, `${path}: the entry for "${name}"`);
  }
  return { version: 1, users: checked };
}

export const entryFor = (file: CredentialsFile, name: string): CredentialEntry | undefined =>
  Object.hasOwn(file.users, name) ? file.users[name] : undefined;

const cleanupQuietly = (step: () => void): void => {
  try {
    step();
  } catch {}
};

export function writeCredentials(home: string, file: CredentialsFile): void {
  const target = credentialsPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify({ version: 1, users: { ...file.users } }, null, 2)}\n`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally {
      cleanupQuietly(() => closeSync(fd));
    }
    renameSync(temp, target);
  } catch (err) {
    cleanupQuietly(() => rmSync(temp, { force: true }));
    throw err;
  }
  chmodSync(target, 0o600);
  try {
    const dir = openSync(home, "r");
    try {
      fsyncSync(dir);
    } finally {
      cleanupQuietly(() => closeSync(dir));
    }
  } catch (err) {
    if (process.platform !== "win32") throw err;
  }
}

const maxmemFor = (params: ScryptParams): number =>
  Math.max(32 * 1024 * 1024, 256 * params.N * params.r * params.p);

const derive = (password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<CredentialEntry> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, params);
  return { kind: "scrypt", salt: salt.toString("hex"), hash: hash.toString("hex"), params };
}

export async function verifyPassword(entry: unknown, password: string): Promise<boolean> {
  const checked = checkEntry(entry, "this credential entry");
  const computed = await derive(password, Buffer.from(checked.salt, "hex"), checked.params);
  const expected = Buffer.from(checked.hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function decoyParamsFor(file: CredentialsFile, fallback: ScryptParams): ScryptParams {
  const names = Object.keys(file.users).sort();
  return names.length === 0 ? fallback : (file.users[names[0]!] as CredentialEntry).params;
}

const sameParams = (a: ScryptParams, b: ScryptParams): boolean =>
  a.N === b.N && a.r === b.r && a.p === b.p && a.keylen === b.keylen;

export function paramsDisagree(file: CredentialsFile): boolean {
  const entries = Object.values(file.users);
  return entries.some((entry) => !sameParams(entry.params, entries[0]!.params));
}

const DECOY_SALT = randomBytes(16);

export async function spendDecoyHash(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<false> {
  await derive(password, DECOY_SALT, params);
  return false;
}
