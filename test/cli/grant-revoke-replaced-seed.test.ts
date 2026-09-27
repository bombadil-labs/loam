// `loam grant revoke` after the person's seed was replaced. What lets the connection write is a
// delegation the OLD seed signed, and only its signer or the operator can strike it, so a revoke in
// the person's current voice does not bind. The command holds the operator seed and strikes in that
// voice instead. Asked at both levels: the pool no longer lets the key write, and the report names
// the inbox it struck and exits 0.
//
// Erasure standing rule: every store here is this file's own mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, writeUserSeed } from "../../src/cli/config.js";
import { holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { EMPTY_OAUTH, writeOAuthFile } from "../../src/server/oauth-file.js";

vi.setConfig({ testTimeout: 60_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const printed = (): string => [...out, ...err].join("\n");

const CONN_SEED = "c3".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const OLD_SEED = "0a".repeat(32);
const NEW_SEED = "0b".repeat(32);
const CLIENT = "cli-claude";

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-revoke-replaced-"));
  out.length = 0;
  err.length = 0;
  expect(await run(["init", "--home", home], io())).toBe(0);
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const boot = () =>
  Gateway.boot(
    new SqliteBackend(join(home, "store.sqlite")),
    assembleGenesis({ operatorSeed: readSeed(home) }),
    { channelBackend: channelBackendFor(home, io()) },
  );

async function bindWithOldSeed(container: string): Promise<string> {
  const seed = readSeed(home);
  writeUserSeed(home, "ada", OLD_SEED);
  const gw = await boot();
  await gw.append([
    signClaims(
      containerClaims(
        {
          container,
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: authorForSeed(OLD_SEED) } },
            in: "input",
          },
        },
        authorForSeed(seed),
        600,
      ),
      seed,
    ),
  ]);
  const inbox = await gw.bindConnection({ container, connectionKey: CONN, ownerSeed: OLD_SEED });
  const name = inbox.entity!;
  await gw.close();
  return name;
}

async function poolLetsWrite(inbox: string): Promise<boolean> {
  const gw = await boot();
  const pool = gw.connectionInboxes.get(inbox)?.gateway;
  const held =
    pool !== undefined &&
    holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, CONN, "write", gw.operatorAuthor);
  await gw.close();
  return held;
}

describe("grant revoke after the person's seed was replaced", () => {
  it("strikes in the operator's voice, and the connection no longer writes", async () => {
    const inbox = await bindWithOldSeed("ada:journal");
    writeUserSeed(home, "ada", NEW_SEED); // the seed is replaced; no re-bind follows
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [
        {
          clientId: CLIENT,
          clientName: "Claude",
          redirectUris: ["https://claude.ai/cb"],
          registeredAt: 1,
          generation: 1,
        },
      ],
      grants: [
        {
          clientId: CLIENT,
          actorSeed: CONN_SEED,
          actor: CONN,
          grantedAt: 1,
          standing: true,
          user: "ada",
          container: "ada:journal",
          inbox,
        },
      ],
    });
    expect(await poolLetsWrite(inbox)).toBe(true); // the fixture really is live

    expect(await run(["grant", "revoke", CLIENT, "--home", home], io()), printed()).toBe(0);
    expect(await poolLetsWrite(inbox)).toBe(false);
    expect(printed()).toContain(`the connection's own grant negated in ${inbox}`);
    expect(printed()).not.toContain("may still write");
  });
});
