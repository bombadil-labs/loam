import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface LimitPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly forgetMs: number;
  readonly maxTracked: number;
}

export const DEFAULT_LIMIT: LimitPolicy = {
  baseDelayMs: 250,
  maxDelayMs: 5_000,
  forgetMs: 900_000,
  maxTracked: 512,
};

export interface FailureRecord {
  readonly failures: number;

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

export function readLocks(home: string): Map<string, FailureRecord> {
  const locks = new Map<string, FailureRecord>();
  const path = locksPath(home);
  let regular: boolean;
  try {
    regular = statSync(path).isFile();
  } catch {
    return locks;
  }
  if (!regular) return locks;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
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

function writeLocks(home: string, locks: Map<string, FailureRecord>): void {
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
    chmodSync(temp, 0o600);
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

const spent = (record: FailureRecord, now: number, policy: LimitPolicy): boolean =>
  now - record.lastFailureAt > policy.forgetMs;

export function delayFor(failures: number, policy: LimitPolicy): number {
  if (failures < 1) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (failures - 1));
}

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

export const delayMs = (home: string, name: string, now: number, policy: LimitPolicy): number =>
  delayMsIn(readLocks(home), name, now, policy);

export function noteFailure(home: string, name: string, now: number, policy: LimitPolicy): void {
  const locks = readLocks(home);
  const previous = locks.get(name);
  const onDisk = locks.size;
  for (const [held, record] of locks) {
    if (held !== name && spent(record, now, policy)) locks.delete(held);
  }
  if (policy.maxTracked < 1) {
    if (onDisk > 0) writeLocks(home, new Map());
    return;
  }
  if (previous === undefined && locks.size >= policy.maxTracked) {
    const weakest = [...locks].sort(
      ([, a], [, b]) => a.failures - b.failures || a.lastFailureAt - b.lastFailureAt,
    );
    for (const [held] of weakest.slice(0, locks.size - policy.maxTracked + 1)) locks.delete(held);
  }
  locks.set(name, {
    failures: previous === undefined || spent(previous, now, policy) ? 1 : previous.failures + 1,
    lastFailureAt: now,
  });
  writeLocks(home, locks);
}

export function forgetFailures(home: string, name: string): void {
  const locks = readLocks(home);
  if (locks.delete(name)) writeLocks(home, locks);
}
