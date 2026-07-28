// `oauth.json` (SPEC §37): the durable half of a connector grant — registered clients, the actor
// seed each connector signs with, and the digests of the tokens that reach it.
//
// It lives in the home, mode 0600, beside the operator seed. It is NEVER in the ground, for the
// same reason a password hash is not: the ground REPLICATES, and a federated peer would receive a
// connector's signing key. This file holds the most dangerous secret in the home after the
// operator seed itself.
//
// Two rules govern every read of this file, and the second is what makes them worth restating:
//
//   1. A file this module cannot fully parse means it CANNOT DETERMINE what is registered. "Cannot
//      determine" is never "nothing is". It throws, and every caller refuses.
//   2. Validation covers the WHOLE file. A damaged entry means the file's shape is unknown, and an
//      unknown shape is not one to mint against — the specific failure of treating a bad file as
//      empty is minting a SECOND seed for a connector that already has one, leaving the first
//      grant standing in the ground with nobody holding its key.
//
// A grant's `actor` is checked against `authorForSeed(actorSeed)` on the way in. It is a cache of
// a derivation, and a cache that disagrees with its source is how a caller comes to name one
// author while the store's deltas name another.
//
// EVERY READ-MODIFY-WRITE GOES THROUGH `withOAuthFile`, AND THAT IS A CROSS-PROCESS LOCK. A CLI
// command and the server both touch this file from different processes, and a read-modify-write
// pair with no lock spreads whichever snapshot was read first — the mirror ordering can strand a
// connector's grant in the ground for a seed nobody holds, which is the file-layer form of the
// same completeness hazard erasure code calls H7. The write itself is atomic (see
// `writeOAuthFile`), which prevents a reader ever seeing half a file; it does not prevent two
// writers from losing one of their two updates, which is the separate property this lock exists
// for.

import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { authorForSeed } from "@bombadil/rhizomatic";

/** A dynamically registered client (RFC 7591). No secret: these are public clients. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly registeredAt: number; // wall clock, for a future `loam grant list`
  /**
   * Bumped by every revocation (a later phase's job). Recorded now so this field's shape never
   * changes under a phase that starts writing to it — the corollary of a shape-detected migration
   * is that a changed field's shape must differ unambiguously from what came before, so it is
   * cheaper to fix the shape once, here, than to owe a migration later.
   */
  readonly generation: number;
}

/**
 * One connector's own signing identity. `actorSeed` is the secret; `actor` is the public author
 * every delta the connector writes carries.
 */
export interface OAuthGrant {
  readonly clientId: string;
  readonly actorSeed: string; // 64 hex chars (32 bytes)
  readonly actor: string;
  readonly grantedAt: number;
  /**
   * Has the operator-signed write grant actually landed in the ground? A later phase sets this;
   * this module only carries the field so the shape is fixed before any door writes it.
   */
  readonly standing: boolean;
}

/** An issued access token, by DIGEST. The token itself is handed to the client and never stored. */
export interface OAuthToken {
  readonly digest: string; // sha256 hex of the bearer secret
  readonly clientId: string;
  readonly issuedAt: number;
}

export interface OAuthFile {
  readonly version: 1;
  readonly clients: readonly OAuthClient[];
  readonly grants: readonly OAuthGrant[];
  readonly tokens: readonly OAuthToken[];
}

/** The caller could not decide what is registered. Never a licence to mint. */
export class OAuthFileUnreadable extends Error {}

export const oauthPath = (home: string): string => join(home, "oauth.json");

export const EMPTY_OAUTH: OAuthFile = { version: 1, clients: [], grants: [], tokens: [] };

const HEX64 = /^[0-9a-f]{64}$/;

const str = (raw: unknown, where: string, field: string): string => {
  const value = (raw as Record<string, unknown>)[field];
  if (typeof value !== "string" || value === "") {
    throw new OAuthFileUnreadable(`${where} has no ${field}`);
  }
  return value;
};

const num = (raw: unknown, where: string, field: string): number => {
  const value = (raw as Record<string, unknown>)[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OAuthFileUnreadable(`${where} has no ${field}`);
  }
  return value;
};

/** Throws unless `raw` is a plain object. No caller uses a return value — this is a guard, not a cast. */
const object = (raw: unknown, where: string): void => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OAuthFileUnreadable(`${where} is not an object`);
  }
};

const array = (raw: unknown, where: string): unknown[] => {
  if (!Array.isArray(raw)) throw new OAuthFileUnreadable(`${where} is not an array`);
  return raw;
};

/**
 * A client name is meant to reach an operator's TERMINAL one day, through a future `grant list` —
 * so it is held to printable characters with no control bytes now, before any door exists to let
 * an outside caller set it. A newline in it would forge a whole extra row in that listing; an
 * ANSI escape would erase the caller's own.
 */
export const MAX_CLIENT_NAME = 200;

/**
 * C0, DEL and C1, plus the two Unicode separators a terminal also breaks a line on.
 *
 * Checked on THREE fields that a future `grant list` row would carry: the client name, each
 * redirect uri, and the client id. The uri is the one that hides — `new URL()` STRIPS tab, LF and
 * CR while parsing, so a uri carrying them parses clean and keeps its raw bytes in the stored
 * string. The id is the one nothing on the wire can set today, and it is checked anyway: the
 * threat model that earns the uri its check is a file edited by hand or written by an older build,
 * and that reaches the id equally.
 *
 * Written as a CODE-POINT test rather than a regex character class: a literal control character
 * inside a regex is unreadable in a source file.
 */
const CONTROL = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });

export const clientNameDefect = (name: string): string | undefined => {
  if (name.length === 0 || name.length > MAX_CLIENT_NAME) {
    return `a client_name is 1..${MAX_CLIENT_NAME} characters`;
  }
  if (CONTROL(name)) {
    return "a client_name carries no control character, escape, or line separator";
  }
  return undefined;
};

/** The same rule for a redirect uri, which would reach the same listing. */
export const uriTextDefect = (uri: string): string | undefined =>
  CONTROL(uri)
    ? "a redirect_uri carries no control character, escape, or line separator"
    : undefined;

/** And for the client id, which would be the third field on that row. */
export const idTextDefect = (id: string): string | undefined =>
  CONTROL(id) ? "a client_id carries no control character, escape, or line separator" : undefined;

function checkClient(raw: unknown, where: string): OAuthClient {
  object(raw, where);
  const uris = array((raw as Record<string, unknown>)["redirectUris"], `${where}: redirectUris`);
  const clientName = str(raw, where, "clientName");
  const defect = clientNameDefect(clientName);
  // Checked on the way IN as well: a file edited by hand, or written by an older build, must not
  // be able to smuggle a forged row into a future listing.
  if (defect !== undefined) throw new OAuthFileUnreadable(`${where}: ${defect}`);
  const generation = num(raw, where, "generation");
  if (!Number.isInteger(generation) || generation < 1) {
    throw new OAuthFileUnreadable(`${where} has a generation that is not a positive integer`);
  }
  const clientId = str(raw, where, "clientId");
  const idDefect = idTextDefect(clientId);
  if (idDefect !== undefined) throw new OAuthFileUnreadable(`${where}: ${idDefect}`);
  return {
    clientId,
    clientName,
    // `Array.from`, never `.map` — `.map` SKIPS a hole in a sparse array, so a caller-built
    // sparse `redirectUris` would validate as if the hole were not there and still get persisted;
    // `Array.from`'s iteration visits every index and hands a hole through as `undefined`, which
    // the `typeof uri !== "string"` check below correctly refuses.
    redirectUris: Array.from(uris, (uri, i) => {
      if (typeof uri !== "string" || uri === "") {
        throw new OAuthFileUnreadable(`${where}: redirect uri ${i} is not a string`);
      }
      const defect = uriTextDefect(uri);
      if (defect !== undefined)
        throw new OAuthFileUnreadable(`${where}: redirect uri ${i} — ${defect}`);
      return uri;
    }),
    registeredAt: num(raw, where, "registeredAt"),
    generation,
  };
}

function checkGrant(raw: unknown, where: string): OAuthGrant {
  object(raw, where);
  const actorSeed = str(raw, where, "actorSeed");
  if (!HEX64.test(actorSeed)) {
    throw new OAuthFileUnreadable(`${where} has an actorSeed that is not 32 hex bytes`);
  }
  const actor = str(raw, where, "actor");
  // The cache must agree with its source, or a caller ends up naming one author while the ground
  // holds another.
  if (actor !== authorForSeed(actorSeed)) {
    throw new OAuthFileUnreadable(`${where} names an actor its own seed does not derive`);
  }
  const standing = (raw as Record<string, unknown>)["standing"];
  if (typeof standing !== "boolean") {
    throw new OAuthFileUnreadable(`${where} does not say whether its grant has standing`);
  }
  return {
    clientId: str(raw, where, "clientId"),
    actorSeed,
    actor,
    grantedAt: num(raw, where, "grantedAt"),
    standing,
  };
}

function checkToken(raw: unknown, where: string): OAuthToken {
  object(raw, where);
  const digest = str(raw, where, "digest");
  if (!HEX64.test(digest)) {
    throw new OAuthFileUnreadable(`${where} has a digest that is not a sha-256 hex digest`);
  }
  return { digest, clientId: str(raw, where, "clientId"), issuedAt: num(raw, where, "issuedAt") };
}

/**
 * The whole file, checked. An ABSENT file is an empty one — a home with no connectors is not
 * damaged. Anything present but unparseable throws `OAuthFileUnreadable`.
 */
export function readOAuthFile(home: string): OAuthFile {
  const path = oauthPath(home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_OAUTH;
    throw new OAuthFileUnreadable(
      `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new OAuthFileUnreadable(
      `${path} is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return checkFileShape(parsed, path);
}

/**
 * Refuses a repeated key across a collection — one row per key is a shape invariant every later
 * phase assumes (a client owns one grant, a token digest names one client), and nothing upstream
 * of this check would otherwise catch a bug that appends a second row instead of replacing the
 * first (criterion (r)).
 */
function checkUnique(keys: readonly string[], where: string, field: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new OAuthFileUnreadable(`${where} has more than one ${field} ${key}`);
    seen.add(key);
  }
}

/**
 * The shared shape check behind both `readOAuthFile` (over freshly-parsed JSON) and
 * `writeOAuthFile` (over an in-memory `OAuthFile`, criterion (q)) — one validator, so the two
 * paths cannot drift apart on what counts as sound.
 */
function checkFileShape(parsed: unknown, where: string): OAuthFile {
  object(parsed, where);
  const file = parsed as Record<string, unknown>;
  if (file["version"] !== 1) {
    throw new OAuthFileUnreadable(
      `${where} is version ${String(file["version"])}, and this reader reads version 1`,
    );
  }
  // `Array.from`, never `.map`, on every RAW collection below — the same sparse-array hole this
  // file's `redirectUris` check names: `.map` skips a hole silently, letting a caller-built sparse
  // array validate clean and get persisted, where `Array.from` visits every index and hands a hole
  // through as `undefined`, which each `check*` function correctly refuses.
  const clients = Array.from(array(file["clients"], `${where}: clients`), (c, i) =>
    checkClient(c, `${where}: client ${i}`),
  );
  const grants = Array.from(array(file["grants"], `${where}: grants`), (g, i) =>
    checkGrant(g, `${where}: grant ${i}`),
  );
  const tokens = Array.from(array(file["tokens"], `${where}: tokens`), (t, i) =>
    checkToken(t, `${where}: token ${i}`),
  );
  checkUnique(
    clients.map((c) => c.clientId),
    where,
    "client with clientId",
  );
  checkUnique(
    grants.map((g) => g.clientId),
    where,
    "grant with clientId",
  );
  checkUnique(
    tokens.map((t) => t.digest),
    where,
    "token with digest",
  );
  return { version: 1, clients, grants, tokens };
}

/**
 * Write the file whole: a fresh 0600 temp beside it, fsync, an optional ownership recheck, rename,
 * fsync the directory. The temp name carries the pid and random bytes so two writers never collide
 * on it.
 *
 * `verifyOwnership` runs AFTER the temp is written and fsynced, and BEFORE the rename — as late as
 * this function can put it. `withOAuthFile` passes the lock's own nonce check here rather than
 * running it before calling this function, because `fsyncSync` is a synchronous disk operation
 * that can legitimately stall for longer than `LOCK_STALE_MS` under real disk contention. A check
 * run before the fsync would leave the WHOLE write — including that stall — inside the
 * check-then-act window; run here, the window is the syscall gap between one file read and the
 * rename, not however long the disk took. `writeOAuthFile` (no lock context) passes a no-op.
 *
 * The `chmodSync` after the rename is not redundant. The rename carries the TEMP's mode, so an old
 * 0644 file cannot leave its mode behind — and the line is here anyway, said out loud, because a
 * future writer that stops using a temp would otherwise inherit the old file's permissions
 * silently.
 *
 * NOT ASSERTED BY ANY TEST: whether either `fsyncSync` call below actually reaches disk. Nothing
 * observable from a test distinguishes a synced write from an unsynced one without a real power
 * cut, so durability across a crash rests on reading this function.
 */
function performAtomicWrite(home: string, sound: OAuthFile, verifyOwnership: () => void): void {
  const target = oauthPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify(
    {
      version: 1,
      clients: sound.clients,
      grants: sound.grants,
      tokens: sound.tokens,
    },
    null,
    2,
  )}\n`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      // `writeFileSync` given a FILE DESCRIPTOR loops until every byte is written.
      // `writeSync(fd, body)` binds directly to the `write` syscall and returns a byte count that
      // can be short of the whole string — rare for a local regular file, but a short write here
      // would fsync and rename a truncated JSON body over a good one, and there is no recovery
      // once that lands.
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    // A throw anywhere above (open, write, fsync) leaves the temp orphaned unless this cleans it
    // up — and this temp's body is the connector's actor seed in plaintext.
    rmSync(temp, { force: true });
    throw err;
  }
  try {
    verifyOwnership();
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  try {
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
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

/**
 * VALIDATES `file` WITH THE SAME CHECKS `readOAuthFile` RUNS, before anything is serialized
 * (criterion (q)). Without this, a bug in a future caller could persist a value that fails those
 * checks, and every later read would throw `OAuthFileUnreadable` with nothing on disk left able to
 * repair it — the self-inflicted twin of the hazard read-time validation exists to catch.
 *
 * No ownership check: this is the no-lock-context write, used directly by a caller that already
 * holds exclusivity some other way (or by a test). `withOAuthFile` below has its own call into
 * `performAtomicWrite` carrying a real check.
 */
export function writeOAuthFile(home: string, file: OAuthFile): void {
  const sound = checkFileShape(file, oauthPath(home));
  performAtomicWrite(home, sound, () => {});
}

// --- the cross-process lock ---------------------------------------------------------------------

export const oauthLockPath = (home: string): string => join(home, "oauth.json.lock");

/** How long a held lock may be before a later writer treats it as a crashed one and breaks it. */
export const LOCK_STALE_MS = 30_000;

/**
 * How long a writer waits for a LIVE lock before giving up.
 *
 * Deliberately short, and the reason is that the waiting is SYNCHRONOUS: in the serving process
 * this thread is the whole server, so a contended acquire serves no other request while it waits.
 * Every honest hold is a few microseconds — `work` cannot await — so real contention clears in
 * milliseconds and this bound is never reached in ordinary use. What it bounds is a holder killed
 * within the staleness window, where the trade is a short refusal over a long stall on a door an
 * anonymous caller can knock on.
 */
const LOCK_WAIT_MS = 2_000;

/** How long a contended writer waits between attempts. */
const POLL_MS = 25;

/** The lock is held by another process, or was taken from us. Never a licence to write anyway. */
export class OAuthFileBusy extends Error {}

/**
 * The lock cannot be TAKEN here at all — the home's filesystem refuses the operation the lock is
 * built from. Distinct from `OAuthFileBusy`, which means somebody else holds it: this one means
 * nobody ever can, and no amount of retrying will change it.
 */
export class OAuthFileUnlockable extends Error {}

// A SYNCHRONOUS sleep, because the whole point is that no other work in this process interleaves
// with a held lock. `Atomics.wait` on a private buffer parks the thread without a busy loop.
const pause = (ms: number): void => {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
};

export interface OAuthWrite<T> {
  /** The file to write, or absent to read without writing. */
  readonly next?: OAuthFile | undefined;
  readonly result: T;
}

/** Whose lock is this? An empty string for a lock file we cannot read. */
const lockHolder = (lock: string): string => {
  try {
    return readFileSync(lock, "utf8");
  } catch {
    return "";
  }
};

/**
 * A lock file whose CONTENT is our nonce the instant it appears, or false if someone holds it.
 *
 * The nonce is written to a private temp file FIRST and the lock is then hard-linked from it.
 * `link` is atomic and fails if the target exists, so there is no window in which the lock exists
 * without its owner's name inside — which is what makes reading the name a sound ownership test
 * everywhere below. `open(…, "wx")` cannot give that: it creates an EMPTY file, and the write is a
 * second step.
 */
const claimLock = (lock: string, nonce: string): boolean => {
  const temp = `${lock}.${process.pid}-${randomBytes(8).toString("hex")}.claim`;
  // ONE `finally` over the whole body, so the temp cannot outlive a throw from any step in it.
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      // `writeFileSync` on a FD loops until the whole buffer lands — the same reason
      // `performAtomicWrite` uses it rather than the raw `writeSync` binding. A short write here
      // is worse than in the main file: the truncated nonce still gets hard-linked as a LIVE lock,
      // so `verifyOwnership` never matches it, and the release in `withOAuthFile`'s `finally`
      // refuses to delete a lock it does not recognize as its own — orphaning it for the full
      // `LOCK_STALE_MS` window instead of merely failing this one write.
      writeFileSync(fd, nonce);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, lock);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false; // somebody holds it; the caller decides whether to wait
      // ANY OTHER FAILURE IS DIAGNOSED HERE, because hard links are the one thing this file needs
      // that an ordinary writable directory may not provide — FAT and exFAT volumes, some SMB and
      // FUSE mounts. Left raw, it reaches a caller that reports "cannot read its connector
      // records", which sends the operator to the wrong subsystem while every connector write is
      // dead.
      throw new OAuthFileUnlockable(
        `${lock} could not be created as a hard link (${String(code)}). The connector records ` +
          `need a home on a filesystem that supports hard links; FAT, exFAT and some network ` +
          `mounts do not. Move the loam home onto a local filesystem.`,
      );
    }
  } finally {
    rmSync(temp, { force: true });
  }
};

/**
 * Run `work` against `oauth.json` and write what it returns, with THE WRITE exclusive against
 * every other process. Returning `undefined` for `next` reads without writing.
 *
 * `work` is SYNCHRONOUS by signature, and that is load-bearing: `work` must be a pure function of
 * the file it is handed — a lock held across an await would hold a cross-process lock across work
 * of unbounded length, and a callback with a side effect outside its return value would run twice
 * whenever a stale-break race puts two callers inside it at once (see below).
 *
 * Ownership is proven by CONTENT throughout — `claimLock` makes the lock and its owner's name
 * appear together in one atomic step, the check repeats immediately before the RENAME (inside
 * `performAtomicWrite`, after the temp is fsynced — see that function for why the check sits
 * there and not earlier), and the release removes the lock only while the name is still ours.
 * `claimLock` runs ONLY in the acquire loop below; nothing re-acquires the lock afterward, so the
 * pre-rename check either finds this call's own nonce (rename proceeds) or it does not (write
 * refused) — there is no third path.
 *
 * THE GUARANTEE IS ABOUT THE WRITE, NOT ABOUT `work`. FOUR windows are check-then-act, inherent to
 * advisory locking with no compare-and-swap, and three of the four are races between two OTHER
 * writers — never a chance for THIS call to resume and overwrite a write that already landed:
 *
 *   - the check-before-rename is check-then-act. A theft landing between reading the lock's
 *     content and the rename syscall is not caught — but that gap is now two synchronous
 *     statements wide, because the disk work (temp write, fsync) that could otherwise stall for a
 *     long time all happens BEFORE this check runs. Closing it fully needs a compare-and-swap the
 *     filesystem does not offer; what is achievable without one is making the gap syscall-sized
 *     rather than disk-I/O-sized, which this ordering does.
 *   - the RELEASE is check-then-act: between reading our own name and removing the file, a thief
 *     that broke our lock (after we already wrote) can claim it, and we then delete its lock
 *     rather than ours. That thief's OWN pre-rename check runs the identical test against
 *     whatever the lock file holds by the time IT reaches the rename, so a lock lost this way
 *     costs that thief a refusal, never a silent overwrite.
 *   - the STALE BREAK is check-then-act: `statSync` reads an age and `rmSync` acts on it, and
 *     between the two the holder can release and a third party can claim, so the breaker can
 *     delete a fresh live lock it never judged stale, and that third party simply retries.
 *   - a holder paused longer than `LOCK_STALE_MS` and then killed has its lock broken and its
 *     write never happens at all — a crashed writer must not wedge the operator out of their own
 *     store forever.
 */
export function withOAuthFile<T>(home: string, work: (file: OAuthFile) => OAuthWrite<T>): T {
  const lock = oauthLockPath(home);
  const nonce = `${process.pid}:${randomBytes(16).toString("hex")}\n`;
  const waitedFrom = Date.now();
  const busy = (): OAuthFileBusy =>
    new OAuthFileBusy(
      `${lock} is held by another process, so this change was not made. Retry, or remove that ` +
        `file if no loam process is running.`,
    );

  // EVERY path through this loop either makes progress or pauses, and all of them are bounded by
  // the deadline. An unbounded spin here runs on the server's only thread: a dangling SYMLINK at
  // the lock path is enough to reach one, since the link fails EEXIST whatever the target while
  // `statSync` follows it and throws.
  while (!claimLock(lock, nonce)) {
    if (Date.now() - waitedFrom > LOCK_WAIT_MS) throw busy();
    let heldSince: number;
    try {
      heldSince = statSync(lock).mtimeMs;
    } catch {
      pause(POLL_MS); // it went away, or it is a dangling symlink; either way do not spin
      continue;
    }
    // A crashed holder: free it and retry AT ONCE, which is the fastest recovery. At most one
    // unpaused pass per stale lock — losing that race leaves a fresh holder, and the next pass
    // pauses.
    if (Date.now() - heldSince > LOCK_STALE_MS) rmSync(lock, { force: true });
    else pause(POLL_MS);
  }

  try {
    const outcome = work(readOAuthFile(home));
    if (outcome.next !== undefined) {
      const sound = checkFileShape(outcome.next, oauthPath(home));
      // The ownership check lives INSIDE `performAtomicWrite`, after the temp is written and
      // fsynced and immediately before the rename — not here, before any of that disk work runs.
      // See that function's doc comment for why the placement is load-bearing.
      performAtomicWrite(home, sound, () => {
        if (lockHolder(lock) !== nonce) throw busy();
      });
    }
    return outcome.result;
  } finally {
    // Only while it is still ours: a writer that lost the lock must not delete its successor's.
    if (lockHolder(lock) === nonce) rmSync(lock, { force: true });
  }
}

export const clientFor = (file: OAuthFile, clientId: string): OAuthClient | undefined =>
  file.clients.find((c) => c.clientId === clientId);

export const grantFor = (file: OAuthFile, clientId: string): OAuthGrant | undefined =>
  file.grants.find((g) => g.clientId === clientId);
