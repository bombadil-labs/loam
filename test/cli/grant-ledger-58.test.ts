// §58 S1b (T262): the ledger names each KEY a connector holds — one per person who consented —
// with that key's own binding and that key's own live-token count, never the connector's total.
// The T205 ledger rail (`grant-ledger.test.ts`) is frozen and seeds one pre-§58 key per client, so a
// per-connector count and a per-key count coincide there; this file is where they differ.
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
const rowFor = (listing: string, needle: string): string =>
  listing
    .split("\n")
    .filter((l) => l.includes(needle))
    .join("\n");

const ADA_SEED = "a1".repeat(32);
const BEA_SEED = "b2".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const BEA = authorForSeed(BEA_SEED);

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-ledger-58-"));
  out.length = 0;
  err.length = 0;
  expect(await run(["init", "--home", home], io())).toBe(0);
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("§58 — one connector, two people, two keys on the ledger", () => {
  it("each key's row names its person and container and counts its own live tokens", async () => {
    const grant = (user: string, seed: string, container: string) => ({
      clientId: "cli-claude",
      actorSeed: seed,
      actor: authorForSeed(seed),
      grantedAt: 1,
      standing: true,
      user,
      container,
      inbox: `inbox:${container}:${authorForSeed(seed)}`,
    });
    const token = (digest: string, user: string) => ({
      digest,
      clientId: "cli-claude",
      issuedAt: 1,
      generation: 1,
      user,
    });
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [
        {
          clientId: "cli-claude",
          clientName: "Claude",
          redirectUris: ["https://x/cb"],
          registeredAt: 1,
          generation: 1,
        },
      ],
      grants: [grant("ada", ADA_SEED, "ada:journal"), grant("bea", BEA_SEED, "bea:notes")],
      tokens: [
        token("aa".repeat(32), "ada"),
        token("ab".repeat(32), "ada"),
        token("bb".repeat(32), "bea"),
      ],
    });
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    // The ledger abbreviates an author; the row is found by the same prefix it prints.
    const ada = rowFor(listing, ADA.slice(0, 20));
    const bea = rowFor(listing, BEA.slice(0, 20));
    expect(ada, listing).not.toBe("");
    expect(bea, listing).not.toBe("");
    expect(ada).toContain("ada · ada:journal");
    expect(ada).toContain("2 live tokens");
    expect(ada).not.toContain("3 live tokens");
    expect(bea).toContain("bea · bea:notes");
    expect(bea).toContain("1 live token");
    expect(bea).not.toContain("1 live tokens");
    // Neither row is the other's, and the seeds never print.
    expect(ada).not.toContain(BEA.slice(0, 20));
    expect(listing).not.toContain(ADA_SEED);
    expect(listing).not.toContain(BEA_SEED);
  });
});

describe("§58 — `loam grant <id> --verb=register` names whose key, when a connector holds more than one", () => {
  const client = (clientId: string) => ({
    clientId,
    clientName: "Claude",
    redirectUris: ["https://x/cb"],
    registeredAt: 1,
    generation: 1,
  });
  const grant = (clientId: string, user: string, seed: string) => ({
    clientId,
    actorSeed: seed,
    actor: authorForSeed(seed),
    grantedAt: 1,
    standing: true,
    user,
    container: `${user}:journal`,
    inbox: `inbox:${user}:journal:${authorForSeed(seed)}`,
  });
  const mint = (...extra: string[]) =>
    run(["grant", "cli-claude", "--verb=register", "--prefix=cl:", ...extra, "--home", home], io());

  it("two keys: refuses without --user, naming both; mints for the named person; refuses a stranger", async () => {
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [client("cli-claude")],
      grants: [grant("cli-claude", "ada", ADA_SEED), grant("cli-claude", "bea", BEA_SEED)],
    });
    expect(await mint()).toBe(2);
    expect(printed()).toContain("--user=<name>");
    expect(printed()).toContain("ada");
    expect(printed()).toContain("bea");
    out.length = 0;
    err.length = 0;
    expect(await mint("--user=zed"), printed()).toBe(2);
    expect(printed()).toContain("no key for zed");
    out.length = 0;
    err.length = 0;
    expect(await mint("--user=ada"), printed()).toBe(0);
    out.length = 0;
    err.length = 0;
    // The grant landed on ADA's key and no other: her row holds register, bea's does not.
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(rowFor(listing, ADA.slice(0, 20))).toContain("register");
    expect(rowFor(listing, BEA.slice(0, 20))).not.toContain("register");
  });

  it("one key needs no name; no key is no acting identity", async () => {
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [client("cli-claude"), client("cli-empty")],
      grants: [grant("cli-claude", "ada", ADA_SEED)],
    });
    expect(await mint(), printed()).toBe(0);
    out.length = 0;
    err.length = 0;
    expect(
      await run(["grant", "cli-empty", "--verb=register", "--prefix=em:", "--home", home], io()),
    ).toBe(2);
    expect(printed()).toContain("no acting identity");
  });
});

// --- a REAL bound connection in a real home ------------------------------------------------------
// The cases above write grant records by hand, which is enough to test the ledger's arithmetic. The
// two below need the thing itself: a container, an inbox pool on disk, and the owner-authored write
// grant inside it — because that grant IS a §58 connection's standing, and both surfaces under test
// were reading the primary and reporting on something else.

const CONN_SEED = "c3".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const OWNER_SEED = "0a".repeat(32);
const CLIENT = "cli-claude";

/** Bind a connection in `home`, exactly as the consent flow would, and return its inbox name. */
async function bindInHome(user: string, container: string): Promise<string> {
  const seed = readSeed(home);
  const operator = authorForSeed(seed);
  writeUserSeed(home, user, OWNER_SEED);
  const gw = await Gateway.boot(
    new SqliteBackend(join(home, "store.sqlite")),
    assembleGenesis({ operatorSeed: seed }),
    { channelBackend: channelBackendFor(home, io()) },
  );
  await gw.append([
    signClaims(
      containerClaims(
        {
          container,
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: authorForSeed(OWNER_SEED) } },
            in: "input",
          },
        },
        operator,
        600,
      ),
      seed,
    ),
  ]);
  const inbox = await gw.bindConnection({
    container,
    connectionKey: CONN,
    ownerSeed: OWNER_SEED,
  });
  const name = inbox.entity!;
  await gw.close();
  return name;
}

/** Does the pool still grant the connection write standing? Asked of the pool's own ground. */
async function poolGrantsWrite(inbox: string): Promise<boolean> {
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(join(home, "store.sqlite")),
    assembleGenesis({ operatorSeed: seed }),
    { channelBackend: channelBackendFor(home, io()) },
  );
  const pool = gw.connectionInboxes.get(inbox)?.gateway;
  const held =
    pool !== undefined &&
    holdsGrant(pool.reactor, STORE_ENTITY, CONN, "write", authorForSeed(seed));
  await gw.close();
  return held;
}

const connectorRecord = (inbox: string) => ({
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
  tokens: [{ digest: "d".repeat(64), clientId: CLIENT, issuedAt: 1, generation: 1, user: "ada" }],
});

describe("§58 — the ledger reads the pool, because that is where the standing is", () => {
  it("a live bound connection reads as holding write standing in its inbox, not as holding none", async () => {
    const inbox = await bindInHome("ada", "ada:journal");
    expect(await poolGrantsWrite(inbox)).toBe(true); // the fixture really is live
    writeOAuthFile(home, connectorRecord(inbox));

    expect(await run(["grant", "list", "--home", home], io())).toBe(0);
    const row = rowFor(printed(), CONN.slice(0, 20));
    expect(row).toContain(`write in ${inbox}`);
    expect(row).not.toContain("no grant in the ground");
    // The verdict column and the live count follow the same answer the door gives.
    expect(row).toContain("write");
  });

  it("a record naming a pool this home cannot attach says so, rather than reporting no standing", async () => {
    writeOAuthFile(home, connectorRecord("inbox:ada:journal:never-stood"));
    expect(await run(["grant", "list", "--home", home], io())).toBe(0);
    const row = rowFor(printed(), CONN.slice(0, 20));
    expect(row).toContain("is not attached here");
    expect(row).not.toContain("no grant in the ground");
  });
});

describe("§58 — revoke strikes the grant that IS the standing, and reports what it struck", () => {
  it("the pool's write grant is struck, and the sentence names the inbox rather than the store", async () => {
    const inbox = await bindInHome("ada", "ada:journal");
    writeOAuthFile(home, connectorRecord(inbox));
    expect(await poolGrantsWrite(inbox)).toBe(true);

    expect(await run(["grant", "revoke", CLIENT, "--home", home], io())).toBe(0);

    // DELTA LEVEL: the grant that carries the connection's standing no longer stands.
    expect(await poolGrantsWrite(inbox)).toBe(false);
    // OBJECT LEVEL: the report names the inbox it struck, and claims no store-wide strike — this
    // store never landed one, and a sentence that said otherwise would be the H7 shape.
    const said = printed();
    expect(said).toContain(`the connection's own grant struck in ${inbox}`);
    expect(said).not.toContain("store-wide write grant");
    expect(said).toContain("authenticates nowhere");
  });

  it("a connector with no reachable pool is told its grant still stands, and where to strike it", async () => {
    writeOAuthFile(home, connectorRecord("inbox:ada:journal:never-stood"));
    expect(await run(["grant", "revoke", CLIENT, "--home", home], io())).toBe(0);
    const said = printed();
    expect(said).toContain("could not reach inbox:ada:journal:never-stood");
    expect(said).toContain("still stands");
    // And it does not claim a strike it did not make.
    expect(said).not.toContain("the connection's own grant struck");
  });
});
