// `clients.json` (SPEC §57): the record half of a minted client credential — the name, the
// PUBLIC author, and the sha-256 digest of the bearer `loam client mint` printed once. The
// signing seed is NOT here: it lives beside this file as `client.<name>.seed` (0600, the
// `user.<name>.seed` convention), so listing what exists never touches a secret.
//
// The door reads this file PER REQUEST (http.ts's identify), which is the token half of §57's
// freshness split: a mint authenticates and a revoke refuses on the very next request, no
// restart — while the GRANTS the mint appended live in the served reactor from boot and move at
// restart. The two halves are stated apart wherever either surfaces.
//
// oauth-file.ts's two reading rules hold here verbatim: a file this module cannot fully parse
// means it CANNOT DETERMINE what is minted — it throws, and every caller refuses ("cannot
// determine" is never "nothing is"). Unlike oauth.json there is no cross-process lock: the
// server only ever READS this file, and both writers are CLI invocations by the operator's own
// hand — the PKCE dance that made oauth.json's server a concurrent writer has no analogue here.
// The write is still atomic (tmp + rename), so a reader never sees half a file.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One minted client: its name, its public author, and the digest its bearer hashes to. */
export interface ClientRecord {
  readonly name: string;
  /** sha-256 hex of the bearer — the bearer itself is printed once at mint and never stored. */
  readonly digest: string;
  /** The client's PUBLIC author — what its deltas name. Never the seed. */
  readonly actor: string;
  readonly mintedAt: number; // wall clock, for `loam client` listings to come
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
    if (typeof c.mintedAt !== "number") fail(`client "${String(c.name)}" has no mintedAt`);
  }
  return file as unknown as ClientsFile;
}

/** Absent is EMPTY (a home that never minted is ordinary); malformed THROWS (rule 1 above). */
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

/** The client's signing seed, read from its own 0600 file. Throws when unreadable — the door
 *  catches and refuses, the CLI reports; neither guesses. */
export function readClientSeed(home: string, name: string): string {
  return readFileSync(clientSeedPath(home, name), "utf8").trim();
}
