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
// WHAT THIS FILE DOES NOT GUARD: two PROCESSES writing it. The write is atomic, so no reader ever
// sees half a file, but `loam grant revoke` in one process and a token mint in the server are a
// read-modify-write pair with no lock between them, and the loser's change is lost. The server
// serialises its own writes (oauth.ts); across processes the operator is one person at a keyboard,
// and a lock file is its own ticket rather than a line here.

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
import { authorForSeed } from "@bombadil/rhizomatic";

/** A dynamically registered client (RFC 7591). No secret: these are public clients. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly registeredAt: number; // wall clock, for `loam grant list`
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

function checkClient(raw: unknown, where: string): OAuthClient {
  object(raw, where);
  const uris = array((raw as Record<string, unknown>)["redirectUris"], `${where}: redirectUris`);
  return {
    clientId: str(raw, where, "clientId"),
    clientName: str(raw, where, "clientName"),
    redirectUris: uris.map((uri, i) => {
      if (typeof uri !== "string" || uri === "") {
        throw new OAuthFileUnreadable(`${where}: redirect uri ${i} is not a string`);
      }
      return uri;
    }),
    registeredAt: num(raw, where, "registeredAt"),
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
  return {
    clientId: str(raw, where, "clientId"),
    actorSeed,
    actor,
    grantedAt: num(raw, where, "grantedAt"),
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

export const clientFor = (file: OAuthFile, clientId: string): OAuthClient | undefined =>
  file.clients.find((c) => c.clientId === clientId);

export const grantFor = (file: OAuthFile, clientId: string): OAuthGrant | undefined =>
  file.grants.find((g) => g.clientId === clientId);
