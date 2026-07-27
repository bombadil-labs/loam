// The failed-login limiter's state, in a file (SPEC §36).
//
// IT DELAYS; IT NEVER DENIES. A correct password is admitted however many failures came before it. A
// wrong one makes the next attempt for that name wait longer, up to a cap. There is no lock here, no
// expiry to wait out, and nothing scarce for a flood to steer — because a lock is an off switch a
// stranger can pull. Anyone who knows a username could hold the operator out of their own store with
// a handful of wrong passwords, and no keying of that lock makes it safe.
//
// It keys on the USERNAME, never on a caller-supplied source. Behind a proxy every request arrives
// from 127.0.0.1, and X-Forwarded-For is a header the caller writes — so a per-source limiter is a
// remote lever, and it points at the operator's own login. Keying on the username puts the one lever
// that clears a record where only the box can reach it: `loam user unlock`.
//
// The state lives in the home rather than in server memory for exactly that reason: `loam user
// unlock` is a SEPARATE PROCESS, and memory it cannot reach is a record it cannot clear.
//
// TWO VOCABULARIES LIVE HERE, and the split is deliberate rather than half-finished. Anything naming
// the FILE keeps the lock word — `login-locks.json`, `locksPath`, `readLocks`, `writeLocks`, and the
// local `locks` map they hand around — because that file name is on disk, in the erasure report's
// unswept list, and in what an operator reads. Anything naming the BEHAVIOUR uses the delay word:
// `FailureRecord`, `delayFor`, `delayMs`, `clearRecord`. So `locks` in this file means "the rows of
// login-locks.json", never "a lock somebody holds" — there is no such thing here any more.
//
// Deliberate posture on damage: a file this module cannot parse reads as NO RECORDS, and a file with
// SOME damaged records reads as the records it could parse. That is fail-open, and it is the right
// direction here — this file is a work budget, not an authorization surface, and failing closed would
// turn a local disk fault into a slow login for everyone with nothing to clear.
//
// THE NO-AWAIT DISCIPLINE IN `noteFailure` SETTLES ONE PROCESS, NOT TWO. Every write replaces the
// file whole through a rename, so two servers over one home are last-writer-wins and each silently
// discards the other's counts. `loam user unlock` shares the shape and says so at its call site. One
// home, one server is the supported posture; the failure mode is a lost count, never a lost login.
//
// AN UNAUTHENTICATED CALLER DRIVES THIS FILE. A failed login writes it, for any well-formed name,
// existing or not. So the size bound below is load-bearing rather than tidy, and every cost on this
// path is a cost a stranger can ask for. The per-attempt read and rewrite are synchronous and
// whole-file, which is H8's shape: keep `maxTracked` small enough that the walk stays cheap, and do
// not add work here without asking who can pay for it.

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
  readonly baseDelayMs: number; // what the FIRST failure buys the next attempt
  readonly maxDelayMs: number; // the ceiling: no attempt ever waits longer than this
  readonly forgetMs: number; // silence this long and the count starts over
  readonly maxTracked: number; // live records the file will hold — see noteFailure
}

export const DEFAULT_LIMIT: LimitPolicy = {
  baseDelayMs: 250,
  // The CAP is what keeps "slow" from becoming "shut". Five seconds is a long pause for a person
  // typing a password once.
  //
  // IT BOUNDS A SERIAL GUESSER ONLY, and nothing here should be read as a rate. Waits do not
  // serialize: the pre-compare read in session.ts is advisory, and `wait` is a bare timer with no
  // per-name queue, so a caller who holds many sockets has all their waits elapse together. Their
  // rate is then the CONCURRENT-HASH CAP divided by one hash — tens per second, and independent of
  // this number. Dividing one second by the cap gives 0.2 attempts per second and is wrong by orders
  // of magnitude against a caller who opens more than one connection.
  //
  // That is not a hole this constant can close. A per-name queue would let a caller who keeps
  // failing extend an honest attempt without limit, which is the lockout again. So the delay taxes
  // the cheap serial attack, the hash cap bounds the parallel one, and neither pretends to be the
  // other.
  maxDelayMs: 5_000,
  forgetMs: 900_000,
  // Small ON PURPOSE: every failed attempt reads and rewrites this file whole, and an unauthenticated
  // caller drives that path. A bigger table buys a longer walk for the same protection.
  maxTracked: 512,
};

export interface FailureRecord {
  readonly failures: number;
  /**
   * WALL CLOCK, and it has to be: this file outlives the process, and `loam user unlock` reads it from
   * another one, so a process-local monotonic origin would mean nothing to either. What the decay does
   * with it is written so that the unsafe direction cannot happen — see `spent`.
   */
  readonly lastFailureAt: number;
}

export const locksPath = (home: string): string => join(home, "login-locks.json");

const isRecord = (raw: unknown): raw is FailureRecord => {
  if (raw === null || typeof raw !== "object") return false;
  const { failures, lastFailureAt } = raw as Record<string, unknown>;
  return (
    typeof failures === "number" &&
    Number.isInteger(failures) &&
    failures >= 0 &&
    typeof lastFailureAt === "number" &&
    Number.isFinite(lastFailureAt)
  );
};

/** Every record the home holds. An absent or damaged file reads as none — see the header. */
export function readLocks(home: string): Map<string, FailureRecord> {
  const locks = new Map<string, FailureRecord>();
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
 * counts to a power cut costs a caller nothing they did not already have.
 *
 * What that does NOT remove: the read, the parse, the stringify and the write are all synchronous and
 * whole-file, so an attempt still blocks the event loop for as long as the table takes to walk. That is
 * what `maxTracked` is small for. The temp-and-rename stays either way — a HALF-WRITTEN file would read
 * as no records at all.
 */
export function writeLocks(home: string, locks: Map<string, FailureRecord>): void {
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

/**
 * Has this record stopped saying anything? Only silence for `forgetMs` retires a count.
 *
 * A WALL CLOCK STEPPED BACKWARDS MUST NOT RETIRE ONE. Such a step leaves `lastFailureAt` in the
 * future, so the elapsed time reads negative — and a negative elapsed is never greater than the
 * window, so the record stands. A step FORWARD past the window does retire the count, which is
 * indistinguishable from the time truly passing, and retiring is this file's fail-open direction
 * anyway.
 */
const spent = (record: FailureRecord, now: number, policy: LimitPolicy): boolean =>
  now - record.lastFailureAt > policy.forgetMs;

/**
 * The wait `failures` failures have bought: the base, doubled once per failure after the first, never
 * past the cap. No failures wait for nothing, which is what keeps an ordinary login fast.
 *
 * `2 ** big` reaches Infinity rather than wrapping, and Math.min carries that to the cap, so a count
 * no caller could reach still answers a number.
 */
export function delayFor(failures: number, policy: LimitPolicy): number {
  if (failures < 1) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (failures - 1));
}

/** The wait `name` owes, read from an already-loaded table; 0 = nothing owed. */
export function delayMsIn(
  locks: ReadonlyMap<string, FailureRecord>,
  name: string,
  now: number,
  policy: LimitPolicy,
): number {
  const record = locks.get(name);
  if (record === undefined || spent(record, now, policy)) return 0;
  return delayFor(record.failures, policy);
}

/** The wait `name` owes, read from the home; 0 = nothing owed. */
export const delayMs = (home: string, name: string, now: number, policy: LimitPolicy): number =>
  delayMsIn(readLocks(home), name, now, policy);

/**
 * Record one failed attempt for `name`.
 *
 * IT READS THE FILE ITSELF, and that is not a saving to optimise away. The read, the increment and the
 * write must happen with NO await between them, or two overlapping attempts each compute `failures + 1`
 * from the same value and the second write erases the first. The count then says one where four
 * landed, and a stale write can resurrect a count that a successful login — or `loam user unlock` —
 * had just cleared. Synchronous in a single-threaded loop IS the atomicity argument; handing this
 * function a table read from before an await throws it away.
 *
 * SILENCE FOR `forgetMs` STARTS THE COUNT OVER, measured from the LAST failure rather than the first.
 * From the first, a caller who keeps guessing would collect a fresh count every window — which is a
 * ceiling on the wait they can ever be charged, and the ceiling is the thing they want.
 *
 * SPENT RECORDS ARE PRUNED. A failed attempt is recorded for any well-formed name, existing or not, so
 * a caller walking names would otherwise add a row per attempt forever.
 *
 * And past `maxTracked` the WEAKEST records are evicted to make room — fewest failures, and the
 * NEWEST among equals. Nothing in this file can refuse a login, so an eviction can never be an off
 * switch; the most it can hand back is a wait.
 *
 * BOTH HALVES OF THAT ORDER ARE LOAD-BEARING. Fewest-failures means a caller must out-count a row to
 * displace it. Newest-among-equals means they must strictly EXCEED it: tie-break the other way and
 * merely matching a count evicts the older row, which is always the established one rather than the
 * flood's. So displacing a name with F failures costs F failures on every other row, and each of
 * those costs a hash the door's own cap rations.
 *
 * What the theft buys even then is about one attempt, because a wait rebuilds on the very next
 * failure — there is no expiry here for a flood to steal. What it does NOT cost is F rounds of
 * waiting: waits do not serialize across names, so the wall-clock price is the hash cap's, not the
 * delay's. Do not read that sentence as a serial cost; see DEFAULT_LIMIT on the same confusion.
 */
export function noteFailure(home: string, name: string, now: number, policy: LimitPolicy): void {
  const locks = readLocks(home);
  const previous = locks.get(name);
  for (const [held, record] of locks) {
    if (held !== name && spent(record, now, policy)) locks.delete(held);
  }
  if (previous === undefined && locks.size >= policy.maxTracked) {
    // Weakest first, and ENOUGH OF THEM that one new row still fits: a policy narrowed since the last
    // write can leave the table over its own bound, and evicting a single row would never catch up.
    const weakest = [...locks].sort(
      ([, a], [, b]) => a.failures - b.failures || b.lastFailureAt - a.lastFailureAt,
    );
    for (const [held] of weakest.slice(0, locks.size - policy.maxTracked + 1)) locks.delete(held);
  }
  locks.set(name, {
    failures: previous === undefined || spent(previous, now, policy) ? 1 : previous.failures + 1,
    lastFailureAt: now,
  });
  writeLocks(home, locks);
}

/** Forget `name`'s failures — what a successful login earns. */
export function forgetFailures(home: string, name: string): void {
  const locks = readLocks(home);
  if (locks.delete(name)) writeLocks(home, locks);
}

/**
 * Clear EVERY record. What `loam user unlock --all` earns, and the only cure sized to a file a caller
 * filled with names nobody can enumerate in advance. Returns how many records went.
 *
 * Every count starts from zero afterwards, so this hands a guessing caller their whole budget back as
 * well. An operator reaching for it is choosing that over waiting out `forgetMs`.
 */
export function clearAllRecords(home: string): number {
  const locks = readLocks(home);
  if (locks.size === 0) return 0;
  writeLocks(home, new Map());
  return locks.size;
}

/**
 * Clear `name`'s record from the box, and answer what it held — undefined when there was none.
 *
 * It answers the COUNT and its age rather than a wait. A wait is a property of the serving door's
 * policy, and this runs in another process that was never told that policy: naming a count is a fact,
 * naming a wait would be a guess.
 */
export function clearRecord(home: string, name: string): FailureRecord | undefined {
  const locks = readLocks(home);
  const held = locks.get(name);
  if (held === undefined) return undefined;
  locks.delete(name);
  writeLocks(home, locks);
  return held;
}
