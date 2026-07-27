// `oauth.json` (SPEC §37): the durable half of a connector grant — registered clients, the actor seed
// each connector signs with, and the digests of the tokens that reach it.
//
// It lives in the home, mode 0600, beside the operator seed and credentials.json. It is NEVER in the
// ground, for the same reason a password hash is not: the ground REPLICATES, and a federated peer
// would receive a connector's signing key. This file holds the most dangerous secret in the home
// after the operator seed itself.
//
// The two H7 rules from credentials.ts hold here verbatim, and the second one is what makes them
// worth restating:
//
//   1. A file this module cannot fully parse means it CANNOT DETERMINE what is registered. "Cannot
//      determine" is never "nothing is". It throws, and every door refuses.
//   2. Validation covers the WHOLE file. A damaged grant means the file's shape is unknown, and an
//      unknown shape is not one to mint against — because the specific failure of treating a bad file
//      as empty is minting a SECOND seed for a connector that already has one, leaving the first
//      grant standing in the ground with nobody holding its key.
//
// A grant's `actor` is checked against `authorForSeed(actorSeed)` on the way in. It is a cache of a
// derivation, and a cache that disagrees with its source is how a `grant list` comes to name one
// author while the store's deltas name another.
//
// EVERY READ-MODIFY-WRITE GOES THROUGH `withOAuthFile`, AND THAT IS A CROSS-PROCESS LOCK.
//
// The write itself is atomic, so no reader ever sees half a file — and that is not the property this
// needs. `loam grant revoke` runs in a DIFFERENT process from the server, and the two are a
// read-modify-write pair: whoever writes second spreads a snapshot taken before the other's change
// and silently discards it. The tempting argument is that the operator is one person at a keyboard, so
// the two never overlap. That argument is wrong, and the counterexample needs only two connectors:
//
//   - the server is minting a first token for connector D, and holds the file's contents while it
//     awaits the operator-signed grant append for D;
//   - the operator revokes connector C in the meantime, and the CLI reports it done;
//   - the server writes its snapshot, and C's revoked token is back in the table with C's generation
//     bump gone — so C's codes mint again too, while the CLI has already claimed otherwise.
//
// The mirror ordering is worse: the CLI's write lands second and erases D's grant record while the
// ground already holds D's write grant, so the next redemption mints a SECOND seed for one connector
// and strands the first — the exact outcome `standing` exists to prevent. Both are H7 at the process
// layer against criterion (v)'s own promise, so the lock is not an optimisation.
//
// The lock is an `O_CREAT|O_EXCL` file, held for the whole read-modify-write, and the callback it wraps
// is SYNCHRONOUS on purpose: an await inside would hold a cross-process lock across work of unbounded
// length. The server's ground append therefore happens BETWEEN two locked phases rather than inside
// one (oauth.ts, `mintToken`).

import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { authorForSeed } from "@bombadil/rhizomatic";

/** A dynamically registered client (RFC 7591). No secret: these are public clients. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly registeredAt: number; // wall clock, for `loam grant list`
  /**
   * BUMPED BY EVERY REVOCATION, and it is what makes revocation reach a code already in flight.
   *
   * An authorization code lives in the serving process's memory for five minutes; `loam grant revoke`
   * runs in another process and cannot touch that map. Without this, a code minted a moment before the
   * revoke would mint a fresh working token a moment after it, and the CLI's report that the next
   * request is refused would be false. So a code records the generation it was minted under, and the
   * token endpoint refuses one whose generation has moved.
   */
  readonly generation: number;
}

/**
 * One connector's own signing identity. `actorSeed` is the secret; `actor` is the public author every
 * delta the connector writes carries. One connector, one seed, for the life of the home — a re-grant
 * reuses it, so the connector's history stays under one author.
 */
export interface OAuthGrant {
  readonly clientId: string;
  readonly actorSeed: string; // 64 hex
  readonly actor: string;
  readonly grantedAt: number;
  /**
   * Has the operator-signed write grant actually LANDED in the ground?
   *
   * The seed is recorded BEFORE the grant is appended, so this file is the one place that says which
   * seed a connector owns and can never grow a second one. That ordering leaves exactly one recoverable
   * gap — a seed recorded whose grant never landed — and this flag names it, so the next redemption
   * re-appends for the SAME seed instead of minting another. Recording the seed after the append would
   * leave the opposite gap, which is not recoverable: a grant standing in the ground for a key nobody
   * holds, and a second seed minted beside it.
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

/** The door could not decide what is registered. Never a licence to mint. */
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

const object = (raw: unknown, where: string): Record<string, unknown> => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OAuthFileUnreadable(`${where} is not an object`);
  }
  return raw as Record<string, unknown>;
};

const array = (raw: unknown, where: string): unknown[] => {
  if (!Array.isArray(raw)) throw new OAuthFileUnreadable(`${where} is not an array`);
  return raw;
};

/**
 * A client name reaches the operator's TERMINAL, through `loam grant list`, and registration takes no
 * credential — so any caller on the internet writes this string. A newline in it forges a whole extra
 * row in that listing; an ANSI escape erases the caller's own. It is the operator's only view of what
 * is registered, so the name is held to printable characters with no control bytes at all.
 */
export const MAX_CLIENT_NAME = 200;

/**
 * C0, DEL and C1, plus the two Unicode separators a terminal also breaks a line on.
 *
 * EVERY caller-supplied string that reaches `loam grant list` is held to this, and there are two of
 * them: the client name AND each redirect uri. The uri is the one that hides — `new URL()` STRIPS tab,
 * LF and CR while parsing, so a uri carrying them parses clean, passes the origin and
 * percent-transparency checks, and keeps its raw bytes in the stored string. The operator's only view
 * of what is registered is where they decide what to revoke, so a forged row there is worth refusing
 * at the door rather than escaping at the printer.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const clientNameDefect = (name: string): string | undefined => {
  if (name.length === 0 || name.length > MAX_CLIENT_NAME) {
    return `a client_name is 1..${MAX_CLIENT_NAME} characters`;
  }
  if (CONTROL.test(name)) {
    return "a client_name carries no control character, escape, or line separator";
  }
  return undefined;
};

/** The same rule for a redirect uri, which reaches the same listing. */
export const uriTextDefect = (uri: string): string | undefined =>
  CONTROL.test(uri)
    ? "a redirect_uri carries no control character, escape, or line separator"
    : undefined;

function checkClient(raw: unknown, where: string): OAuthClient {
  object(raw, where);
  const uris = array((raw as Record<string, unknown>)["redirectUris"], `${where}: redirectUris`);
  const clientName = str(raw, where, "clientName");
  const defect = clientNameDefect(clientName);
  // Checked on the way IN as well as on the way out: a file edited by hand, or written by an older
  // build, must not be able to smuggle a forged row into the operator's listing.
  if (defect !== undefined) throw new OAuthFileUnreadable(`${where}: ${defect}`);
  const generation = num(raw, where, "generation");
  if (!Number.isInteger(generation) || generation < 1) {
    throw new OAuthFileUnreadable(`${where} has a generation that is not a positive integer`);
  }
  return {
    clientId: str(raw, where, "clientId"),
    clientName,
    redirectUris: uris.map((uri, i) => {
      if (typeof uri !== "string" || uri === "") {
        throw new OAuthFileUnreadable(`${where}: redirect uri ${i} is not a string`);
      }
      // Symmetric with the name above, and for the same reason: a file edited by hand must not be
      // able to smuggle a forged row into the operator's listing either.
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
  // The cache must agree with its source, or `grant list` names one author while the ground holds
  // another — and a revocation would be reported against an identity nobody signed with.
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
 * The whole file, checked. An ABSENT file is an empty one — a home with no connectors is not damaged.
 * Anything present but unparseable throws `OAuthFileUnreadable`.
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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OAuthFileUnreadable(`${path} is not a connector file`);
  }
  const file = parsed as Record<string, unknown>;
  if (file["version"] !== 1) {
    throw new OAuthFileUnreadable(
      `${path} is version ${String(file["version"])}, and this door reads version 1`,
    );
  }
  return {
    version: 1,
    clients: array(file["clients"], `${path}: clients`).map((c, i) =>
      checkClient(c, `${path}: client ${i}`),
    ),
    grants: array(file["grants"], `${path}: grants`).map((g, i) =>
      checkGrant(g, `${path}: grant ${i}`),
    ),
    tokens: array(file["tokens"], `${path}: tokens`).map((t, i) =>
      checkToken(t, `${path}: token ${i}`),
    ),
  };
}

/**
 * Write the file whole: a fresh 0600 temp beside it, fsync, rename, fsync the directory. The temp name
 * carries the pid and random bytes so two writers never collide on it.
 *
 * The `chmodSync` after the rename is not redundant. The rename carries the TEMP's mode, so an old
 * 0644 file cannot leave its mode behind — and the line is here anyway, said out loud, because a
 * future writer that stops using a temp would otherwise inherit the old file's permissions silently.
 */
export function writeOAuthFile(home: string, file: OAuthFile): void {
  const target = oauthPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify(
    {
      version: 1,
      clients: file.clients,
      grants: file.grants,
      tokens: file.tokens,
    },
    null,
    2,
  )}\n`;
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

// --- the cross-process lock ---------------------------------------------------------------------

export const oauthLockPath = (home: string): string => join(home, "oauth.json.lock");

/** How long a held lock may be before a later writer treats it as a crashed one and breaks it. */
export const LOCK_STALE_MS = 30_000;
/** How long a writer waits for the lock before giving up. Longer than any honest hold. */
const LOCK_WAIT_MS = 10_000;

/** The lock is held and not stale. Never a licence to write anyway. */
export class OAuthFileBusy extends Error {}

// A SYNCHRONOUS sleep, because the whole point is that no other work in this process interleaves with
// a held lock. `Atomics.wait` on a private buffer parks the thread without a busy loop.
const pause = (ms: number): void => {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
};

/**
 * Run `work` with `oauth.json` locked against every other process, and write what it returns.
 *
 * `work` is SYNCHRONOUS by signature, and that is the load-bearing part: a lock held across an await
 * is a lock held for an unbounded time, and a caller that needs to await something does it between two
 * calls to this rather than inside one. Returning `undefined` for `next` reads without writing.
 *
 * A lock older than `LOCK_STALE_MS` is broken and taken, because a crashed writer must not wedge the
 * operator out of their own store forever. That is a real trade: a writer paused longer than the
 * staleness window can have its lock stolen. It is bounded by making every hold short — which the
 * synchronous signature is what enforces.
 */
export interface OAuthWrite<T> {
  /** The file to write, or absent to read without writing. */
  readonly next?: OAuthFile | undefined;
  readonly result: T;
}

export function withOAuthFile<T>(home: string, work: (file: OAuthFile) => OAuthWrite<T>): T {
  const lock = oauthLockPath(home);
  const waitedFrom = Date.now();
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lock, "wx", 0o600);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let heldSince: number;
      try {
        heldSince = statSync(lock).mtimeMs;
      } catch {
        continue; // it went away between the open and the stat: try to take it
      }
      if (Date.now() - heldSince > LOCK_STALE_MS) {
        // A crashed writer. Remove and retry; if two writers race to break it, one wins the open.
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() - waitedFrom > LOCK_WAIT_MS) {
        throw new OAuthFileBusy(
          `${lock} is held by another process, so this change was not made. Retry, or remove that ` +
            `file if no loam process is running.`,
        );
      }
      pause(25);
    }
  }
  try {
    const outcome = work(readOAuthFile(home));
    if (outcome.next !== undefined) writeOAuthFile(home, outcome.next);
    return outcome.result;
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

export const clientFor = (file: OAuthFile, clientId: string): OAuthClient | undefined =>
  file.clients.find((c) => c.clientId === clientId);

export const grantFor = (file: OAuthFile, clientId: string): OAuthGrant | undefined =>
  file.grants.find((g) => g.clientId === clientId);

/**
 * The grant a token digest names — the ONE read on the request path, and the reason it is not
 * `readOAuthFile`.
 *
 * `checkGrant` re-derives `authorForSeed(actorSeed)` for every grant, and that is an Ed25519 scalar
 * multiplication in pure JS. `identify` runs for any bearer token the static and session tables
 * declined — which is exactly what an anonymous caller on the public internet presents — so reading
 * the whole file there would spend N derivations per wrong guess. This finds the token first and
 * derives once, for the one grant it is about to return, so an unknown token costs zero.
 *
 * Still strict where it looks: a match whose grant is damaged throws rather than answering. And a
 * file this cannot parse throws, because a token cannot be verified against a file of unknown shape.
 *
 * What it does NOT avoid, said out loud: one `readFileSync` and one `JSON.parse` per presented token.
 * The file holds a handful of connectors, and the read is a few microseconds beside the request it
 * serves — but it is per-request work an unauthenticated caller can ask for, and a cache keyed on
 * mtime would be a stale-index trap on the exact table that decides who may write here.
 */
export function grantForToken(home: string, digest: string): OAuthGrant | undefined {
  const path = oauthPath(home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OAuthFileUnreadable(`${path} is not a connector file`);
  }
  const file = parsed as Record<string, unknown>;
  if (file["version"] !== 1) {
    throw new OAuthFileUnreadable(
      `${path} is version ${String(file["version"])}, and this door reads version 1`,
    );
  }
  const tokens = array(file["tokens"], `${path}: tokens`);
  let clientId: string | undefined;
  for (const [i, entry] of tokens.entries()) {
    const checked = checkToken(entry, `${path}: token ${i}`);
    if (checked.digest === digest) clientId = checked.clientId;
  }
  if (clientId === undefined) return undefined;
  const grants = array(file["grants"], `${path}: grants`);
  for (const [i, entry] of grants.entries()) {
    // Shape only, until the clientId matches: the derivation is what this function exists to avoid.
    const at = object(entry, `${path}: grant ${i}`);
    if (at["clientId"] === clientId) return checkGrant(entry, `${path}: grant ${i}`);
  }
  return undefined;
}
