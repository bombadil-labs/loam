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

export interface OAuthClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly registeredAt: number;

  readonly generation: number;
}

export interface OAuthGrant {
  readonly clientId: string;
  readonly actorSeed: string;
  readonly actor: string;
  readonly grantedAt: number;

  readonly standing: boolean;

  readonly grantDeltaId?: string;

  readonly user?: string;
  readonly container?: string;
  readonly inbox?: string;
}

export interface OAuthRevocation {
  readonly clientId: string;
  readonly actor: string;
  readonly revokedAt: number;
}

export interface OAuthToken {
  readonly digest: string;
  readonly clientId: string;
  readonly issuedAt: number;

  readonly generation?: number;

  readonly user?: string;
}

export interface OAuthCode {
  readonly digest: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
  readonly issuedAt: number;

  readonly codeChallenge?: string;

  readonly generation?: number;

  readonly user?: string;
  readonly container?: string;
}

export interface OAuthFile {
  readonly version: 1;
  readonly clients: readonly OAuthClient[];
  readonly grants: readonly OAuthGrant[];
  readonly tokens: readonly OAuthToken[];
  readonly codes?: readonly OAuthCode[];
  readonly revoked?: readonly OAuthRevocation[];
}

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

const optGeneration = (raw: unknown, where: string, field: string): number | undefined => {
  const value = (raw as Record<string, unknown>)[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new OAuthFileUnreadable(`${where} has a ${field} that is not a positive integer`);
  }
  return value;
};

const object = (raw: unknown, where: string): void => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OAuthFileUnreadable(`${where} is not an object`);
  }
};

const array = (raw: unknown, where: string): unknown[] => {
  if (!Array.isArray(raw)) throw new OAuthFileUnreadable(`${where} is not an array`);
  return raw;
};

export const MAX_CLIENT_NAME = 200;

export const CONTROL = (text: string): boolean =>
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

export const uriTextDefect = (uri: string): string | undefined =>
  CONTROL(uri)
    ? "a redirect_uri carries no control character, escape, or line separator"
    : undefined;

export const idTextDefect = (id: string): string | undefined =>
  CONTROL(id) ? "a client_id carries no control character, escape, or line separator" : undefined;

function checkClient(raw: unknown, where: string): OAuthClient {
  object(raw, where);
  const uris = array((raw as Record<string, unknown>)["redirectUris"], `${where}: redirectUris`);
  const clientName = str(raw, where, "clientName");
  const defect = clientNameDefect(clientName);
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
  if (actor !== authorForSeed(actorSeed)) {
    throw new OAuthFileUnreadable(`${where} names an actor its own seed does not derive`);
  }
  const standing = (raw as Record<string, unknown>)["standing"];
  if (typeof standing !== "boolean") {
    throw new OAuthFileUnreadable(`${where} does not say whether its grant has standing`);
  }
  const rawGrantDeltaId = (raw as Record<string, unknown>)["grantDeltaId"];
  if (
    rawGrantDeltaId !== undefined &&
    (typeof rawGrantDeltaId !== "string" || rawGrantDeltaId === "")
  ) {
    throw new OAuthFileUnreadable(`${where} has a grantDeltaId that is not a non-empty string`);
  }
  const user = optPlainName(raw, where, "user");
  const container = optPlainName(raw, where, "container");
  const inbox = optPlainName(raw, where, "inbox");
  return {
    clientId: str(raw, where, "clientId"),
    actorSeed,
    actor,
    grantedAt: num(raw, where, "grantedAt"),
    standing,
    ...(rawGrantDeltaId === undefined ? {} : { grantDeltaId: rawGrantDeltaId }),
    ...(user === undefined ? {} : { user }),
    ...(container === undefined ? {} : { container }),
    ...(inbox === undefined ? {} : { inbox }),
  };
}

function optPlainName(raw: unknown, where: string, field: string): string | undefined {
  const value = (raw as Record<string, unknown>)[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new OAuthFileUnreadable(`${where} has a ${field} that is not a non-empty string`);
  }
  if (CONTROL(value)) {
    throw new OAuthFileUnreadable(`${where} has a ${field} carrying a control character`);
  }
  return value;
}

function checkToken(raw: unknown, where: string): OAuthToken {
  object(raw, where);
  const digest = str(raw, where, "digest");
  if (!HEX64.test(digest)) {
    throw new OAuthFileUnreadable(`${where} has a digest that is not a sha-256 hex digest`);
  }
  const generation = optGeneration(raw, where, "generation");
  const user = optPlainName(raw, where, "user");
  return {
    digest,
    clientId: str(raw, where, "clientId"),
    issuedAt: num(raw, where, "issuedAt"),
    ...(generation === undefined ? {} : { generation }),
    ...(user === undefined ? {} : { user }),
  };
}

function checkCode(raw: unknown, where: string): OAuthCode {
  object(raw, where);
  const digest = str(raw, where, "digest");
  if (!HEX64.test(digest)) {
    throw new OAuthFileUnreadable(`${where} has a digest that is not a sha-256 hex digest`);
  }
  const redirectUri = str(raw, where, "redirectUri");
  const defect = uriTextDefect(redirectUri);
  if (defect !== undefined) throw new OAuthFileUnreadable(`${where}: ${defect}`);
  const rawChallenge = (raw as Record<string, unknown>)["codeChallenge"];
  if (rawChallenge !== undefined && typeof rawChallenge !== "string") {
    throw new OAuthFileUnreadable(`${where} has a codeChallenge that is not a string`);
  }
  if (typeof rawChallenge === "string" && CONTROL(rawChallenge)) {
    throw new OAuthFileUnreadable(`${where} has a codeChallenge carrying a control character`);
  }
  const generation = optGeneration(raw, where, "generation");
  const optName = (field: "user" | "container"): string | undefined => {
    const value = (raw as Record<string, unknown>)[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length === 0) {
      throw new OAuthFileUnreadable(`${where} has a ${field} that is not a non-empty string`);
    }
    if (CONTROL(value)) {
      throw new OAuthFileUnreadable(`${where} has a ${field} carrying a control character`);
    }
    return value;
  };
  const user = optName("user");
  const container = optName("container");
  return {
    digest,
    clientId: str(raw, where, "clientId"),
    redirectUri,
    expiresAt: num(raw, where, "expiresAt"),
    issuedAt: num(raw, where, "issuedAt"),
    ...(rawChallenge === undefined ? {} : { codeChallenge: rawChallenge }),
    ...(generation === undefined ? {} : { generation }),
    ...(user === undefined ? {} : { user }),
    ...(container === undefined ? {} : { container }),
  };
}

function checkRevocation(raw: unknown, where: string): OAuthRevocation {
  object(raw, where);
  if ((raw as Record<string, unknown>)["actorSeed"] !== undefined) {
    throw new OAuthFileUnreadable(
      `${where} carries an actorSeed — revoking a connector destroys its key, and this file never ` +
        `keeps one for an identity that may no longer act`,
    );
  }
  const actor = str(raw, where, "actor");
  if (CONTROL(actor)) {
    throw new OAuthFileUnreadable(`${where} has an actor carrying a control character`);
  }
  return {
    clientId: str(raw, where, "clientId"),
    actor,
    revokedAt: num(raw, where, "revokedAt"),
  };
}

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

function checkUnique(keys: readonly string[], where: string, field: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new OAuthFileUnreadable(`${where} has more than one ${field} ${key}`);
    seen.add(key);
  }
}

function checkFileShape(parsed: unknown, where: string): OAuthFile {
  object(parsed, where);
  const file = parsed as Record<string, unknown>;
  if (file["version"] !== 1) {
    throw new OAuthFileUnreadable(
      `${where} is version ${String(file["version"])}, and this reader reads version 1`,
    );
  }
  const clients = Array.from(array(file["clients"], `${where}: clients`), (c, i) =>
    checkClient(c, `${where}: client ${i}`),
  );
  const grants = Array.from(array(file["grants"], `${where}: grants`), (g, i) =>
    checkGrant(g, `${where}: grant ${i}`),
  );
  const tokens = Array.from(array(file["tokens"], `${where}: tokens`), (t, i) =>
    checkToken(t, `${where}: token ${i}`),
  );
  const codesRaw = file["codes"];
  const codes =
    codesRaw === undefined
      ? undefined
      : Array.from(array(codesRaw, `${where}: codes`), (c, i) =>
          checkCode(c, `${where}: code ${i}`),
        );
  const revokedRaw = file["revoked"];
  const revoked =
    revokedRaw === undefined
      ? undefined
      : Array.from(array(revokedRaw, `${where}: revoked`), (r, i) =>
          checkRevocation(r, `${where}: revocation ${i}`),
        );
  checkUnique(
    clients.map((c) => c.clientId),
    where,
    "client with clientId",
  );
  checkUnique(
    grants.map((g) => JSON.stringify([g.clientId, g.user ?? null])),
    where,
    "grant for the pair [clientId, user]",
  );
  checkUnique(
    tokens.map((t) => t.digest),
    where,
    "token with digest",
  );
  if (codes !== undefined) {
    checkUnique(
      codes.map((c) => c.digest),
      where,
      "code with digest",
    );
  }
  if (revoked !== undefined) {
    checkUnique(
      revoked.map((r) => r.actor),
      where,
      "revocation with actor",
    );
  }
  return {
    version: 1,
    clients,
    grants,
    tokens,
    ...(codes === undefined ? {} : { codes }),
    ...(revoked === undefined ? {} : { revoked }),
  };
}

function performAtomicWrite(home: string, sound: OAuthFile, verifyOwnership: () => void): void {
  const target = oauthPath(home);
  const temp = `${target}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify(
    {
      version: 1,
      clients: sound.clients,
      grants: sound.grants,
      tokens: sound.tokens,
      ...(sound.codes === undefined ? {} : { codes: sound.codes }),
      ...(sound.revoked === undefined ? {} : { revoked: sound.revoked }),
    },
    null,
    2,
  )}\n`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
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
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {}
}

export function writeOAuthFile(home: string, file: OAuthFile): void {
  const sound = checkFileShape(file, oauthPath(home));
  performAtomicWrite(home, sound, () => {});
}

export const oauthLockPath = (home: string): string => join(home, "oauth.json.lock");

export const LOCK_STALE_MS = 30_000;

const LOCK_WAIT_MS = 2_000;

const POLL_MS = 25;

export class OAuthFileBusy extends Error {}

export class OAuthFileUnlockable extends Error {}

const pause = (ms: number): void => {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
};

export interface OAuthWrite<T> {
  readonly next?: OAuthFile | undefined;
  readonly result: T;
}

const lockHolder = (lock: string): string => {
  try {
    return readFileSync(lock, "utf8");
  } catch {
    return "";
  }
};

const claimLock = (lock: string, nonce: string): boolean => {
  const temp = `${lock}.${process.pid}-${randomBytes(8).toString("hex")}.claim`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, nonce);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, lock);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
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

export function withOAuthFile<T>(home: string, work: (file: OAuthFile) => OAuthWrite<T>): T {
  const lock = oauthLockPath(home);
  const nonce = `${process.pid}:${randomBytes(16).toString("hex")}\n`;
  const waitedFrom = Date.now();
  const busy = (): OAuthFileBusy =>
    new OAuthFileBusy(
      `${lock} is held by another process, so this change was not made. Retry, or remove that ` +
        `file if no loam process is running.`,
    );

  while (!claimLock(lock, nonce)) {
    if (Date.now() - waitedFrom > LOCK_WAIT_MS) throw busy();
    let heldSince: number;
    try {
      heldSince = statSync(lock).mtimeMs;
    } catch {
      pause(POLL_MS);
      continue;
    }
    if (Date.now() - heldSince > LOCK_STALE_MS) rmSync(lock, { force: true });
    else pause(POLL_MS);
  }

  try {
    const outcome = work(readOAuthFile(home));
    if (outcome.next !== undefined) {
      const sound = checkFileShape(outcome.next, oauthPath(home));
      performAtomicWrite(home, sound, () => {
        if (lockHolder(lock) !== nonce) throw busy();
      });
    }
    return outcome.result;
  } finally {
    if (lockHolder(lock) === nonce) rmSync(lock, { force: true });
  }
}

export const clientFor = (file: OAuthFile, clientId: string): OAuthClient | undefined =>
  file.clients.find((c) => c.clientId === clientId);

export const grantFor = (
  file: OAuthFile,
  clientId: string,
  user?: string,
): OAuthGrant | undefined => file.grants.find((g) => g.clientId === clientId && g.user === user);

export const grantsFor = (file: OAuthFile, clientId: string): OAuthGrant[] =>
  file.grants.filter((g) => g.clientId === clientId);

export const revocationsFor = (file: OAuthFile, clientId: string): OAuthRevocation[] =>
  (file.revoked ?? [])
    .filter((r) => r.clientId === clientId)
    .sort((a, b) => a.revokedAt - b.revokedAt || a.actor.localeCompare(b.actor));

export const tokenFor = (file: OAuthFile, digest: string): OAuthToken | undefined =>
  file.tokens.find((t) => t.digest === digest);

export const codeFor = (file: OAuthFile, digest: string): OAuthCode | undefined =>
  (file.codes ?? []).find((c) => c.digest === digest);
