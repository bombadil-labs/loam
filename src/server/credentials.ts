// The credential file (§36 phase 1, T122): the one part of a user that is NOT a delta.
//
// A password hash must never enter the ground, because the ground REPLICATES — a federated peer
// would receive it, and an offer file would carry it off the box. So it lives in the Loam store's
// home directory (the `<home>` a caller passes to `loam serve --home <dir>`, never the operating
// system user's home), mode 0600, beside the operator seed it is a sibling to.
//
// Two rules govern every read here, and both are H7 at a future login door:
//
//   1. A file this module cannot fully parse means it CANNOT DETERMINE whether a password matches.
//      "Cannot determine" is never "matched" — it throws, and a caller must refuse.
//   2. Validation covers the WHOLE file, not one entry. A damaged neighbour means the file's shape
//      is unknown, and an unknown shape is not a shape to authenticate against (SUBSTRATE-HAZARDS
//      H9: a swallowed fault must not read as "no fault").
//
// The write is temp-then-rename-then-fsync, in the same directory as the target so the rename is
// atomic, because a half-written credential file locks the operator out of their own store. 0600 is
// applied to the temp file BEFORE any byte reaches it, and the descriptor is closed before the
// rename — an open descriptor held across a rename fails on Windows.
//
// This phase adds no door and no CLI command. Nothing calls `writeCredentials` yet, so it has no
// caller to serialize against a concurrent one; a cross-process lock is the first caller's problem,
// not this primitive's (see the working spec's "No cross-process write lock").

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
  readonly salt: string; // hex, at least 16 bytes
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
const MIN_SALT_HEX_LEN = 16; // 8 bytes — hashPassword mints 16 bytes; anything shorter is damage.

// Bounded above as well as below: the bitwise test coerces to int32, so a huge N would wrap and pass.
const isPowerOfTwo = (n: number): boolean =>
  Number.isInteger(n) && n >= 2 && n <= 2 ** 30 && (n & (n - 1)) === 0;

// Both axes of scrypt's cost are bounded, and independently: N*r bounds the MEMORY a derivation may
// claim, and N*r*p bounds the CPU work. Neither implies the other — a large p can multiply CPU time
// past the bound while N*r alone still sits under the memory bound, so a corrupted or hostile
// parameter set cannot buy CPU time back that the memory bound denied it.
// NAMED GAP: `r` is capped at 16 and `N` is a power of two, so the achievable N*r values jump in
// steps no finer than N itself near this boundary — no combination lands strictly between this
// constant and one ~1.5% larger. A test cannot pin this exact byte value without loosening the `r`
// cap or the power-of-two constraint; it can only pin that a value AT the boundary is admitted and a
// value well past it is refused, which test/server/credentials.test.ts does.
const MAX_MEMORY_BYTES = 64 * 1024 * 1024; // 64 MiB
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

/**
 * One entry, checked to the byte. The hash's LENGTH is checked against `keylen` on purpose: a
 * truncated file is the shape that leaves a short hash behind, and a short hash is exactly what a
 * length-blind compare would accept a prefix against. A too-short salt is refused too, so a mismatch
 * never reaches `timingSafeEqual`, which throws on unequal-length buffers rather than comparing them.
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
  // HEX (`+`, one or more) already refuses an empty string, so an explicit `.length === 0` check
  // beside it is dead code that only adds an unkillable mutant — HEX.test("") is false on its own.
  // NAMED GAP: swapping this line's first `||` to `&&` is a real mutant no JSON-parseable value can
  // reach — `salt.length % 2 !== 0` is true for every non-string JSON.parse can produce (a number or
  // boolean has no `.length`, so it reads as `NaN !== 0`), so the swap is only visible through a
  // hand-built object with a custom `.length` and `.toString()` that JSON.parse never yields.
  if (typeof salt !== "string" || !HEX.test(salt) || salt.length % 2 !== 0) {
    throw new CredentialsUnreadable(`${where} has no hex salt`);
  }
  if (salt.length < MIN_SALT_HEX_LEN) {
    throw new CredentialsUnreadable(`${where} has a salt shorter than the entropy floor`);
  }
  // NAMED GAP, the same shape as the salt check above: swapping this `||` to `&&` is unreachable
  // via JSON.parse output — a non-string hash always has `.length !== params.keylen * 2` on the
  // next line (a non-string's `.length` is `undefined`, which is never `===` a number), so the
  // hash-length check below refuses it regardless of whether this line's own logic is intact.
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

/**
 * The whole file, checked. An ABSENT file (`ENOENT`) is an empty one — a home with no users yet is
 * not damaged. Any other read fault (permission denied, a directory where the file should be, and so
 * on) is a real fault and must not be folded into "empty." Anything present but unparseable throws.
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
  // A null prototype, so a user literally named `__proto__` is a key and never a prototype write —
  // `JSON.parse`'s own object still inherits from `Object.prototype`, so copying into a fresh
  // null-prototype object is what makes the lookup below safe against a shadowed built-in.
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
 * Write the file whole: a fresh 0600 temp beside it, fsync, close, rename, fsync the directory. The
 * temp lives in the SAME directory as the target — a rename across filesystems is not atomic and can
 * fail with `EXDEV` — and its name carries the pid and random bytes so two writers never collide on
 * it and a crashed writer's leftover cannot block the next write. The descriptor is closed before the
 * rename, because an open handle held across a rename fails on Windows.
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
