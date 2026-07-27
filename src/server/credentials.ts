// The credential file (SPEC §36): the one part of a user that is NOT a delta.
//
// A password hash must never enter the ground, because the ground REPLICATES — a federated peer
// would receive it, and an offer file would carry it off the box. So it lives in the home, mode
// 0600, beside the operator seed it is a sibling to. `kind` is per-entry so a passkey entry can
// join later without a migration.
//
// Two rules govern every read here, and both are H7 at the login door:
//
//   1. A file this module cannot fully parse means it CANNOT DETERMINE whether a password matches.
//      "Cannot determine" is never "matched" — it throws, and the door refuses.
//   2. Validation covers the WHOLE file, not the one entry a login names. A damaged neighbour means
//      the file's shape is unknown, and an unknown shape is not a shape to authenticate against.
//
// The write is temp-then-rename-then-fsync, because a half-written credential file locks the
// operator out of their own store, and 0600 is applied to the temp file BEFORE any byte reaches it.

import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  readonly N: number; // CPU/memory cost, a power of two
  readonly r: number; // block size
  readonly p: number; // parallelism
  readonly keylen: number; // derived key bytes — the hash's own length
}

// The 2017 interactive-login floor, which is still the floor: ~16 MiB and ~100ms per hash.
export const DEFAULT_SCRYPT: ScryptParams = { N: 16384, r: 8, p: 1, keylen: 64 };

export interface CredentialEntry {
  readonly kind: "scrypt";
  readonly salt: string; // hex
  readonly hash: string; // hex, exactly params.keylen bytes
  readonly params: ScryptParams;
}

export interface CredentialsFile {
  readonly version: 1;
  readonly users: Record<string, CredentialEntry>;
}

/** The door could not decide. Never a licence to admit anyone. */
export class CredentialsUnreadable extends Error {}

export const credentialsPath = (home: string): string => join(home, "credentials.json");

const HEX = /^[0-9a-f]+$/;

const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

function checkParams(raw: unknown, where: string): ScryptParams {
  if (raw === null || typeof raw !== "object") {
    throw new CredentialsUnreadable(`${where} carries no scrypt parameters`);
  }
  const { N, r, p, keylen } = raw as Record<string, unknown>;
  if (typeof N !== "number" || !isPowerOfTwo(N)) {
    throw new CredentialsUnreadable(`${where} has no power-of-two scrypt N`);
  }
  for (const [name, value] of [
    ["r", r],
    ["p", p],
  ] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new CredentialsUnreadable(
        `${where} has a scrypt ${name} that is not a positive integer`,
      );
    }
  }
  if (typeof keylen !== "number" || !Number.isInteger(keylen) || keylen < 16) {
    throw new CredentialsUnreadable(`${where} has a scrypt keylen below 16 bytes`);
  }
  return { N, r: r as number, p: p as number, keylen };
}

/**
 * One entry, checked to the byte. The hash's LENGTH is checked against `keylen` on purpose: a
 * truncated file is the shape that leaves a short hash behind, and a short hash is exactly what a
 * length-blind compare would accept a prefix against.
 */
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
  if (typeof salt !== "string" || salt.length === 0 || !HEX.test(salt) || salt.length % 2 !== 0) {
    throw new CredentialsUnreadable(`${where} has no hex salt`);
  }
  if (typeof hash !== "string" || hash.length === 0 || !HEX.test(hash)) {
    throw new CredentialsUnreadable(`${where} has no hex hash`);
  }
  if (hash.length !== params.keylen * 2) {
    throw new CredentialsUnreadable(
      `${where} has a ${hash.length / 2}-byte hash where its parameters promise ${params.keylen}`,
    );
  }
  return { kind: "scrypt", salt, hash, params };
}

/**
 * The whole file, checked. An ABSENT file is an empty one — a home with no users yet is not damaged.
 * Anything present but unparseable throws.
 */
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
  // A null prototype, so a user literally named `__proto__` is a key and never a prototype write.
  const checked: Record<string, CredentialEntry> = Object.create(null) as Record<
    string,
    CredentialEntry
  >;
  for (const [name, entry] of Object.entries(users as Record<string, unknown>)) {
    checked[name] = checkEntry(entry, `${path}: the entry for "${name}"`);
  }
  return { version: 1, users: checked };
}

/** The entry for `name`, or undefined — prototype members are not entries. */
export const entryFor = (file: CredentialsFile, name: string): CredentialEntry | undefined =>
  Object.hasOwn(file.users, name) ? file.users[name] : undefined;

/**
 * Write the file whole: a fresh 0600 temp beside it, fsync, rename, fsync the directory. The temp
 * name carries the pid and random bytes so two writers never collide on it, and a crashed writer's
 * leftover cannot block the next write.
 */
export function writeCredentials(home: string, file: CredentialsFile): void {
  const target = credentialsPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify({ version: 1, users: { ...file.users } }, null, 2)}\n`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  // The rename carries the temp's own mode, so an old 0644 file cannot leave its mode behind. Said
  // again explicitly, because a future writer that stops using a temp would otherwise inherit it.
  chmodSync(target, 0o600);
  try {
    const dir = openSync(home, "r");
    try {
      fsyncSync(dir); // the rename itself is only durable once the directory entry is
    } finally {
      closeSync(dir);
    }
  } catch {
    // Windows refuses to fsync a directory handle. The rename is still atomic there; only the
    // durability of the directory entry across a power cut is weaker, and it is not ours to fix.
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

/**
 * Does `password` match `entry`? Throws `CredentialsUnreadable` when the entry cannot be trusted to
 * answer — never `false`, because a caller that treats a fault as a mismatch is right by accident and
 * a caller that treats it as a match is a hole. Compared timing-safely.
 */
export async function verifyPassword(entry: unknown, password: string): Promise<boolean> {
  const checked = checkEntry(entry, "this credential entry");
  const computed = await derive(password, Buffer.from(checked.salt, "hex"), checked.params);
  const expected = Buffer.from(checked.hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

// A decoy the door hashes against when no entry exists, so an unknown user costs the same time as a
// wrong password. Its salt is random per process: nothing ever verifies against it successfully.
const DECOY_SALT = randomBytes(16);

/** Spend one hash and return false — the unknown-user path, kept indistinguishable from a miss. */
export async function spendDecoyHash(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<false> {
  await derive(password, DECOY_SALT, params);
  return false;
}
