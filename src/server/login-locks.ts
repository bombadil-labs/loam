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
// Deliberate posture on damage: a file this module cannot parse reads as NO LOCKS, and a file with SOME
// damaged records reads as the records it could parse. That is fail-open, and it is the right direction
// here — this file is a work budget, not an authorization surface, and failing closed would turn a local
// disk fault into a total login outage with no way in.
//
// AN UNAUTHENTICATED CALLER DRIVES THIS FILE. A failed login writes it, for any well-formed name,
// existing or not. So the size bound and the eviction rule below are load-bearing rather than tidy, and
// every cost on this path is a cost a stranger can ask for. The per-attempt read and rewrite are
// synchronous and whole-file, which is H8's shape: keep `maxTracked` small enough that the walk stays
// cheap, and do not add work here without asking who can pay for it.

import {
  chmodSync,
  closeSync,
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
  readonly maxTracked: number; // live records the file will hold — see noteFailure
}

export const DEFAULT_LIMIT: LimitPolicy = {
  maxFailures: 5,
  windowMs: 60_000,
  lockMs: 900_000,
  // Small ON PURPOSE: every failed attempt reads and rewrites this file whole, and an unauthenticated
  // caller drives that path. A bigger table buys a longer walk for the same protection.
  maxTracked: 512,
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

/**
 * Replace the file whole: 0600 temp, rename, chmod.
 *
 * NO FSYNC, and that is the one place this differs from credentials.json. A failed attempt rewrites this
 * file, so an fsync would add a DISK FLUSH — the slowest thing here by orders of magnitude — to a path an
 * unauthenticated caller drives, to make a durability promise nobody needs. Losing the last few failure
 * counts to a power cut costs an attacker nothing they did not already have.
 *
 * What that does NOT remove: the read, the parse, the stringify and the write are all synchronous and
 * whole-file, so an attempt still blocks the event loop for as long as the table takes to walk. That is
 * what `maxTracked` is small for. The temp-and-rename stays either way — a HALF-WRITTEN file would read
 * as no locks at all.
 */
export function writeLocks(home: string, locks: Map<string, LockRecord>): void {
  const target = locksPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify({ users: Object.fromEntries(locks) }, null, 2)}\n`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeSync(fd, body);
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

/** Milliseconds the lock on `name` still holds, read from an already-loaded table; 0 = open. */
export function lockedMsIn(
  locks: ReadonlyMap<string, LockRecord>,
  name: string,
  now: number,
): number {
  const record = locks.get(name);
  if (record?.lockedUntil === undefined) return 0;
  return record.lockedUntil > now ? record.lockedUntil - now : 0;
}

/** Milliseconds the lock on `name` still holds; 0 when the door is open. */
export const lockedMs = (home: string, name: string, now: number): number =>
  lockedMsIn(readLocks(home), name, now);

/** Has this record stopped saying anything? Its window has passed and it holds no live lock. */
const spent = (record: LockRecord, now: number, policy: LimitPolicy): boolean =>
  now - record.firstFailureAt > policy.windowMs &&
  (record.lockedUntil === undefined || record.lockedUntil <= now);

/**
 * Record one failed attempt for `name`. Pass the table you already read, so an attempt costs one read
 * rather than two — an unauthenticated caller drives this path, and every whole-file walk here is a
 * walk they asked for.
 *
 * Three rules, each answering a different failure:
 *
 * A lapsed window and a lapsed lock both START THE COUNT OVER — a lock that expired but left its count
 * behind would re-lock on the very next attempt, which is a permanent lock wearing a timer's clothes.
 *
 * SPENT RECORDS ARE PRUNED. A failed attempt is recorded for any well-formed name, existing or not, so a
 * caller walking names would otherwise add a row per attempt forever.
 *
 * And past `maxTracked` the oldest UNLOCKED record is EVICTED to make room. Never "stop counting": a
 * caller who fills the table with locked junk names would otherwise switch the limiter off for everyone
 * not already in it, which is the whole point of the limiter, gone. Evicting means a flood can only
 * displace the counts it created. When every record holds a live lock the table is genuinely full of
 * decided cases, and the new name waits — it took `maxFailures` hashes per row to get there.
 */
export function noteFailureIn(
  home: string,
  locks: Map<string, LockRecord>,
  name: string,
  now: number,
  policy: LimitPolicy,
): void {
  const previous = locks.get(name);
  for (const [held, record] of locks) {
    if (held !== name && spent(record, now, policy)) locks.delete(held);
  }
  if (previous === undefined && locks.size >= policy.maxTracked) {
    let oldest: { name: string; at: number } | undefined;
    for (const [held, record] of locks) {
      if (lockedMsIn(locks, held, now) > 0) continue;
      if (oldest === undefined || record.firstFailureAt < oldest.at) {
        oldest = { name: held, at: record.firstFailureAt };
      }
    }
    if (oldest === undefined) {
      writeLocks(home, locks); // every seat is a live lock; the prune above is still worth keeping
      return;
    }
    locks.delete(oldest.name);
  }
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

/** The same, reading the table itself — for a caller that has not already loaded it. */
export const noteFailure = (home: string, name: string, now: number, policy: LimitPolicy): void =>
  noteFailureIn(home, readLocks(home), name, now, policy);

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
