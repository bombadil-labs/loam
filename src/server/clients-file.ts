import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClientRecord {
  readonly name: string;
  readonly digest: string;
  readonly actor: string;

  readonly store: string;
  readonly mintedAt: number;
}

export interface ClientsFile {
  readonly version: 1;
  readonly clients: readonly ClientRecord[];
}

export const EMPTY_CLIENTS: ClientsFile = { version: 1, clients: [] };

export const clientsPath = (home: string): string => join(home, "clients.json");
export const clientSeedPath = (home: string, name: string): string =>
  join(home, `client.${name}.seed`);

const DIGEST_RE = /^[0-9a-f]{64}$/;

function checkShape(raw: unknown, path: string): ClientsFile {
  const fail = (why: string): never => {
    throw new Error(`${path} is not a clients file this build can read (${why})`);
  };
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const file = raw as { version?: unknown; clients?: unknown };
  if (file.version !== 1) fail(`version ${String(file.version)}`);
  if (!Array.isArray(file.clients)) fail("clients is not a list");
  for (const entry of file.clients as unknown[]) {
    if (typeof entry !== "object" || entry === null) fail("a client entry is not an object");
    const c = entry as Record<string, unknown>;
    if (typeof c.name !== "string" || c.name.length === 0) fail("a client has no name");
    if (typeof c.digest !== "string" || !DIGEST_RE.test(c.digest)) {
      fail(`client "${String(c.name)}" carries a malformed digest`);
    }
    if (typeof c.actor !== "string" || c.actor.length === 0) {
      fail(`client "${String(c.name)}" names no author`);
    }
    if (typeof c.store !== "string" || c.store.length === 0) {
      fail(`client "${String(c.name)}" names no store`);
    }
    if (typeof c.mintedAt !== "number") fail(`client "${String(c.name)}" has no mintedAt`);
  }
  return file as unknown as ClientsFile;
}

export function readClientsFile(home: string): ClientsFile {
  const path = clientsPath(home);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_CLIENTS;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not JSON — refusing to guess what is minted`);
  }
  return checkShape(raw, path);
}

export function writeClientsFile(home: string, file: ClientsFile): void {
  const path = clientsPath(home);
  const sound = checkShape(file, path);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sound, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function readClientSeed(home: string, name: string): string {
  return readFileSync(clientSeedPath(home, name), "utf8").trim();
}
