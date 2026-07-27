// The failed-login limiter's state, in a file (SPEC §36).
//
// It keys on the USERNAME, never on a caller-supplied source. Behind a proxy every request arrives
// from 127.0.0.1, and X-Forwarded-For is a header the caller writes — so a per-source limiter is a
// remote off-switch the attacker holds, and it points at the operator's own login. Keying on the
// username moves the off-switch to a place only the box can reach: `loam user unlock`.
//
// The state lives in the home rather than in server memory for exactly that reason: `loam user
// unlock` is a SEPARATE PROCESS, and memory it cannot reach is a lock it cannot clear.
//
// Deliberate posture on damage: a file this module cannot parse reads as NO LOCKS. That is fail-open,
// and it is the right direction here — this file is a work budget, not an authorization surface, the
// global hash cap still bounds the work, and failing closed would turn a local disk fault into a
// total login outage with no way in. Nothing remote can write this file; whoever can has the seed.

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
import { randomBytes } from "node:crypto";

export interface LimitPolicy {
  readonly maxFailures: number; // failures inside the window that engage the lock
  readonly windowMs: number; // how long a failure is remembered
  readonly lockMs: number; // how long the lock holds once engaged
}

export const DEFAULT_LIMIT: LimitPolicy = {
  maxFailures: 5,
  windowMs: 60_000,
  lockMs: 900_000,
};

export interface LockRecord {
  readonly failures: number;
  readonly firstFailureAt: number;
  readonly lockedUntil?: number;
}

export const locksPath = (home: string): string => join(home, "login-locks.json");

const isRecord = (raw: unknown): raw is LockRecord => {
  if (raw === null || typeof raw !== "object") return false;
  const { failures, firstFailureAt, lockedUntil } = raw as Record<string, unknown>;
  return (
    typeof failures === "number" &&
    Number.isInteger(failures) &&
    failures >= 0 &&
    typeof firstFailureAt === "number" &&
    Number.isFinite(firstFailureAt) &&
    (lockedUntil === undefined || (typeof lockedUntil === "number" && Number.isFinite(lockedUntil)))
  );
};

/** Every lock the home records. An absent or damaged file reads as none — see the header. */
export function readLocks(home: string): Map<string, LockRecord> {
  const locks = new Map<string, LockRecord>();
  let raw: string;
  try {
    raw = readFileSync(locksPath(home), "utf8");
  } catch {
    return locks;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return locks;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return locks;
  const users = (parsed as Record<string, unknown>)["users"];
  if (users === null || typeof users !== "object" || Array.isArray(users)) return locks;
  for (const [name, record] of Object.entries(users as Record<string, unknown>)) {
    if (isRecord(record)) locks.set(name, record);
  }
  return locks;
}

/** Replace the file whole: 0600 temp, fsync, rename — the same discipline credentials.json gets. */
export function writeLocks(home: string, locks: Map<string, LockRecord>): void {
  const target = locksPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify({ users: Object.fromEntries(locks) }, null, 2)}\n`;
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
  chmodSync(target, 0o600);
}

/** Milliseconds the lock on `name` still holds; 0 when the door is open. */
export function lockedMs(home: string, name: string, now: number): number {
  const record = readLocks(home).get(name);
  if (record?.lockedUntil === undefined) return 0;
  return record.lockedUntil > now ? record.lockedUntil - now : 0;
}

/**
 * Record one failed attempt for `name`. A lapsed window and a lapsed lock both START THE COUNT OVER:
 * a lock that expired but left its count behind would re-lock on the very next attempt, which is a
 * permanent lock wearing a timer's clothes.
 */
export function noteFailure(home: string, name: string, now: number, policy: LimitPolicy): void {
  const locks = readLocks(home);
  const previous = locks.get(name);
  const lapsed =
    previous === undefined ||
    now - previous.firstFailureAt > policy.windowMs ||
    (previous.lockedUntil !== undefined && previous.lockedUntil <= now);
  const failures = lapsed ? 1 : previous.failures + 1;
  const firstFailureAt = lapsed ? now : previous.firstFailureAt;
  locks.set(name, {
    failures,
    firstFailureAt,
    ...(failures >= policy.maxFailures ? { lockedUntil: now + policy.lockMs } : {}),
  });
  writeLocks(home, locks);
}

/** Forget `name`'s failures — what a successful login earns. */
export function forgetFailures(home: string, name: string): void {
  const locks = readLocks(home);
  if (locks.delete(name)) writeLocks(home, locks);
}

/** Clear `name`'s lock from the box. True if one was there. */
export function clearLock(home: string, name: string): boolean {
  const locks = readLocks(home);
  if (!locks.delete(name)) return false;
  writeLocks(home, locks);
  return true;
}
